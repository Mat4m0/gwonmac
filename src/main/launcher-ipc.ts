/**
 * Registers the validated IPC commands of the launcher and the Settings window.
 * Each channel names the roles that may call it: account actions belong to the
 * launcher, settings administration to the Settings window. Their dedicated
 * preloads expose this vocabulary; game preloads never receive these methods.
 */
import type { BrowserWindow } from "electron";
import type {
  GlobalToolUpdate,
  LauncherSettingsPatch,
  LauncherShortcutCaptureResult,
  LauncherSnapshot,
  LauncherPreferencesPatch,
  LauncherExternalLink,
  LauncherProfileCreateInput,
  LauncherProfileUpdate,
  ShortcutReplacement,
} from "../shared/launcher-contracts.js";
import {
  LAUNCHER_IPC,
  parseGlobalTool,
  parseLauncherExternalLink,
  parseLauncherNewsId,
  parseLauncherProfileAppearance,
  parseLauncherPreferencesPatch,
  parseLauncherSettingsPatch,
} from "../shared/launcher-contracts.js";
import type { CacheInfo } from "../shared/contracts.js";
import { isShortcutBinding, parseShortcutAction, type ShortcutAction } from "../shared/keyboard-shortcuts.js";
import {
  parseProfileId,
  parseProfileName,
  type ProfileId,
} from "../shared/multiple-accounts.js";
import { parseProfileIds } from "./accounts-ipc-values.js";
import {
  channel,
  registerNamedChannelDefinitions,
  type Parser,
} from "./ipc-channel-registry.js";
import type { WindowRegistry, WindowRole } from "./window-registry.js";
import { parseSettingsTarget, type SettingsTarget } from "../shared/settings-catalogue.js";
import { parseTexturePackId, type TexturePackImportResult } from "../shared/texture-packs.js";

export interface LauncherIpcContext {
  readonly windows: WindowRegistry;
  readonly connected: () => void;
  readonly snapshot: () => LauncherSnapshot;
  readonly create: (input: LauncherProfileCreateInput) => Promise<void>;
  readonly updateProfile: (input: LauncherProfileUpdate) => Promise<void>;
  readonly setSelection: (ids: readonly ProfileId[]) => Promise<void>;
  readonly play: (ids: readonly ProfileId[]) => Promise<void>;
  readonly show: (id: ProfileId) => Promise<void>;
  readonly cancelQueued: (ids: readonly ProfileId[]) => void;
  readonly archive: (id: ProfileId) => Promise<void>;
  readonly restore: (id: ProfileId) => Promise<void>;
  readonly delete: (win: BrowserWindow, id: ProfileId) => Promise<void>;
  readonly dismissMigrationNotice: () => Promise<void>;
  readonly dismissPreferencesReset: () => Promise<void>;
  readonly completeSetup: (enableTools: boolean) => Promise<void>;
  readonly updatePreferences: (patch: LauncherPreferencesPatch) => Promise<void>;
  readonly openSettings: (opener: BrowserWindow, target: SettingsTarget | undefined) => void;
  readonly takeSettingsTarget: () => SettingsTarget | null;
  readonly updateSettings: (patch: LauncherSettingsPatch) => Promise<void>;
  readonly resetSettings: (win: BrowserWindow) => Promise<void>;
  readonly setToolsMaster: (enabled: boolean) => Promise<void>;
  readonly setToolFeature: (input: GlobalToolUpdate) => Promise<void>;
  readonly captureShortcut: (win: BrowserWindow, action: ShortcutAction) => Promise<LauncherShortcutCaptureResult>;
  readonly replaceShortcut: (input: ShortcutReplacement) => Promise<void>;
  readonly restartToApplyTools: (win: BrowserWindow) => Promise<void>;
  readonly cacheInfo: () => Promise<CacheInfo>;
  readonly repairGameFiles: (win: BrowserWindow) => Promise<void>;
  readonly pauseDownload: () => Promise<void>;
  readonly resumeDownload: () => Promise<void>;
  readonly resetGameFiles: (win: BrowserWindow) => Promise<void>;
  readonly importTexturePack: (win: BrowserWindow) => Promise<TexturePackImportResult>;
  readonly selectTexturePack: (id: string | null) => Promise<void>;
  readonly removeTexturePack: (win: BrowserWindow, id: string) => Promise<void>;
  readonly openExternal: (kind: LauncherExternalLink) => Promise<void>;
  readonly openNews: (id: string) => Promise<void>;
  readonly revealLogs: () => void;
  readonly checkUpdates: () => Promise<void>;
  readonly restartAndInstall: (win: BrowserWindow) => Promise<void>;
}

const exact = (args: readonly unknown[], count: number): void => {
  if (args.length !== count) throw new Error(`expected ${count} IPC argument(s)`);
};
const nothing: Parser<void> = (args) => exact(args, 0);
const one = <Value>(parse: (value: unknown) => Value): Parser<Value> => (args) => {
  exact(args, 1);
  return parse(args[0]);
};
const optionalTarget: Parser<SettingsTarget | undefined> = (args) => {
  if (args.length === 0 || (args.length === 1 && args[0] === undefined)) return undefined;
  exact(args, 1);
  return parseSettingsTarget(args[0]);
};
const LAUNCHER: WindowRole = "launcher";
const SETTINGS: WindowRole = "settings";
const BOTH: readonly WindowRole[] = ["launcher", "settings"];
const profileIds = one(parseProfileIds);
const profileId = one(parseProfileId);
const profileCreate = one((value: unknown): LauncherProfileCreateInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("profile request must be an object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["name", "appearance"].includes(key))) throw new Error("profile request has an unknown field");
  const name = parseProfileName(source.name);
  if (source.appearance === undefined) return { name };
  return { name, appearance: parseLauncherProfileAppearance(source.appearance) };
});
const booleanValue = one((value: unknown): boolean => {
  if (typeof value !== "boolean") throw new Error("value must be a boolean");
  return value;
});
const nullableTexturePackId = one((value: unknown): string | null =>
  value === null ? null : parseTexturePackId(value));
const setup = one((value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("setup request must be an object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== 1 || typeof source.enableTools !== "boolean") throw new Error("setup request is invalid");
  return source.enableTools;
});
const profileUpdate = one((value: unknown): LauncherProfileUpdate => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("profile update must be an object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["id", "name", "icon", "color"].includes(key))) throw new Error("profile update has an unknown field");
  const id = parseProfileId(source.id);
  const name = parseProfileName(source.name);
  const appearance = parseLauncherProfileAppearance({ icon: source.icon, color: source.color });
  return { id, name, ...appearance };
});
const toolUpdate = one((value: unknown): GlobalToolUpdate => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool update must be an object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["tool", "enabled"].includes(key)) || typeof source.enabled !== "boolean") throw new Error("Tool update is invalid");
  return { tool: parseGlobalTool(source.tool), enabled: source.enabled };
});
const shortcutReplacement = one((value: unknown): ShortcutReplacement => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shortcut replacement must be an object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["action", "binding"].includes(key)) || (source.binding !== null && !isShortcutBinding(source.binding))) throw new Error("shortcut replacement is invalid");
  return { action: parseShortcutAction(source.action), binding: source.binding };
});

export function registerLauncherIpc(ctx: LauncherIpcContext): void {
  const connected = new WeakSet<BrowserWindow>();
  registerNamedChannelDefinitions(ctx.windows, LAUNCHER_IPC, {
    stateGet: channel(nothing, (win) => {
      // The launcher's first read ends its startup; the Settings window only reads.
      if (ctx.windows.contextForWebContents(win.webContents.id)?.role === "launcher" && !connected.has(win)) {
        connected.add(win);
        ctx.connected();
      }
      return ctx.snapshot();
    }, BOTH),
    profilesCreate: channel(profileCreate, (_win, input) => ctx.create(input), LAUNCHER),
    profilesUpdate: channel(profileUpdate, (_win, input) => ctx.updateProfile(input), LAUNCHER),
    profilesSetSelection: channel(profileIds, (_win, ids) => ctx.setSelection(ids), LAUNCHER),
    profilesPlay: channel(profileIds, (_win, ids) => ctx.play(ids), LAUNCHER),
    profilesShow: channel(profileId, (_win, id) => ctx.show(id), LAUNCHER),
    profilesCancelQueued: channel(profileIds, (_win, ids) => ctx.cancelQueued(ids), LAUNCHER),
    profilesArchive: channel(profileId, (_win, id) => ctx.archive(id), LAUNCHER),
    profilesRestore: channel(profileId, (_win, id) => ctx.restore(id), LAUNCHER),
    profilesDelete: channel(profileId, (win, id) => ctx.delete(win, id), LAUNCHER),
    experienceDismissMigration: channel(nothing, () => ctx.dismissMigrationNotice(), LAUNCHER),
    experienceDismissPreferencesReset: channel(nothing, () => ctx.dismissPreferencesReset(), LAUNCHER),
    experienceCompleteSetup: channel(setup, (_win, enableTools) => ctx.completeSetup(enableTools), LAUNCHER),
    experienceUpdatePreferences: channel(one(parseLauncherPreferencesPatch), (_win, patch) => ctx.updatePreferences(patch), BOTH),
    settingsOpen: channel(optionalTarget, (win, target) => ctx.openSettings(win, target), LAUNCHER),
    settingsTargetGet: channel(nothing, () => ctx.takeSettingsTarget(), SETTINGS),
    settingsUpdate: channel(one(parseLauncherSettingsPatch), (_win, patch) => ctx.updateSettings(patch), SETTINGS),
    settingsReset: channel(nothing, (win) => ctx.resetSettings(win), SETTINGS),
    toolsSetMasterEnabled: channel(booleanValue, (_win, enabled) => ctx.setToolsMaster(enabled), SETTINGS),
    toolsSetFeature: channel(toolUpdate, (_win, input) => ctx.setToolFeature(input), SETTINGS),
    toolsCaptureShortcut: channel(one(parseShortcutAction), (win, action) => ctx.captureShortcut(win, action), SETTINGS),
    toolsReplaceShortcut: channel(shortcutReplacement, (_win, input) => ctx.replaceShortcut(input), SETTINGS),
    toolsRestartToApply: channel(nothing, (win) => ctx.restartToApplyTools(win), SETTINGS),
    gameFilesInfo: channel(nothing, () => ctx.cacheInfo(), SETTINGS),
    gameFilesRepair: channel(nothing, (win) => ctx.repairGameFiles(win), SETTINGS),
    gameFilesPauseDownload: channel(nothing, () => ctx.pauseDownload(), SETTINGS),
    gameFilesResumeDownload: channel(nothing, () => ctx.resumeDownload(), SETTINGS),
    gameFilesResetAndRestart: channel(nothing, (win) => ctx.resetGameFiles(win), SETTINGS),
    newsOpen: channel(one(parseLauncherNewsId), (_win, id) => ctx.openNews(id), LAUNCHER),
    texturePacksImport: channel(nothing, (win) => ctx.importTexturePack(win), SETTINGS),
    texturePacksSelect: channel(nullableTexturePackId, (_win, id) => ctx.selectTexturePack(id), SETTINGS),
    texturePacksRemove: channel(one(parseTexturePackId), (win, id) => ctx.removeTexturePack(win, id), SETTINGS),
    externalOpen: channel(one(parseLauncherExternalLink), (_win, kind) => ctx.openExternal(kind), BOTH),
    externalRevealLogs: channel(nothing, () => ctx.revealLogs(), SETTINGS),
    updatesCheck: channel(nothing, () => ctx.checkUpdates(), SETTINGS),
    updatesRestartAndInstall: channel(nothing, (win) => ctx.restartAndInstall(win), BOTH),
  });
}
