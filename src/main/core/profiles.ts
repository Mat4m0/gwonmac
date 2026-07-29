import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../shared/errors.js";
import { writeAtomic, writeAtomicJson } from "./atomic-file.js";
import { Mutex } from "./mutex.js";

declare const profileIdBrand: unique symbol;
export type ProfileId = string & { readonly [profileIdBrand]: true };

export interface ProfilePaths {
  readonly root: string;
  readonly document: string;
  readonly credentials: string;
  readonly steamSession: string;
  readonly windowState: string;
  readonly browser: string;
  readonly gameStorageClearRequest: string;
  readonly trashOnStart: string;
}

export interface ProfileRecord {
  readonly id: ProfileId;
  readonly label: string;
  readonly paths: ProfilePaths;
}

export interface ProfileScan {
  readonly profiles: readonly ProfileRecord[];
  readonly invalidCount: number;
}

interface ProfileDocumentV1 {
  readonly formatVersion: 1;
  readonly label: string;
}

const PROFILE_ID = /^[0-9a-f]{32}$/u;
const CREATE_STAGE = /^\.create-([0-9a-f]{32})\.stage$/u;
const MAX_PROFILE_DOCUMENT_BYTES = 16 * 1024;
const BIDI_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export function generateProfileId(): ProfileId {
  return parseProfileId(randomBytes(16).toString("hex"));
}

export function parseProfileId(value: unknown): ProfileId {
  if (typeof value !== "string" || !PROFILE_ID.test(value)) {
    throw new AppError("validation", "invalid profile ID");
  }
  return value as ProfileId;
}

export function normalizeProfileLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("validation", "profile label must be text");
  }
  const label = value.trim().normalize("NFC");
  const length = Array.from(label).length;
  if (
    length < 1
    || length > 40
    || /\p{Cc}/u.test(label)
    || BIDI_CONTROL.test(label)
  ) {
    throw new AppError("validation", "invalid profile label");
  }
  return label;
}

export function profileLabelKey(label: string): string {
  return normalizeProfileLabel(label).toLowerCase();
}

export function profilePaths(
  profilesRoot: string,
  id: ProfileId,
): ProfilePaths {
  const canonicalId = parseProfileId(id);
  const root = path.join(profilesRoot, canonicalId);
  const relative = path.relative(profilesRoot, root);
  if (
    relative !== canonicalId
    || path.isAbsolute(relative)
    || relative.startsWith(`..${path.sep}`)
  ) {
    throw new AppError("validation", "profile path escaped its root");
  }
  return Object.freeze({
    root,
    document: path.join(root, "profile.json"),
    credentials: path.join(root, "credentials.bin"),
    steamSession: path.join(root, "steam-session.bin"),
    windowState: path.join(root, "window-state.json"),
    browser: path.join(root, "browser"),
    gameStorageClearRequest: path.join(root, "clear-game-storage-on-start"),
    trashOnStart: path.join(root, "trash-on-start"),
  });
}

function parseProfileDocument(value: unknown): ProfileDocumentV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("validation", "invalid profile document");
  }
  const source = value as Record<string, unknown>;
  if (
    Object.keys(source).length !== 2
    || source.formatVersion !== 1
    || !Object.hasOwn(source, "label")
  ) {
    throw new AppError("validation", "invalid profile document");
  }
  return {
    formatVersion: 1,
    label: normalizeProfileLabel(source.label),
  };
}

async function readProfileDocument(target: string): Promise<ProfileDocumentV1> {
  const info = await stat(target);
  if (!info.isFile() || info.size > MAX_PROFILE_DOCUMENT_BYTES) {
    throw new AppError("validation", "invalid profile document size");
  }
  return parseProfileDocument(JSON.parse(await readFile(target, "utf8")));
}

export class ProfileStore {
  private readonly root: string;
  private readonly operation = new Mutex();
  private readonly createId: () => ProfileId;

  constructor(
    root: string,
    createId: () => ProfileId = generateProfileId,
  ) {
    this.root = path.resolve(root);
    this.createId = createId;
  }

  async scan(): Promise<ProfileScan> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const profiles: ProfileRecord[] = [];
    let invalidCount = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROFILE_ID.test(entry.name)) continue;
      const id = parseProfileId(entry.name);
      const paths = profilePaths(this.root, id);
      try {
        const document = await readProfileDocument(paths.document);
        profiles.push(Object.freeze({ id, label: document.label, paths }));
      } catch {
        invalidCount += 1;
      }
    }
    profiles.sort((left, right) => {
      const leftKey = profileLabelKey(left.label);
      const rightKey = profileLabelKey(right.label);
      if (leftKey < rightKey) return -1;
      if (leftKey > rightKey) return 1;
      return left.id < right.id ? -1 : 1;
    });
    return Object.freeze({
      profiles: Object.freeze(profiles),
      invalidCount,
    });
  }

  create(label: string): Promise<ProfileRecord> {
    return this.operation.run(async () => {
      const canonicalLabel = normalizeProfileLabel(label);
      await this.assertUniqueLabel(canonicalLabel);
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const id = this.createId();
        const paths = profilePaths(this.root, id);
        const stage = path.join(this.root, `.create-${id}.stage`);
        const destinationExists = await stat(paths.root).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        );
        if (destinationExists) continue;
        try {
          await mkdir(stage, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
          throw error;
        }
        const document = path.join(stage, "profile.json");
        await writeAtomicJson(
          document,
          { formatVersion: 1, label: canonicalLabel },
          0o600,
        );
        await mkdir(path.join(stage, "browser"), { mode: 0o700 });
        await rename(stage, paths.root);
        return Object.freeze({ id, label: canonicalLabel, paths });
      }
      throw new AppError("validation", "could not allocate a unique profile ID");
    });
  }

  rename(id: ProfileId, label: string): Promise<ProfileRecord> {
    return this.operation.run(async () => {
      const canonicalId = parseProfileId(id);
      const canonicalLabel = normalizeProfileLabel(label);
      await this.assertUniqueLabel(canonicalLabel, canonicalId);
      const paths = profilePaths(this.root, canonicalId);
      await readProfileDocument(paths.document);
      await writeAtomicJson(
        paths.document,
        { formatVersion: 1, label: canonicalLabel },
        0o600,
      );
      return Object.freeze({
        id: canonicalId,
        label: canonicalLabel,
        paths,
      });
    });
  }

  async forgetSavedLogin(id: ProfileId): Promise<void> {
    const paths = profilePaths(this.root, parseProfileId(id));
    await unlink(paths.credentials).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async requestGameStorageReset(id: ProfileId): Promise<void> {
    const paths = profilePaths(this.root, parseProfileId(id));
    await readProfileDocument(paths.document);
    await writeAtomic(paths.gameStorageClearRequest, "", 0o600);
  }

  requestTrash(
    id: ProfileId,
    isRunning: (id: ProfileId) => boolean,
  ): Promise<void> {
    return this.operation.run(async () => {
      const canonicalId = parseProfileId(id);
      if (isRunning(canonicalId)) {
        throw new AppError("validation", "running profile cannot be trashed");
      }
      const paths = profilePaths(this.root, canonicalId);
      await readProfileDocument(paths.document);
      await writeAtomic(paths.trashOnStart, "", 0o600);
    });
  }

  async trashMarked(
    trashItem: (profileRoot: string) => Promise<void>,
  ): Promise<{ trashed: number; failed: number }> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    let trashed = 0;
    let failed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROFILE_ID.test(entry.name)) continue;
      const paths = profilePaths(this.root, parseProfileId(entry.name));
      try {
        const marker = await stat(paths.trashOnStart);
        if (!marker.isFile() || marker.size !== 0) {
          failed += 1;
          continue;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        failed += 1;
        continue;
      }
      try {
        await trashItem(paths.root);
        trashed += 1;
      } catch {
        failed += 1;
      }
    }
    return { trashed, failed };
  }

  async cleanupIncompleteStages(): Promise<number> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !CREATE_STAGE.test(entry.name)) continue;
      await rm(path.join(this.root, entry.name), {
        recursive: true,
        force: true,
      });
      removed += 1;
    }
    return removed;
  }

  private async assertUniqueLabel(
    label: string,
    except?: ProfileId,
  ): Promise<void> {
    const wanted = profileLabelKey(label);
    const { profiles } = await this.scan();
    if (
      profiles.some(
        (profile) =>
          profile.id !== except && profileLabelKey(profile.label) === wanted,
      )
    ) {
      throw new AppError("validation", "profile label already exists");
    }
  }
}
