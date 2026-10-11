/** Executes the built launcher preload and proves its complete narrow surface. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import type { LauncherNativeApi, SettingsNativeApi } from "../../src/shared/launcher-contracts.ts";
import { LAUNCHER_IPC } from "../../src/shared/launcher-contracts.ts";
import { LEGACY_PRIMARY_PROFILE_ID } from "../../src/shared/multiple-accounts.ts";

type Listener = (event: unknown, value: unknown) => void;

/** Runs one built preload in a vm with a recording `electron` stand-in. */
async function loadPreload<Api>(file: string) {
  const source = await readFile(path.resolve(import.meta.dirname, "../../build/preload", file), "utf8");
  const invoked: Array<{ channel: string; args: unknown[] }> = [];
  const listeners = new Map<string, Listener[]>();
  let worldName = "";
  let api: Api | undefined;
  vm.runInNewContext(source, {
    require(name: string) {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name: string, value: Api) {
            worldName = name;
            api = value;
          },
        },
        ipcRenderer: {
          invoke(channel: string, ...args: unknown[]) {
            invoked.push({ channel, args });
            return Promise.resolve(undefined);
          },
          on(channel: string, listener: Listener) {
            listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
          },
          removeListener(channel: string, listener: Listener) {
            listeners.set(channel, (listeners.get(channel) ?? []).filter((item) => item !== listener));
          },
        },
      };
    },
  });
  assert.ok(api);
  return { api, worldName, invoked, listeners };
}

const channelsOf = (invoked: Array<{ channel: string }>) => new Set(invoked.map(({ channel }) => channel));

/** Channels only the Settings window may call; the launcher bridge must not reach any of them. */
const SETTINGS_WINDOW_CHANNELS = [
  LAUNCHER_IPC.settingsTargetGet,
  LAUNCHER_IPC.settingsUpdate,
  LAUNCHER_IPC.settingsReset,
  LAUNCHER_IPC.toolsSetMasterEnabled,
  LAUNCHER_IPC.toolsSetFeature,
  LAUNCHER_IPC.toolsCaptureShortcut,
  LAUNCHER_IPC.toolsReplaceShortcut,
  LAUNCHER_IPC.toolsRestartToApply,
  LAUNCHER_IPC.gameFilesInfo,
  LAUNCHER_IPC.gameFilesRepair,
  LAUNCHER_IPC.gameFilesPauseDownload,
  LAUNCHER_IPC.gameFilesResumeDownload,
  LAUNCHER_IPC.gameFilesResetAndRestart,
  LAUNCHER_IPC.texturePacksImport,
  LAUNCHER_IPC.texturePacksSelect,
  LAUNCHER_IPC.texturePacksRemove,
  LAUNCHER_IPC.externalRevealLogs,
  LAUNCHER_IPC.updatesCheck,
] as const;

const LISTENER_CHANNELS: ReadonlySet<string> = new Set([
  LAUNCHER_IPC.stateEvent,
  LAUNCHER_IPC.navigationEvent,
  LAUNCHER_IPC.settingsTargetEvent,
]);

test("the built launcher preload exposes every launcher command and no settings write", async () => {
  const { api, worldName, invoked, listeners } = await loadPreload<LauncherNativeApi>("preload-launcher.cjs");
  assert.equal(worldName, "launcherNative");
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.values(api).every(Object.isFrozen), true);
  assert.deepEqual(Object.keys(api).sort(), [
    "experience", "external", "navigation", "news", "profiles", "settings", "state", "updates",
  ]);
  assert.deepEqual(Object.keys(api.settings), ["open"]);
  assert.deepEqual(Object.keys(api.updates), ["restartAndInstall"]);
  assert.deepEqual(Object.keys(api.external), ["open"]);
  assert.deepEqual(Object.keys(api.experience).sort(), [
    "completeSetup", "dismissMigrationNotice", "dismissPreferencesReset", "updatePreferences",
  ]);

  const id = LEGACY_PRIMARY_PROFILE_ID;
  const stop = api.state.onChange(() => undefined);
  assert.equal(listeners.get(LAUNCHER_IPC.stateEvent)?.length, 1);
  stop();
  assert.equal(listeners.get(LAUNCHER_IPC.stateEvent)?.length, 0);
  const stopNavigation = api.navigation.onRequest(() => undefined);
  assert.equal(listeners.get(LAUNCHER_IPC.navigationEvent)?.length, 1);
  stopNavigation();
  assert.equal(listeners.get(LAUNCHER_IPC.navigationEvent)?.length, 0);

  await api.state.get();
  await api.profiles.create({ name: "Second account" });
  await api.profiles.update({ id, name: "Main", icon: "swords", color: "#496b58" });
  await api.profiles.setSelection([id]);
  await api.profiles.play([id]);
  await api.profiles.show(id);
  await api.profiles.cancelQueued([id]);
  await api.profiles.archive(id);
  await api.profiles.restore(id);
  await api.profiles.delete(id);
  await api.experience.completeSetup({ enableTools: false });
  await api.experience.dismissMigrationNotice();
  await api.experience.dismissPreferencesReset();
  await api.experience.updatePreferences({ content: { dailies: false } });
  await api.settings.open({ section: "game" });
  await api.news.open("gwonmac-2026-8-10");
  await api.updates.restartAndInstall();
  await api.external.open("github");

  // Every launcher channel is called exactly once from here, except the ones the Settings
  // window owns and the events the launcher listens to.
  const settingsOnly: readonly string[] = SETTINGS_WINDOW_CHANNELS;
  assert.deepEqual(
    channelsOf(invoked),
    new Set(Object.values(LAUNCHER_IPC).filter((channel) => (
      !LISTENER_CHANNELS.has(channel) && !settingsOnly.includes(channel)
    ))),
  );
  for (const channel of SETTINGS_WINDOW_CHANNELS) {
    assert.equal(channelsOf(invoked).has(channel), false, `${channel} reachable from the launcher`);
  }
});

test("the built settings preload exposes exactly the settings commands and no account command", async () => {
  const { api, worldName, invoked, listeners } = await loadPreload<SettingsNativeApi>("preload-settings.cjs");
  assert.equal(worldName, "settingsNative");
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.values(api).every(Object.isFrozen), true);
  assert.deepEqual(Object.keys(api).sort(), [
    "experience", "external", "gameFiles", "settings", "state", "target", "texturePacks", "tools", "updates",
  ]);
  assert.deepEqual(Object.keys(api.experience), ["updatePreferences"]);
  assert.deepEqual(Object.keys(api.settings).sort(), ["reset", "update"]);
  assert.deepEqual(Object.keys(api.external).sort(), ["open", "revealLogs"]);

  const stop = api.state.onChange(() => undefined);
  assert.equal(listeners.get(LAUNCHER_IPC.stateEvent)?.length, 1);
  stop();
  assert.equal(listeners.get(LAUNCHER_IPC.stateEvent)?.length, 0);
  const stopTarget = api.target.onRequest(() => undefined);
  assert.equal(listeners.get(LAUNCHER_IPC.settingsTargetEvent)?.length, 1);
  stopTarget();
  assert.equal(listeners.get(LAUNCHER_IPC.settingsTargetEvent)?.length, 0);

  const binding = { key: "t", shift: false, option: false } as const;
  await api.target.take();
  await api.state.get();
  await api.experience.updatePreferences({ content: { dailies: false } });
  await api.settings.update({ autoCheckUpdates: false });
  await api.settings.reset();
  await api.tools.setMasterEnabled(true);
  await api.tools.setFeature({ tool: "quick-travel", enabled: true });
  await api.tools.captureShortcut("travel.open");
  await api.tools.replaceShortcut({ action: "travel.open", binding });
  await api.tools.restartToApply();
  await api.gameFiles.info();
  await api.gameFiles.repair();
  await api.gameFiles.pauseDownload();
  await api.gameFiles.resumeDownload();
  await api.gameFiles.resetAndRestart();
  const texturePackId = "0123456789abcdef0123456789abcdef";
  await api.texturePacks.import();
  await api.texturePacks.select(texturePackId);
  await api.texturePacks.remove(texturePackId);
  await api.updates.check();
  await api.updates.restartAndInstall();
  await api.external.open("github");
  await api.external.revealLogs();

  const called = channelsOf(invoked);
  for (const channel of SETTINGS_WINDOW_CHANNELS) {
    assert.equal(called.has(channel), true, `${channel} is not exposed by the settings preload`);
  }
  // No account, profile, news or window-opening command is reachable from the Settings window.
  for (const channel of [
    LAUNCHER_IPC.profilesCreate, LAUNCHER_IPC.profilesUpdate, LAUNCHER_IPC.profilesSetSelection,
    LAUNCHER_IPC.profilesPlay, LAUNCHER_IPC.profilesShow, LAUNCHER_IPC.profilesCancelQueued,
    LAUNCHER_IPC.profilesArchive, LAUNCHER_IPC.profilesRestore, LAUNCHER_IPC.profilesDelete,
    LAUNCHER_IPC.experienceCompleteSetup, LAUNCHER_IPC.experienceDismissMigration,
    LAUNCHER_IPC.experienceDismissPreferencesReset, LAUNCHER_IPC.newsOpen, LAUNCHER_IPC.settingsOpen,
  ]) assert.equal(called.has(channel), false, `${channel} reachable from the Settings window`);
});
