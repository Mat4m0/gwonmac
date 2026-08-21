/**
 * The canonical Multiple Accounts template library and its three-way merge.
 *
 * Each shared window receives an in-memory baseline at launch. On close, its
 * current projection is compared with that baseline and the latest canonical
 * library. Unrelated edits combine; a concurrent edit beats a stale deletion;
 * and two different edits to one path are both retained under stable conflict
 * names. The canonical library is the sole durable commit. Single Account data
 * never enters this owner except as an explicit setup snapshot.
 */
import { readFile } from "node:fs/promises";
import type {
  AccountTemplateLibrary,
  TemplateExportEntry,
} from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import { parseTemplateEntries } from "../../shared/template-entries.js";
import {
  AtomicPublicationUnconfirmedError,
  writeAtomicJson,
  writeAtomicJsonExclusive,
} from "./atomic-file.js";

const DOCUMENT_MODE = 0o600;

function parseLibrary(value: unknown): AccountTemplateLibrary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("bad_multi_workspace", "template library must be an object");
  }
  const source = value as Record<string, unknown>;
  if (
    source.formatVersion !== 1
    || !Number.isSafeInteger(source.revision)
    || (source.revision as number) < 0
  ) {
    throw new AppError("bad_multi_workspace", "template library format is invalid");
  }
  return {
    revision: source.revision as number,
    entries: parseTemplateEntries(source.entries),
  };
}

export async function loadAccountTemplateLibrary(
  filePath: string,
): Promise<AccountTemplateLibrary> {
  try {
    return parseLibrary(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { revision: 0, entries: [] };
    }
    throw error;
  }
}

export async function saveAccountTemplateLibrary(
  filePath: string,
  library: AccountTemplateLibrary,
): Promise<AccountTemplateLibrary> {
  const entries = parseTemplateEntries(library.entries);
  const value = { formatVersion: 1, revision: library.revision, entries };
  await writeAtomicJson(filePath, value, DOCUMENT_MODE);
  return { revision: value.revision, entries: value.entries };
}

/** First-account import: publish a complete snapshot without replacing recovery data. */
export async function saveAccountTemplateLibraryExclusive(
  filePath: string,
  library: AccountTemplateLibrary,
): Promise<AccountTemplateLibrary> {
  const entries = parseTemplateEntries(library.entries);
  const value = { formatVersion: 1, revision: library.revision, entries };
  await writeAtomicJsonExclusive(filePath, value, DOCUMENT_MODE);
  return { revision: value.revision, entries: value.entries };
}

const pathKey = (filePath: string) => filePath.normalize("NFC").toLowerCase();
const entriesByPath = (entries: readonly TemplateExportEntry[]) =>
  new Map(entries.map((entry) => [pathKey(entry.path), entry]));

/** The logical projection shape used to recognise an identical close retry. */
export function normaliseAccountTemplateProjection(
  entries: readonly TemplateExportEntry[],
): TemplateExportEntry[] {
  return [...entriesByPath(parseTemplateEntries(entries)).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, entry]) => entry);
}

function sameProjection(
  left: readonly TemplateExportEntry[],
  right: readonly TemplateExportEntry[],
): boolean {
  const normalised = normaliseAccountTemplateProjection(right);
  return left.length === normalised.length
    && left.every((entry, index) => {
      const candidate = normalised[index];
      return candidate !== undefined
        && pathKey(candidate.path) === pathKey(entry.path)
        && candidate.contents === entry.contents;
    });
}

function conflictPath(path: string, occupied: ReadonlySet<string>): string {
  const suffix = " (conflict)";
  const extension = path.toLowerCase().endsWith(".txt") ? ".txt" : "";
  const cut = path.lastIndexOf("/");
  const directory = path.slice(0, cut + 1);
  const file = path.slice(cut + 1, extension ? -extension.length : undefined);
  for (let number = 1; number <= 99; number += 1) {
    const tag = `${suffix}${number === 1 ? "" : ` ${number}`}`;
    const maxStem = 259 - extension.length - tag.length;
    const candidate = `${directory}${file.slice(0, maxStem)}${tag}${extension}`;
    if (!occupied.has(pathKey(candidate))) return candidate;
  }
  throw new AppError("bad_multi_workspace", "too many template conflicts");
}

/** Merge one profile projection against the checkpoint it was launched with. */
export function reconcileAccountTemplates(
  baseEntries: readonly TemplateExportEntry[],
  latestEntries: readonly TemplateExportEntry[],
  profileEntries: readonly TemplateExportEntry[],
): TemplateExportEntry[] {
  const base = entriesByPath(parseTemplateEntries(baseEntries));
  const latest = entriesByPath(parseTemplateEntries(latestEntries));
  const profile = entriesByPath(parseTemplateEntries(profileEntries));
  const result = new Map(latest);
  const paths = new Set([...base.keys(), ...profile.keys()]);
  for (const key of paths) {
    const before = base.get(key);
    const local = profile.get(key);
    const current = latest.get(key);
    if (local?.contents === before?.contents) continue;
    if (local === undefined) {
      if (current?.contents === before?.contents) result.delete(key);
      continue;
    }
    if (
      current === undefined
      || current.contents === before?.contents
      || current.contents === local.contents
    ) {
      result.set(key, local);
      continue;
    }
    const occupied = new Set(result.keys());
    const conflicted = conflictPath(local.path, occupied);
    result.set(pathKey(conflicted), { path: conflicted, contents: local.contents });
  }
  return [...result.values()]
    .sort((left, right) => left.path.localeCompare(right.path));
}

type ReadySession = Readonly<{
  status: "ready";
  base: readonly TemplateExportEntry[];
}>;

type SubmittedSession = Readonly<{
  submitted: readonly TemplateExportEntry[];
  merged: AccountTemplateLibrary;
}>;

type CommittedSession = SubmittedSession & Readonly<{ status: "committed" }>;
type UnconfirmedSession = SubmittedSession & Readonly<{ status: "unconfirmed" }>;
type TemplateSession = ReadySession | CommittedSession | UnconfirmedSession;

export interface AccountTemplateSessionPersistence {
  loadLatest(): Promise<AccountTemplateLibrary>;
  publish(library: AccountTemplateLibrary): Promise<AccountTemplateLibrary>;
}

/**
 * One three-way merge generation per concrete game window.
 *
 * A renderer reload calls `begin` again after replacing its projection. Until
 * then, a changed second submission is not mergeable: the renderer never
 * received the conflict names or concurrent additions in the merged result.
 * This removes the second durable owner; it does not journal last-minute edits,
 * so a true disk failure during close or app quit remains best-effort.
 */
export class AccountTemplateSessions<Owner extends object> {
  readonly #sessions = new WeakMap<Owner, TemplateSession>();

  begin(owner: Owner, library: AccountTemplateLibrary): void {
    this.#sessions.set(owner, {
      status: "ready",
      base: normaliseAccountTemplateProjection(library.entries),
    });
  }

  forget(owner: Owner): void {
    this.#sessions.delete(owner);
  }

  async save(
    owner: Owner,
    entries: readonly TemplateExportEntry[],
    persistence: AccountTemplateSessionPersistence,
  ): Promise<AccountTemplateLibrary> {
    const session = this.#sessions.get(owner);
    if (!session) {
      throw new Error("Shared templates must load before they can be saved");
    }
    const submitted = normaliseAccountTemplateProjection(entries);

    if (session.status === "committed") {
      if (sameProjection(session.submitted, submitted)) return session.merged;
      throw new Error(
        "Shared templates changed after this window synchronized; reload before saving again",
      );
    }

    if (session.status === "unconfirmed") {
      if (!sameProjection(session.submitted, submitted)) {
        throw new Error(
          "Shared template publication is unconfirmed; reload before saving changed templates",
        );
      }
      const latest = await persistence.loadLatest();
      try {
        // The first rename happened. Re-publish the latest canonical value,
        // rather than merging the same local delta twice, so another window's
        // later commit cannot be erased while confirming directory durability.
        const confirmed = await persistence.publish(latest);
        this.#sessions.set(owner, {
          status: "committed",
          submitted: session.submitted,
          merged: confirmed,
        });
        return confirmed;
      } catch {
        // The original publication is still active but not confirmed durable.
        // Both ordinary and post-rename retry failures keep this state closed
        // to changed submissions.
        throw new Error(
          "Shared template publication is still unconfirmed; reload before retrying",
        );
      }
    }

    const latest = await persistence.loadLatest();
    const merged: AccountTemplateLibrary = {
      revision: latest.revision + 1,
      entries: reconcileAccountTemplates(session.base, latest.entries, submitted),
    };
    try {
      const committed = await persistence.publish(merged);
      this.#sessions.set(owner, {
        status: "committed",
        submitted,
        merged: committed,
      });
      return committed;
    } catch (error) {
      if (error instanceof AtomicPublicationUnconfirmedError) {
        this.#sessions.set(owner, {
          status: "unconfirmed",
          submitted,
          merged,
        });
      }
      // A failure before rename leaves the ready session retryable. A failure
      // after rename has stored enough identity for one safe confirmation.
      throw error;
    }
  }
}
