/**
 * Owns the launcher's presentation-only document. It deliberately excludes
 * profiles, Tools, downloads, updates, and runtime launch state so those
 * canonical owners cannot be shadowed by a second writable model.
 */
import { readFile } from "node:fs/promises";
import type {
  LauncherContentKind,
  LauncherInstallationKind,
  LauncherPreferences,
  LauncherPreferencesPatch,
  LauncherProfileAppearance,
} from "../../shared/launcher-contracts.js";
import { LAUNCHER_PROFILE_ICONS } from "../../shared/launcher-contracts.js";
import type { ProfileId } from "../../shared/multiple-accounts.js";
import { parseProfileId } from "../../shared/multiple-accounts.js";
import { writeAtomicJson } from "./atomic-file.js";
import { preserveCorruptDocument } from "./corrupt-document.js";
import { Mutex } from "./mutex.js";

const FORMAT_VERSION = 1;
const SETUP_VERSION = 1;
const INTRODUCTION_VERSION = 1;
const DOCUMENT_MODE = 0o600;
const DEFAULT_COLOR = "#9a6638";
const DEFAULT_ICON = "swords";
const PROFILE_ICONS = new Set<string>(LAUNCHER_PROFILE_ICONS);

function validAppearance(value: LauncherProfileAppearance): boolean {
  return PROFILE_ICONS.has(value.icon) && /^#[0-9a-f]{6}$/iu.test(value.color);
}

export interface LauncherStateDocument {
  readonly formatVersion: 1;
  readonly installationKind: LauncherInstallationKind;
  readonly setupVersion: number;
  readonly introductionVersion: number;
  readonly migrationNoticeDismissed: boolean;
  /** Remains durable until the player dismisses the recovery notice flow. */
  readonly preferencesResetPending: boolean;
  readonly selectedProfileIds: readonly ProfileId[];
  readonly preferences: LauncherPreferences;
  readonly appearances: Readonly<Record<string, LauncherProfileAppearance>>;
}

export interface LoadedLauncherState {
  readonly document: LauncherStateDocument;
}

export const DEFAULT_LAUNCHER_PREFERENCES: LauncherPreferences = Object.freeze({
  content: Object.freeze({
    // Keep both destinations discoverable from the first launch. Production
    // uses honest placeholders until their feeds are connected.
    news: true,
    dailies: true,
    first: "news" as const,
    officialNews: true,
    reforgedNews: true,
  }),
});

export function classifyLauncherInstallation(input: Readonly<{
  legacySingleData: boolean;
  existingWorkspace: boolean;
}>): LauncherInstallationKind {
  if (input.legacySingleData && input.existingWorkspace) return "mixed";
  if (input.legacySingleData) return "migrated-single";
  if (input.existingWorkspace) return "migrated-multi";
  return "fresh";
}

function defaults(
  kind: LauncherInstallationKind,
  preferencesResetPending = false,
): LauncherStateDocument {
  const fresh = kind === "fresh";
  return {
    formatVersion: FORMAT_VERSION,
    installationKind: kind,
    setupVersion: fresh ? 0 : SETUP_VERSION,
    introductionVersion: fresh ? 0 : INTRODUCTION_VERSION,
    migrationNoticeDismissed: fresh,
    preferencesResetPending,
    selectedProfileIds: [],
    preferences: DEFAULT_LAUNCHER_PREFERENCES,
    appearances: {},
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function version(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function parseKind(value: unknown): LauncherInstallationKind {
  if (value === "fresh" || value === "migrated-single" || value === "migrated-multi" || value === "mixed") return value;
  throw new Error("installation kind is invalid");
}

function parseContentKind(value: unknown): LauncherContentKind {
  if (value === "news" || value === "dailies") return value;
  throw new Error("default Home content is invalid");
}

export function parseLauncherState(value: unknown): LauncherStateDocument {
  const source = record(value, "launcher state");
  if (source.formatVersion !== FORMAT_VERSION) throw new Error("launcher state format is not supported");
  const preferences = record(source.preferences, "launcher preferences");
  const content = record(preferences.content, "launcher content preferences");
  const appearances = record(source.appearances, "profile appearances");
  const parsedAppearances: Record<string, LauncherProfileAppearance> = {};
  for (const [id, raw] of Object.entries(appearances)) {
    parseProfileId(id);
    const appearance = record(raw, "profile appearance");
    if (
      typeof appearance.icon !== "string"
      || typeof appearance.color !== "string"
      || !validAppearance({ icon: appearance.icon, color: appearance.color })
    ) {
      throw new Error("profile appearance is invalid");
    }
    parsedAppearances[id] = { icon: appearance.icon, color: appearance.color };
  }
  if (!Array.isArray(source.selectedProfileIds)) throw new Error("selected profiles must be an array");
  return {
    formatVersion: FORMAT_VERSION,
    installationKind: parseKind(source.installationKind),
    setupVersion: version(source.setupVersion, "setup version"),
    introductionVersion: version(source.introductionVersion, "introduction version"),
    migrationNoticeDismissed: boolean(source.migrationNoticeDismissed, "migration notice"),
    // Additive within the candidate-owned document. Older candidate writes
    // predate durable recovery acknowledgement and therefore mean no notice.
    preferencesResetPending: source.preferencesResetPending === undefined
      ? false
      : boolean(source.preferencesResetPending, "preferences reset notice"),
    selectedProfileIds: source.selectedProfileIds.map(parseProfileId),
    preferences: {
      content: {
        news: boolean(content.news, "News visibility"),
        dailies: boolean(content.dailies, "Dailies visibility"),
        first: parseContentKind(content.first),
        officialNews: boolean(content.officialNews, "official News visibility"),
        reforgedNews: boolean(content.reforgedNews, "Reforged News visibility"),
      },
    },
    appearances: parsedAppearances,
  };
}

export async function loadOrCreateLauncherState(
  path: string,
  kind: LauncherInstallationKind,
): Promise<LoadedLauncherState> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const document = defaults(kind);
      await writeAtomicJson(path, document, DOCUMENT_MODE);
      return { document };
    }
    throw error;
  }

  try {
    const document = parseLauncherState(JSON.parse(bytes.toString("utf8")) as unknown);
    return { document };
  } catch {
    // Copy first. Renaming the source before publishing defaults creates a
    // crash window where the next launch sees an absent document and can
    // incorrectly classify an existing installation as fresh.
    await preserveCorruptDocument(path, bytes, DOCUMENT_MODE);
    // An invalid document makes the original install kind uncertain. Treat
    // it as migrated and skip forced setup so recovery cannot trap a player.
    const document = defaults(
      kind === "fresh" ? "migrated-single" : kind,
      true,
    );
    await writeAtomicJson(path, document, DOCUMENT_MODE);
    return { document };
  }
}

export class LauncherStateStore {
  readonly path: string;
  private value: LauncherStateDocument;
  private readonly writes = new Mutex();

  constructor(
    path: string,
    value: LauncherStateDocument,
  ) {
    this.path = path;
    this.value = value;
  }

  get(): LauncherStateDocument {
    return this.value;
  }

  appearance(profileId: ProfileId): LauncherProfileAppearance {
    return this.value.appearances[profileId] ?? { icon: DEFAULT_ICON, color: DEFAULT_COLOR };
  }

  async setSelection(ids: readonly ProfileId[]): Promise<void> {
    await this.save((current) => ({ ...current, selectedProfileIds: [...new Set(ids)] }));
  }

  async dismissMigrationNotice(): Promise<void> {
    await this.save((current) => ({
      ...current,
      migrationNoticeDismissed: true,
    }));
  }

  async dismissPreferencesReset(): Promise<void> {
    await this.save((current) => ({
      ...current,
      preferencesResetPending: false,
    }));
  }

  async completeSetup(): Promise<void> {
    await this.save((current) => ({ ...current, setupVersion: SETUP_VERSION }));
  }

  async completeIntroduction(): Promise<void> {
    await this.save((current) => ({ ...current, introductionVersion: INTRODUCTION_VERSION }));
  }

  async replayIntroduction(): Promise<void> {
    await this.save((current) => ({ ...current, introductionVersion: 0 }));
  }

  async updateAppearance(profileId: ProfileId, appearance: LauncherProfileAppearance): Promise<void> {
    if (!validAppearance(appearance)) throw new Error("Profile appearance is invalid");
    await this.save((current) => ({
      ...current,
      appearances: { ...current.appearances, [profileId]: appearance },
    }));
  }

  async resetPresentation(): Promise<void> {
    await this.save((current) => ({
      ...current,
      preferences: DEFAULT_LAUNCHER_PREFERENCES,
      selectedProfileIds: [],
      appearances: {},
    }));
  }

  async updatePreferences(patch: LauncherPreferencesPatch): Promise<void> {
    await this.save((current) => {
      const content = { ...current.preferences.content, ...patch.content };
      if (!content.news && !content.dailies) content.first = "news";
      else if (!content[content.first]) content.first = content.news ? "news" : "dailies";
      return { ...current, preferences: { content } };
    });
  }

  private async save(update: (current: LauncherStateDocument) => LauncherStateDocument): Promise<void> {
    await this.writes.run(async () => {
      const next = update(this.value);
      const parsed = parseLauncherState(next);
      await writeAtomicJson(this.path, parsed, DOCUMENT_MODE);
      this.value = parsed;
    });
  }
}
