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
import { RENDER_SCALES, UI_STYLES, UI_FONTS, CONTROLLER_PROMPT_STYLES, UI_PANEL_OPACITY_MIN, UI_PANEL_OPACITY_MAX } from "./contracts.js";
import {
  COMPASS_RANGE_OPACITY_MAX,
  COMPASS_RANGE_OPACITY_MIN,
  COMPASS_RANGE_THEMES,
  type CompassRangeTheme,
} from "./compass-ranges.js";
import { normaliseCustomUiTheme } from "./ui-theme.js";
import type { ErrorCode } from "./errors.js";
import {
  CARTOGRAPHY_CONTROL_IDLE_OPACITY_MAX,
  CARTOGRAPHY_CONTROL_IDLE_OPACITY_MIN,
  CARTOGRAPHY_OPACITY_MAX,
  CARTOGRAPHY_OPACITY_MIN,
  normaliseCartographyPresetLibrary,
  type CartographyPresetLibrary,
} from "./cartography-overlay.js";
import type { ShortcutAction, ShortcutBinding } from "./keyboard-shortcuts.js";
import type { FeatureId } from "./feature-contracts.js";
import { cloneSkillKeyBindings, isSkillKeyBindings } from "./skill-key-bindings.js";
import { cloneSkillCooldownColor, isSkillCooldownColor } from "./skill-cooldowns.js";
import type { ProfileId } from "./multiple-accounts.js";
import type {
  TexturePackImportResult,
  TexturePackSnapshot,
} from "./texture-packs.js";

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
  newsOpen: "gw:launcher:news:open",
  texturePacksImport: "gw:launcher:texturePacks:import",
  texturePacksSelect: "gw:launcher:texturePacks:select",
  texturePacksRemove: "gw:launcher:texturePacks:remove",
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
    eventNews: boolean;
    autoRotateNews: boolean;
  }>;
}

export type LauncherNewsSource = "game" | "event" | "launcher";
export type LauncherNewsInline = Readonly<{
  text: string;
  emphasis?: "strong" | "code";
  actionId?: string;
}>;
export type LauncherNewsBlock =
  | Readonly<{ type: "paragraph"; content: readonly LauncherNewsInline[] }>
  | Readonly<{ type: "heading"; text: string }>
  | Readonly<{ type: "list"; items: readonly (readonly LauncherNewsInline[])[] }>
  | Readonly<{ type: "image"; src: string; alt: string }>;
export interface LauncherNewsStory {
  readonly id: string;
  readonly source: LauncherNewsSource;
  readonly channel: "all" | "stable" | "beta";
  readonly title: string;
  readonly summary: string;
  readonly publishedAt: string;
  readonly featured: boolean;
  readonly action: "article" | "external";
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly body: readonly LauncherNewsBlock[];
}
export type LauncherNewsState =
  | Readonly<{ status: "loading"; stories: readonly LauncherNewsStory[] }>
  | Readonly<{ status: "ready"; stories: readonly LauncherNewsStory[]; refreshedAt: string }>
  | Readonly<{ status: "offline"; stories: readonly LauncherNewsStory[] }>;

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

export const GLOBAL_TOOLS = [
  "character-switch", "build-management", "quick-travel", "xunlai-storage", "quick-item-move",
  "trade-chat", "maps", "target-readout", "skill-key-labels", "skill-cooldowns",
  "chat-filters",
  "effect-timers",
] as const;
export type GlobalTool = (typeof GLOBAL_TOOLS)[number];
export const GLOBAL_TOOL_FEATURES = Object.freeze({
  "character-switch": "characterSwitch",
  "build-management": "buildLibrary",
  "quick-travel": "travel",
  "xunlai-storage": "xunlaiStorage",
  "quick-item-move": "quickItemMove",
  "trade-chat": "tradeChat",
  maps: "cartography",
  "target-readout": "targetReadout",
  "skill-key-labels": "skillKeyLabels",
  "skill-cooldowns": "skillCooldowns",
  "chat-filters": "chatFilters",
  "effect-timers": "effectTimers",
} satisfies Record<GlobalTool, FeatureId>);
export const LAUNCHER_EXTERNAL_LINKS = ["github", "bugReport", "featureRequest", "discord", "arenaNetSupport", "donate", "releases"] as const;
export type LauncherExternalLink = (typeof LAUNCHER_EXTERNAL_LINKS)[number];

export interface GlobalToolSetting {
  readonly enabled: boolean;
}

export type GlobalToolSettings = Readonly<Record<GlobalTool, GlobalToolSetting>>;

export interface LauncherSettings {
  readonly uiStyle: AppSettings["uiStyle"];
  readonly uiFont: AppSettings["uiFont"];
  readonly uiCustomTheme: AppSettings["uiCustomTheme"];
  readonly uiPanelOpacity: AppSettings["uiPanelOpacity"];
  readonly controllerPromptStyle: AppSettings["controllerPromptStyle"];
  readonly autoCheckUpdates: boolean;
  readonly updateTrack: AppSettings["updateTrack"];
  readonly renderScale: AppSettings["renderScale"];
  readonly extendedMemoryEnabled: boolean;
  readonly showDiagnostics: boolean;
  readonly autoRelogAfterReload: boolean;
  readonly characterSwitchProfession: boolean;
  readonly characterSwitchLevel: boolean;
  readonly characterSwitchLocation: boolean;
  readonly skillKeyBindings: AppSettings["skillKeyBindings"];
  readonly skillCooldownColor: AppSettings["skillCooldownColor"];
  readonly chatFilterAllyDrops: boolean;
  readonly chatFilterHallOfHeroes: boolean;
  readonly chatFilterTitleAchievements: boolean;
  readonly cartographyOverlayEnabled: boolean;
  readonly cartographyGridEnabled: boolean;
  readonly cartographyCompassGridEnabled: boolean;
  readonly compassRangeIndicatorsEnabled: boolean;
  readonly compassRangeEarshotEnabled: boolean;
  readonly compassRangeCastEnabled: boolean;
  readonly compassRangeSpiritEnabled: boolean;
  readonly compassRangeSpiritExtendedEnabled: boolean;
  readonly compassRangeEarshotOpacity: number;
  readonly compassRangeCastOpacity: number;
  readonly compassRangeSpiritOpacity: number;
  readonly compassRangeSpiritExtendedOpacity: number;
  readonly compassRangeTheme: CompassRangeTheme;
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
  readonly action: ShortcutAction;
  readonly binding: ShortcutBinding | null;
}
export type LauncherShortcutCaptureResult =
  | Readonly<{ status: "captured"; binding: ShortcutBinding }>
  | Readonly<{ status: "reserved" }>
  | Readonly<{ status: "conflict"; action: ShortcutAction; binding: ShortcutBinding }>
  | Readonly<{ status: "cleared" }>
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
  readonly shortcuts: Readonly<Record<ShortcutAction, ShortcutBinding | null>>;
  readonly texturePacks: TexturePackSnapshot;
  readonly profiles: readonly LauncherProfileSummary[];
  readonly selectedProfileIds: readonly ProfileId[];
  readonly preferences: LauncherPreferences;
  readonly news: LauncherNewsState;
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
    captureShortcut(action: ShortcutAction): Promise<LauncherShortcutCaptureResult>;
    replaceShortcut(input: ShortcutReplacement): Promise<void>;
    restoreDefaultShortcut(action: ShortcutAction): Promise<void>;
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
  readonly texturePacks: {
    import(): Promise<TexturePackImportResult>;
    select(id: string | null): Promise<void>;
    remove(id: string): Promise<void>;
  };
  readonly updates: {
    check(): Promise<void>;
    restartAndInstall(): Promise<void>;
  };
  readonly external: {
    open(kind: LauncherExternalLink): Promise<void>;
    revealLogs(): Promise<void>;
  };
  readonly news: {
    open(id: string): Promise<void>;
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

export function parseLauncherNewsId(value: unknown): string {
  if (typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value)) return value;
  throw new Error("news id is invalid");
}

export function parseLauncherSettingsPatch(value: unknown): LauncherSettingsPatch {
  const source = exactObject(value, [
    "uiStyle", "uiFont", "uiCustomTheme", "uiPanelOpacity", "controllerPromptStyle",
    "autoCheckUpdates", "updateTrack", "renderScale", "extendedMemoryEnabled", "showDiagnostics",
    "autoRelogAfterReload", "characterSwitchProfession", "characterSwitchLevel",
    "characterSwitchLocation", "skillKeyBindings", "skillCooldownColor",
    "chatFilterAllyDrops", "chatFilterHallOfHeroes", "chatFilterTitleAchievements",
    "cartographyOverlayEnabled", "cartographyGridEnabled", "cartographyCompassGridEnabled", "compassRangeIndicatorsEnabled",
    "compassRangeEarshotEnabled", "compassRangeCastEnabled", "compassRangeSpiritEnabled", "compassRangeSpiritExtendedEnabled",
    "compassRangeEarshotOpacity", "compassRangeCastOpacity", "compassRangeSpiritOpacity", "compassRangeSpiritExtendedOpacity",
    "compassRangeTheme",
    "cartographyRevealMode",
    "cartographyPresetLibrary", "cartographyWalkabilityOpacity", "cartographyGridOpacity",
    "cartographyControlIdleOpacity",
  ], "launcher settings patch");
  const result: { -readonly [K in keyof LauncherSettings]?: LauncherSettings[K] } = {};
  if (source.uiStyle !== undefined) {
    if (!UI_STYLES.includes(source.uiStyle as AppSettings["uiStyle"])) throw new Error("Panel style is invalid");
    result.uiStyle = source.uiStyle as AppSettings["uiStyle"];
  }
  if (source.uiFont !== undefined) {
    if (!UI_FONTS.includes(source.uiFont as AppSettings["uiFont"])) throw new Error("Panel font is invalid");
    result.uiFont = source.uiFont as AppSettings["uiFont"];
  }
  if (source.controllerPromptStyle !== undefined) {
    if (!CONTROLLER_PROMPT_STYLES.includes(source.controllerPromptStyle as AppSettings["controllerPromptStyle"])) throw new Error("Controller symbols are invalid");
    result.controllerPromptStyle = source.controllerPromptStyle as AppSettings["controllerPromptStyle"];
  }
  if (source.uiCustomTheme !== undefined) {
    const theme = normaliseCustomUiTheme(source.uiCustomTheme);
    if (!theme) throw new Error("Custom panel colors are invalid");
    result.uiCustomTheme = theme;
  }
  if (source.uiPanelOpacity !== undefined) {
    if (typeof source.uiPanelOpacity !== "number" || !Number.isInteger(source.uiPanelOpacity)
      || source.uiPanelOpacity < UI_PANEL_OPACITY_MIN || source.uiPanelOpacity > UI_PANEL_OPACITY_MAX) throw new Error("Panel opacity is invalid");
    result.uiPanelOpacity = source.uiPanelOpacity;
  }
  for (const key of [
    "autoCheckUpdates", "extendedMemoryEnabled", "showDiagnostics",
    "autoRelogAfterReload", "characterSwitchProfession", "characterSwitchLevel", "characterSwitchLocation",
    "chatFilterAllyDrops", "chatFilterHallOfHeroes", "chatFilterTitleAchievements",
    "cartographyOverlayEnabled", "cartographyGridEnabled", "cartographyCompassGridEnabled", "compassRangeIndicatorsEnabled",
    "compassRangeEarshotEnabled", "compassRangeCastEnabled", "compassRangeSpiritEnabled", "compassRangeSpiritExtendedEnabled",
  ] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== "boolean") throw new Error(`${key} must be a boolean`);
    result[key] = source[key];
  }
  if (source.skillKeyBindings !== undefined) {
    if (!isSkillKeyBindings(source.skillKeyBindings)) throw new Error("Skill key labels are invalid");
    result.skillKeyBindings = cloneSkillKeyBindings(source.skillKeyBindings);
  }
  if (source.skillCooldownColor !== undefined) {
    if (!isSkillCooldownColor(source.skillCooldownColor)) throw new Error("Cooldown color is invalid");
    result.skillCooldownColor = cloneSkillCooldownColor(source.skillCooldownColor);
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
  if (source.compassRangeTheme !== undefined) {
    if (!COMPASS_RANGE_THEMES.includes(source.compassRangeTheme as CompassRangeTheme)) throw new Error("Compass range theme is invalid");
    result.compassRangeTheme = source.compassRangeTheme as CompassRangeTheme;
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
    ["compassRangeEarshotOpacity", COMPASS_RANGE_OPACITY_MIN, COMPASS_RANGE_OPACITY_MAX],
    ["compassRangeCastOpacity", COMPASS_RANGE_OPACITY_MIN, COMPASS_RANGE_OPACITY_MAX],
    ["compassRangeSpiritOpacity", COMPASS_RANGE_OPACITY_MIN, COMPASS_RANGE_OPACITY_MAX],
    ["compassRangeSpiritExtendedOpacity", COMPASS_RANGE_OPACITY_MIN, COMPASS_RANGE_OPACITY_MAX],
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
    ["news", "dailies", "first", "officialNews", "reforgedNews", "eventNews", "autoRotateNews"],
    "launcher content patch",
  );
  const patch: {
    news?: boolean;
    dailies?: boolean;
    first?: LauncherContentKind;
    officialNews?: boolean;
    reforgedNews?: boolean;
    eventNews?: boolean;
    autoRotateNews?: boolean;
  } = {};
  for (const field of ["news", "dailies", "officialNews", "reforgedNews", "eventNews", "autoRotateNews"] as const) {
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
