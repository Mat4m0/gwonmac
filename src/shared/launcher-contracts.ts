/**
 * The narrow, presentation-oriented contract between the unified launcher and
 * Electron main. Domain owners remain in main; this file only names validated
 * commands and the rebuildable projection the Vue application renders.
 */
import type {
  AppSettings,
  AppUpdateState,
  CacheInfo,
  DownloadActivity,
  FullDownloadState,
  NoticeCode,
} from "./contracts.js";
import { RENDER_SCALES } from "./contracts.js";
import type { ErrorCode } from "./errors.js";
import {
  CARTOGRAPHY_CONTROL_IDLE_OPACITY_MAX,
  CARTOGRAPHY_CONTROL_IDLE_OPACITY_MIN,
  CARTOGRAPHY_OPACITY_MAX,
  CARTOGRAPHY_OPACITY_MIN,
  normaliseCartographyPresetLibrary,
  type CartographyPresetLibrary,
} from "./cartography-overlay.js";
import type { ShortcutBinding } from "./keyboard-shortcuts.js";
import type { ProfileId } from "./multiple-accounts.js";

export const LAUNCHER_IPC = Object.freeze({
  stateGet: "gw:launcher:state:get",
  stateEvent: "gw:launcher:state:event",
  navigationEvent: "gw:launcher:navigation:event",
  profilesCreate: "gw:launcher:profiles:create",
  profilesUpdateAppearance: "gw:launcher:profiles:updateAppearance",
  profilesSetSelection: "gw:launcher:profiles:setSelection",
  profilesPlay: "gw:launcher:profiles:play",
  profilesShow: "gw:launcher:profiles:show",
  profilesCancelQueued: "gw:launcher:profiles:cancelQueued",
  profilesArchive: "gw:launcher:profiles:archive",
  profilesRestore: "gw:launcher:profiles:restore",
  profilesDelete: "gw:launcher:profiles:delete",
  experienceDismissMigration: "gw:launcher:experience:dismissMigration",
  experienceDismissPreferencesReset: "gw:launcher:experience:dismissPreferencesReset",
  experienceCompleteSetup: "gw:launcher:experience:completeSetup",
  experienceCompleteIntroduction: "gw:launcher:experience:completeIntroduction",
  experienceReplayIntroduction: "gw:launcher:experience:replayIntroduction",
  experienceUpdatePreferences: "gw:launcher:experience:updatePreferences",
  settingsUpdate: "gw:launcher:settings:update",
  settingsReset: "gw:launcher:settings:reset",
  toolsSetMasterEnabled: "gw:launcher:tools:setMasterEnabled",
  toolsSetFeature: "gw:launcher:tools:setFeature",
  toolsCaptureShortcut: "gw:launcher:tools:captureShortcut",
  toolsReplaceShortcut: "gw:launcher:tools:replaceShortcut",
  toolsRestoreDefaultShortcut: "gw:launcher:tools:restoreDefaultShortcut",
  toolsRestartToApply: "gw:launcher:tools:restartToApply",
  gameFilesInfo: "gw:launcher:gameFiles:info",
  gameFilesRetryPreparation: "gw:launcher:gameFiles:retryPreparation",
  gameFilesRepair: "gw:launcher:gameFiles:repair",
  gameFilesPauseDownload: "gw:launcher:gameFiles:pauseDownload",
  gameFilesResumeDownload: "gw:launcher:gameFiles:resumeDownload",
  gameFilesResetAndRestart: "gw:launcher:gameFiles:resetAndRestart",
  externalOpen: "gw:launcher:external:open",
  externalRevealLogs: "gw:launcher:external:revealLogs",
  updatesCheck: "gw:launcher:updates:check",
  updatesRestartAndInstall: "gw:launcher:updates:restartAndInstall",
} as const);

export type LauncherDestination = "home" | "settings";

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
export const LAUNCHER_PROFILE_ICONS = ["swords", "archive", "map", "scroll", "shield", "star", "crown", "flame"] as const;

export function parseLauncherProfileAppearance(value: unknown): LauncherProfileAppearance {
  const source = exactObject(value, ["icon", "color"], "profile appearance");
  if (typeof source.icon !== "string" || !LAUNCHER_PROFILE_ICONS.includes(source.icon as (typeof LAUNCHER_PROFILE_ICONS)[number])) throw new Error("profile icon is invalid");
  if (typeof source.color !== "string" || !/^#[0-9a-f]{6}$/iu.test(source.color)) throw new Error("profile color is invalid");
  return { icon: source.icon, color: source.color };
}

export const GLOBAL_TOOLS = ["build-management", "quick-travel", "xunlai-storage"] as const;
export type GlobalTool = (typeof GLOBAL_TOOLS)[number];
export const LAUNCHER_EXTERNAL_LINKS = ["github", "bugReport", "featureRequest", "discord", "arenaNetSupport", "donate", "releases"] as const;
export type LauncherExternalLink = (typeof LAUNCHER_EXTERNAL_LINKS)[number];

export interface GlobalToolSetting {
  readonly enabled: boolean;
  readonly shortcut: ShortcutBinding | null;
}

export type GlobalToolSettings = Readonly<Record<GlobalTool, GlobalToolSetting>>;

export interface LauncherSettings {
  readonly autoCheckUpdates: boolean;
  readonly updateTrack: AppSettings["updateTrack"];
  readonly renderScale: AppSettings["renderScale"];
  readonly extendedMemoryEnabled: boolean;
  readonly showDiagnostics: boolean;
  readonly cartographyOverlayEnabled: boolean;
  readonly cartographyGridEnabled: boolean;
  readonly cartographyRevealMode: AppSettings["cartographyRevealMode"];
  readonly cartographyPresetLibrary: CartographyPresetLibrary;
  readonly cartographyWalkabilityOpacity: number;
  readonly cartographyGridOpacity: number;
  readonly cartographyControlIdleOpacity: number;
}

export type LauncherSettingsPatch = Partial<LauncherSettings>;
export interface ProfileAppearanceUpdate extends LauncherProfileAppearance {
  readonly id: ProfileId;
}
export interface LauncherProfileCreateInput {
  readonly name: string;
  readonly appearance?: LauncherProfileAppearance;
}
export interface GlobalToolUpdate {
  readonly tool: GlobalTool;
  readonly enabled: boolean;
}
export interface ShortcutReplacement {
  readonly tool: GlobalTool;
  readonly binding: ShortcutBinding;
}
export type LauncherShortcutCaptureResult =
  | Readonly<{ status: "captured"; binding: ShortcutBinding }>
  | Readonly<{ status: "reserved" }>
  | Readonly<{ status: "conflict"; tool: GlobalTool; binding: ShortcutBinding }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "invalid" }>;

export interface LauncherProfileSummary {
  readonly id: ProfileId;
  readonly name: string;
  readonly archived: boolean;
  readonly state: "ready" | "queued" | "opening" | "checking" | "running" | "failed";
  readonly appearance: LauncherProfileAppearance;
  readonly failure?: "profile-preparation" | "window-startup" | "client-validation" | "renderer-crash" | "unknown";
}

export type LauncherBackgroundDownload =
  | (Extract<FullDownloadState, { readonly status: "running" }> & Readonly<Pick<
      DownloadActivity,
      "received" | "total" | "bytesPerSecond" | "secondsRemaining"
    >>)
  | Exclude<FullDownloadState, { readonly status: "running" }>;

export type LauncherReadiness =
  | { readonly state: "preparing"; readonly progress: DownloadActivity }
  | {
      readonly state: "playable";
      readonly backgroundDownload: LauncherBackgroundDownload | null;
      readonly notice?: NoticeCode;
    }
  | { readonly state: "repair-required"; readonly reason: ErrorCode }
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
    features: GlobalToolSettings;
  }>;
  readonly settings: LauncherSettings;
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
  readonly navigation: {
    onRequest(callback: (destination: LauncherDestination) => void): () => void;
  };
  readonly state: {
    get(): Promise<LauncherSnapshot>;
    onChange(callback: (snapshot: LauncherSnapshot) => void): () => void;
  };
  readonly profiles: {
    create(input: LauncherProfileCreateInput): Promise<void>;
    updateAppearance(input: ProfileAppearanceUpdate): Promise<void>;
    setSelection(ids: readonly ProfileId[]): Promise<void>;
    play(ids: readonly ProfileId[]): Promise<void>;
    show(id: ProfileId): Promise<void>;
    cancelQueued(ids: readonly ProfileId[]): Promise<void>;
    archive(id: ProfileId): Promise<void>;
    restore(id: ProfileId): Promise<void>;
    delete(id: ProfileId): Promise<void>;
  };
  readonly experience: {
    completeSetup(input: { readonly enableTools: boolean }): Promise<void>;
    completeIntroduction(): Promise<void>;
    replayIntroduction(): Promise<void>;
    dismissMigrationNotice(): Promise<void>;
    dismissPreferencesReset(): Promise<void>;
    updatePreferences(patch: LauncherPreferencesPatch): Promise<void>;
  };
  readonly settings: {
    update(patch: LauncherSettingsPatch): Promise<void>;
    reset(): Promise<void>;
  };
  readonly tools: {
    setMasterEnabled(enabled: boolean): Promise<void>;
    setFeature(input: GlobalToolUpdate): Promise<void>;
    captureShortcut(tool: GlobalTool): Promise<LauncherShortcutCaptureResult>;
    replaceShortcut(input: ShortcutReplacement): Promise<void>;
    restoreDefaultShortcut(tool: GlobalTool): Promise<void>;
    restartToApply(): Promise<void>;
  };
  readonly gameFiles: {
    info(): Promise<CacheInfo>;
    retryPreparation(): Promise<void>;
    repair(): Promise<void>;
    pauseDownload(): Promise<void>;
    resumeDownload(): Promise<void>;
    resetAndRestart(): Promise<void>;
  };
  readonly updates: {
    check(): Promise<void>;
    restartAndInstall(): Promise<void>;
  };
  readonly external: {
    open(kind: LauncherExternalLink): Promise<void>;
    revealLogs(): Promise<void>;
  };
}

export function parseGlobalTool(value: unknown): GlobalTool {
  if (typeof value === "string" && GLOBAL_TOOLS.includes(value as GlobalTool)) return value as GlobalTool;
  throw new Error("Tool is invalid");
}

export function parseLauncherExternalLink(value: unknown): LauncherExternalLink {
  if (typeof value === "string" && LAUNCHER_EXTERNAL_LINKS.includes(value as LauncherExternalLink)) return value as LauncherExternalLink;
  throw new Error("external link is invalid");
}

export function parseLauncherSettingsPatch(value: unknown): LauncherSettingsPatch {
  const source = exactObject(value, [
    "autoCheckUpdates", "updateTrack", "renderScale", "extendedMemoryEnabled", "showDiagnostics",
    "cartographyOverlayEnabled", "cartographyGridEnabled", "cartographyRevealMode",
    "cartographyPresetLibrary", "cartographyWalkabilityOpacity", "cartographyGridOpacity",
    "cartographyControlIdleOpacity",
  ], "launcher settings patch");
  const result: {
    autoCheckUpdates?: boolean;
    updateTrack?: AppSettings["updateTrack"];
    renderScale?: AppSettings["renderScale"];
    extendedMemoryEnabled?: boolean;
    showDiagnostics?: boolean;
    cartographyOverlayEnabled?: boolean;
    cartographyGridEnabled?: boolean;
    cartographyRevealMode?: AppSettings["cartographyRevealMode"];
    cartographyPresetLibrary?: CartographyPresetLibrary;
    cartographyWalkabilityOpacity?: number;
    cartographyGridOpacity?: number;
    cartographyControlIdleOpacity?: number;
  } = {};
  for (const key of [
    "autoCheckUpdates", "extendedMemoryEnabled", "showDiagnostics",
    "cartographyOverlayEnabled", "cartographyGridEnabled",
  ] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== "boolean") throw new Error(`${key} must be a boolean`);
    result[key] = source[key];
  }
  if (source.updateTrack !== undefined) {
    if (source.updateTrack !== "stable" && source.updateTrack !== "beta") throw new Error("update track is invalid");
    result.updateTrack = source.updateTrack;
  }
  if (source.renderScale !== undefined) {
    if (
      typeof source.renderScale !== "number"
      || !RENDER_SCALES.includes(source.renderScale as AppSettings["renderScale"])
    ) throw new Error("render scale is invalid");
    result.renderScale = source.renderScale as AppSettings["renderScale"];
  }
  if (source.cartographyRevealMode !== undefined) {
    if (!["off", "normal", "birds-eye"].includes(source.cartographyRevealMode as string)) throw new Error("cartography reveal mode is invalid");
    result.cartographyRevealMode = source.cartographyRevealMode as AppSettings["cartographyRevealMode"];
  }
  if (source.cartographyPresetLibrary !== undefined) {
    const library = normaliseCartographyPresetLibrary(source.cartographyPresetLibrary);
    if (library === null) throw new Error("cartography preset library is invalid");
    result.cartographyPresetLibrary = library;
  }
  for (const [key, minimum, maximum] of [
    ["cartographyWalkabilityOpacity", CARTOGRAPHY_OPACITY_MIN, CARTOGRAPHY_OPACITY_MAX],
    ["cartographyGridOpacity", CARTOGRAPHY_OPACITY_MIN, CARTOGRAPHY_OPACITY_MAX],
    ["cartographyControlIdleOpacity", CARTOGRAPHY_CONTROL_IDLE_OPACITY_MIN, CARTOGRAPHY_CONTROL_IDLE_OPACITY_MAX],
  ] as const) {
    const candidate = source[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) throw new Error(`${key} is invalid`);
    result[key] = candidate;
  }
  return result;
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
