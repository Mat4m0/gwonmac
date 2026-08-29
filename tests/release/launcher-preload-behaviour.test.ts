/** Executes the built launcher preload and proves its complete narrow surface. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import type { LauncherNativeApi } from "../../src/shared/launcher-contracts.ts";
import { LAUNCHER_IPC } from "../../src/shared/launcher-contracts.ts";
import { LEGACY_PRIMARY_PROFILE_ID } from "../../src/shared/multiple-accounts.ts";

const source = await readFile(
  path.resolve(import.meta.dirname, "../../build/preload/preload-launcher.cjs"),
  "utf8",
);

test("the built launcher preload exposes every launcher command and nothing else", async () => {
  const invoked: Array<{ channel: string; args: unknown[] }> = [];
  const listeners = new Map<string, Array<(event: unknown, value: unknown) => void>>();
  let worldName = "";
  let api: LauncherNativeApi | undefined;
  vm.runInNewContext(source, {
    require(name: string) {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name: string, value: LauncherNativeApi) {
            worldName = name;
            api = value;
          },
        },
        ipcRenderer: {
          invoke(channel: string, ...args: unknown[]) {
            invoked.push({ channel, args });
            return Promise.resolve(undefined);
          },
          on(channel: string, listener: (event: unknown, value: unknown) => void) {
            listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
          },
          removeListener(channel: string, listener: (event: unknown, value: unknown) => void) {
            listeners.set(channel, (listeners.get(channel) ?? []).filter((item) => item !== listener));
          },
        },
      };
    },
  });
  assert.equal(worldName, "launcherNative");
  assert.ok(api);
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.values(api).every(Object.isFrozen), true);

  const id = LEGACY_PRIMARY_PROFILE_ID;
  const binding = { key: "t", shift: false, option: false } as const;
  const stop = api.state.onChange(() => undefined);
  assert.equal(listeners.get(LAUNCHER_IPC.stateEvent)?.length, 1);
  stop();
  assert.equal(listeners.get(LAUNCHER_IPC.stateEvent)?.length, 0);

  await api.state.get();
  await api.profiles.create({ name: "Second account" });
  await api.profiles.updateAppearance({ id, icon: "swords", color: "#496b58" });
  await api.profiles.setSelection([id]);
  await api.profiles.play([id]);
  await api.profiles.show(id);
  await api.profiles.cancelQueued([id]);
  await api.profiles.archive(id);
  await api.profiles.restore(id);
  await api.profiles.delete(id);
  await api.experience.completeSetup({ enableTools: false });
  await api.experience.completeIntroduction();
  await api.experience.replayIntroduction();
  await api.experience.dismissMigrationNotice();
  await api.experience.dismissPreferencesReset();
  await api.experience.updatePreferences({ content: { dailies: false } });
  await api.settings.update({ autoCheckUpdates: false });
  await api.settings.reset();
  await api.tools.setMasterEnabled(true);
  await api.tools.setFeature({ tool: "quick-travel", enabled: true });
  await api.tools.captureShortcut("quick-travel");
  await api.tools.replaceShortcut({ tool: "quick-travel", binding });
  await api.tools.restoreDefaultShortcut("quick-travel");
  await api.tools.restartToApply();
  await api.gameFiles.info();
  await api.gameFiles.retryPreparation();
  await api.gameFiles.repair();
  await api.gameFiles.pauseDownload();
  await api.gameFiles.resumeDownload();
  await api.gameFiles.resetAndRestart();
  await api.updates.check();
  await api.updates.restartAndInstall();
  await api.external.open("github");
  await api.external.revealLogs();

  assert.deepEqual(
    new Set(invoked.map(({ channel }) => channel)),
    new Set(Object.values(LAUNCHER_IPC).filter((channel) => channel !== LAUNCHER_IPC.stateEvent)),
  );
});
