/**
 * Registers only the unified launcher's validated IPC commands. The dedicated
 * preload exposes this vocabulary; game preloads never receive these methods.
 */
import type { BrowserWindow } from "electron";
import type { LauncherSnapshot, LauncherPreferencesPatch } from "../shared/launcher-contracts.js";
import { LAUNCHER_IPC, parseLauncherPreferencesPatch } from "../shared/launcher-contracts.js";
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
  readonly snapshot: () => LauncherSnapshot;
  readonly create: (name: string) => Promise<void>;
  readonly setSelection: (ids: readonly ProfileId[]) => Promise<void>;
  readonly play: (ids: readonly ProfileId[]) => Promise<void>;
  readonly show: (id: ProfileId) => Promise<void>;
  readonly cancelQueued: (ids: readonly ProfileId[]) => void;
  readonly dismissMigrationNotice: () => Promise<void>;
  readonly completeIntroduction: () => Promise<void>;
  readonly updatePreferences: (patch: LauncherPreferencesPatch) => Promise<void>;
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
const profileCreate = one((value: unknown): string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("profile request must be an object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "name")) throw new Error("profile request has an unknown field");
  return parseProfileName(source.name);
});

export function registerLauncherIpc(ctx: LauncherIpcContext): void {
  registerNamedChannelDefinitions(ctx.windows, LAUNCHER_IPC, {
    stateGet: channel(nothing, () => ctx.snapshot(), "launcher"),
    profilesCreate: channel(profileCreate, (_win, name) => ctx.create(name), "launcher"),
    profilesSetSelection: channel(profileIds, (_win, ids) => ctx.setSelection(ids), "launcher"),
    profilesPlay: channel(profileIds, (_win, ids) => ctx.play(ids), "launcher"),
    profilesShow: channel(profileId, (_win, id) => ctx.show(id), "launcher"),
    profilesCancelQueued: channel(profileIds, (_win, ids) => ctx.cancelQueued(ids), "launcher"),
    experienceDismissMigration: channel(nothing, () => ctx.dismissMigrationNotice(), "launcher"),
    experienceCompleteIntroduction: channel(nothing, () => ctx.completeIntroduction(), "launcher"),
    experienceUpdatePreferences: channel(one(parseLauncherPreferencesPatch), (_win, patch) => ctx.updatePreferences(patch), "launcher"),
    updatesCheck: channel(nothing, () => ctx.checkUpdates(), "launcher"),
    updatesRestartAndInstall: channel(nothing, (win) => ctx.restartAndInstall(win), "launcher"),
  });
}
