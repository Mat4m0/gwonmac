/**
 * The narrow, presentation-oriented contract between the unified launcher and
 * Electron main. Domain owners remain in main; this file only names validated
 * commands and the rebuildable projection the Vue application renders.
 */
import type {
  AppUpdateState,
  DownloadActivity,
  FullDownloadState,
} from "./contracts.js";
import type { ProfileId } from "./multiple-accounts.js";

export const LAUNCHER_IPC = Object.freeze({
  stateGet: "gw:launcher:state:get",
  stateEvent: "gw:launcher:state:event",
  profilesCreate: "gw:launcher:profiles:create",
  profilesSetSelection: "gw:launcher:profiles:setSelection",
  profilesPlay: "gw:launcher:profiles:play",
  profilesShow: "gw:launcher:profiles:show",
  profilesCancelQueued: "gw:launcher:profiles:cancelQueued",
  experienceDismissMigration: "gw:launcher:experience:dismissMigration",
  experienceCompleteIntroduction: "gw:launcher:experience:completeIntroduction",
  experienceUpdatePreferences: "gw:launcher:experience:updatePreferences",
  updatesCheck: "gw:launcher:updates:check",
  updatesRestartAndInstall: "gw:launcher:updates:restartAndInstall",
} as const);

export type LauncherInstallationKind =
  | "fresh"
  | "migrated-single"
  | "migrated-multi"
  | "mixed";

export type LauncherContentKind = "news" | "dailies";

export interface LauncherPreferences {
  readonly content: Readonly<{
    news: boolean;
    dailies: boolean;
    first: LauncherContentKind;
    officialNews: boolean;
    reforgedNews: boolean;
  }>;
}

export interface LauncherPreferencesPatch {
  readonly content?: Partial<LauncherPreferences["content"]>;
}

export interface LauncherProfileAppearance {
  readonly icon: string;
  readonly color: string;
}

export interface LauncherProfileSummary {
  readonly id: ProfileId;
  readonly name: string;
  readonly archived: boolean;
  readonly state: "ready" | "queued" | "opening" | "checking" | "running" | "failed";
  readonly appearance: LauncherProfileAppearance;
  readonly failure?: "profile-preparation" | "window-startup" | "client-validation" | "renderer-crash" | "unknown";
}

export type LauncherReadiness =
  | { readonly state: "preparing"; readonly progress: DownloadActivity }
  | { readonly state: "playable"; readonly backgroundDownload: FullDownloadState | null }
  | { readonly state: "repair-required"; readonly reason: string }
  | { readonly state: "offline-playable" };

export interface LauncherSnapshot {
  readonly revision: number;
  readonly experience: Readonly<{
    installationKind: LauncherInstallationKind;
    setup: "pending" | "complete";
    introduction: "pending" | "complete";
    showMigrationNotice: boolean;
    preferencesReset: boolean;
  }>;
  readonly readiness: LauncherReadiness;
  readonly appUpdate: AppUpdateState;
  readonly tools: Readonly<{
    configured: boolean;
    loaded: boolean;
    restartRequired: boolean;
  }>;
  readonly profiles: readonly LauncherProfileSummary[];
  readonly selectedProfileIds: readonly ProfileId[];
  readonly preferences: LauncherPreferences;
  readonly contentAvailability: Readonly<{
    news: "fixture" | "placeholder";
    dailies: "fixture" | "placeholder";
    knownIssues: "fixture" | "placeholder";
    feedback: "fixture" | "placeholder";
  }>;
}

export interface LauncherNativeApi {
  readonly state: {
    get(): Promise<LauncherSnapshot>;
    onChange(callback: (snapshot: LauncherSnapshot) => void): () => void;
  };
  readonly profiles: {
    create(input: { readonly name: string }): Promise<void>;
    setSelection(ids: readonly ProfileId[]): Promise<void>;
    play(ids: readonly ProfileId[]): Promise<void>;
    show(id: ProfileId): Promise<void>;
    cancelQueued(ids: readonly ProfileId[]): Promise<void>;
  };
  readonly experience: {
    completeIntroduction(): Promise<void>;
    dismissMigrationNotice(): Promise<void>;
    updatePreferences(patch: LauncherPreferencesPatch): Promise<void>;
  };
  readonly updates: {
    check(): Promise<void>;
    restartAndInstall(): Promise<void>;
  };
}

function exactObject(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !allowed.includes(key))) throw new Error(`${label} has an unknown field`);
  return source;
}

export function parseLauncherPreferencesPatch(value: unknown): LauncherPreferencesPatch {
  const source = exactObject(value, ["content"], "launcher preferences patch");
  if (source.content === undefined) return {};
  const content = exactObject(
    source.content,
    ["news", "dailies", "first", "officialNews", "reforgedNews"],
    "launcher content patch",
  );
  const patch: {
    news?: boolean;
    dailies?: boolean;
    first?: LauncherContentKind;
    officialNews?: boolean;
    reforgedNews?: boolean;
  } = {};
  for (const field of ["news", "dailies", "officialNews", "reforgedNews"] as const) {
    const candidate = content[field];
    if (candidate === undefined) continue;
    if (typeof candidate !== "boolean") throw new Error(`${field} must be a boolean`);
    patch[field] = candidate;
  }
  if (content.first !== undefined) {
    if (content.first !== "news" && content.first !== "dailies") throw new Error("first content must be news or dailies");
    patch.first = content.first;
  }
  return { content: patch };
}
