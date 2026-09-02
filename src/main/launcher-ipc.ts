/**
 * Registers only the unified launcher's validated IPC commands. The dedicated
 * preload exposes this vocabulary; game preloads never receive these methods.
 */
import type { BrowserWindow } from "electron";
import type {
  GlobalTool,
  GlobalToolUpdate,
  LauncherSettingsPatch,
  LauncherShortcutCaptureResult,
  LauncherSnapshot,
  LauncherPreferencesPatch,
  LauncherExternalLink,
  LauncherProfileCreateInput,
  ProfileAppearanceUpdate,
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
import { isShortcutBinding } from "../shared/keyboard-shortcuts.js";
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
import type { WindowRegistry } from "./window-registry.js";

export interface LauncherIpcContext {
  readonly windows: WindowRegistry;
  readonly connected: () => void;
  readonly snapshot: () => LauncherSnapshot;
  readonly create: (input: LauncherProfileCreateInput) => Promise<void>;
  readonly updateAppearance: (input: ProfileAppearanceUpdate) => Promise<void>;
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
  readonly completeIntroduction: () => Promise<void>;
  readonly replayIntroduction: () => Promise<void>;
  readonly updatePreferences: (patch: LauncherPreferencesPatch) => Promise<void>;
  readonly updateSettings: (patch: LauncherSettingsPatch) => Promise<void>;
  readonly resetSettings: (win: BrowserWindow) => Promise<void>;
  readonly setToolsMaster: (enabled: boolean) => Promise<void>;
  readonly setToolFeature: (input: GlobalToolUpdate) => Promise<void>;
  readonly captureShortcut: (win: BrowserWindow, tool: GlobalTool) => Promise<LauncherShortcutCaptureResult>;
  readonly replaceShortcut: (input: ShortcutReplacement) => Promise<void>;
  readonly restoreDefaultShortcut: (tool: GlobalTool) => Promise<void>;
  readonly restartToApplyTools: (win: BrowserWindow) => Promise<void>;
  readonly cacheInfo: () => Promise<CacheInfo>;
  readonly retryPreparation: () => Promise<void>;
  readonly repairGameFiles: (win: BrowserWindow) => Promise<void>;
  readonly pauseDownload: () => Promise<void>;
  readonly resumeDownload: () => Promise<void>;
  readonly resetGameFiles: (win: BrowserWindow) => Promise<void>;
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
const setup = one((value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("setup request must be an object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== 1 || typeof source.enableTools !== "boolean") throw new Error("setup request is invalid");
  return source.enableTools;
});
const appearance = one((value: unknown): ProfileAppearanceUpdate => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("appearance must be an object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["id", "icon", "color"].includes(key))) throw new Error("appearance has an unknown field");
  const id = parseProfileId(source.id);
  if (typeof source.icon !== "string" || typeof source.color !== "string") throw new Error("appearance is invalid");
  return { id, icon: source.icon, color: source.color };
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
  if (Object.keys(source).some((key) => !["tool", "binding"].includes(key)) || !isShortcutBinding(source.binding)) throw new Error("shortcut replacement is invalid");
  return { tool: parseGlobalTool(source.tool), binding: source.binding };
});

export function registerLauncherIpc(ctx: LauncherIpcContext): void {
  const connected = new WeakSet<BrowserWindow>();
  registerNamedChannelDefinitions(ctx.windows, LAUNCHER_IPC, {
    stateGet: channel(nothing, (win) => {
      if (!connected.has(win)) {
        connected.add(win);
        ctx.connected();
      }
      return ctx.snapshot();
    }, "launcher"),
    profilesCreate: channel(profileCreate, (_win, input) => ctx.create(input), "launcher"),
    profilesUpdateAppearance: channel(appearance, (_win, input) => ctx.updateAppearance(input), "launcher"),
    profilesSetSelection: channel(profileIds, (_win, ids) => ctx.setSelection(ids), "launcher"),
    profilesPlay: channel(profileIds, (_win, ids) => ctx.play(ids), "launcher"),
    profilesShow: channel(profileId, (_win, id) => ctx.show(id), "launcher"),
    profilesCancelQueued: channel(profileIds, (_win, ids) => ctx.cancelQueued(ids), "launcher"),
    profilesArchive: channel(profileId, (_win, id) => ctx.archive(id), "launcher"),
    profilesRestore: channel(profileId, (_win, id) => ctx.restore(id), "launcher"),
    profilesDelete: channel(profileId, (win, id) => ctx.delete(win, id), "launcher"),
    experienceDismissMigration: channel(nothing, () => ctx.dismissMigrationNotice(), "launcher"),
    experienceDismissPreferencesReset: channel(nothing, () => ctx.dismissPreferencesReset(), "launcher"),
    experienceCompleteSetup: channel(setup, (_win, enableTools) => ctx.completeSetup(enableTools), "launcher"),
    experienceCompleteIntroduction: channel(nothing, () => ctx.completeIntroduction(), "launcher"),
    experienceReplayIntroduction: channel(nothing, () => ctx.replayIntroduction(), "launcher"),
    experienceUpdatePreferences: channel(one(parseLauncherPreferencesPatch), (_win, patch) => ctx.updatePreferences(patch), "launcher"),
    settingsUpdate: channel(one(parseLauncherSettingsPatch), (_win, patch) => ctx.updateSettings(patch), "launcher"),
    settingsReset: channel(nothing, (win) => ctx.resetSettings(win), "launcher"),
    toolsSetMasterEnabled: channel(booleanValue, (_win, enabled) => ctx.setToolsMaster(enabled), "launcher"),
    toolsSetFeature: channel(toolUpdate, (_win, input) => ctx.setToolFeature(input), "launcher"),
    toolsCaptureShortcut: channel(one(parseGlobalTool), (win, tool) => ctx.captureShortcut(win, tool), "launcher"),
    toolsReplaceShortcut: channel(shortcutReplacement, (_win, input) => ctx.replaceShortcut(input), "launcher"),
    toolsRestoreDefaultShortcut: channel(one(parseGlobalTool), (_win, tool) => ctx.restoreDefaultShortcut(tool), "launcher"),
    toolsRestartToApply: channel(nothing, (win) => ctx.restartToApplyTools(win), "launcher"),
    gameFilesInfo: channel(nothing, () => ctx.cacheInfo(), "launcher"),
    gameFilesRetryPreparation: channel(nothing, () => ctx.retryPreparation(), "launcher"),
    gameFilesRepair: channel(nothing, (win) => ctx.repairGameFiles(win), "launcher"),
    gameFilesPauseDownload: channel(nothing, () => ctx.pauseDownload(), "launcher"),
    gameFilesResumeDownload: channel(nothing, () => ctx.resumeDownload(), "launcher"),
    gameFilesResetAndRestart: channel(nothing, (win) => ctx.resetGameFiles(win), "launcher"),
    newsOpen: channel(one(parseLauncherNewsId), (_win, id) => ctx.openNews(id), "launcher"),
    externalOpen: channel(one(parseLauncherExternalLink), (_win, kind) => ctx.openExternal(kind), "launcher"),
    externalRevealLogs: channel(nothing, () => ctx.revealLogs(), "launcher"),
    updatesCheck: channel(nothing, () => ctx.checkUpdates(), "launcher"),
    updatesRestartAndInstall: channel(nothing, (win) => ctx.restartAndInstall(win), "launcher"),
  });
}
