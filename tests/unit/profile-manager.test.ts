import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileStore } from "../../src/main/core/profiles.js";
import { ProfileManager } from "../../src/main/profile-manager.js";

function fakeWindow() {
  return {
    minimized: false,
    visible: true,
    focused: 0,
    isMinimized() {
      return this.minimized;
    },
    restore() {
      this.minimized = false;
    },
    isVisible() {
      return this.visible;
    },
    show() {
      this.visible = true;
    },
    focus() {
      this.focused += 1;
    },
  };
}

test("profile manager serializes switching and derives lifecycle status", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gw-profile-manager-"));
  try {
    const store = new ProfileStore(root);
    const a = await store.create("Alpha");
    const b = await store.create("Beta");
    const first = fakeWindow();
    const games: { profileId: typeof a.id; window: ReturnType<typeof fakeWindow> }[] = [
      { profileId: a.id, window: first },
    ];
    let releaseClose = (): void => undefined;
    const closeBarrier = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const notifications: string[] = [];
    const launched: string[] = [];
    const manager = new ProfileManager({
      store,
      windows: {
        gameWindows: () => games as never,
      },
      close: async () => {
        await closeBarrier;
        games.splice(0);
      },
      confirmSwitch: async () => true,
      launch: async (profile) => {
        launched.push(profile.label);
        games.push({ profileId: profile.id, window: fakeWindow() });
      },
      restart: () => undefined,
      notify: () => notifications.push("changed"),
    });

    const switching = manager.launch(b.id);
    await new Promise(setImmediate);
    assert.deepEqual(
      (await manager.list()).map(({ label, status }) => ({ label, status })),
      [
        { label: "Alpha", status: "closing" },
        { label: "Beta", status: "starting" },
      ],
    );
    releaseClose();
    await switching;
    assert.deepEqual(launched, ["Beta"]);
    assert.deepEqual(
      (await manager.list()).map(({ label, status }) => ({ label, status })),
      [
        { label: "Alpha", status: "stopped" },
        { label: "Beta", status: "running" },
      ],
    );
    await manager.launch(b.id);
    assert.equal(games[0]!.window.focused, 1);
    assert.ok(notifications.length >= 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("profile manager keeps destructive profile actions stopped-only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gw-profile-manager-"));
  try {
    const store = new ProfileStore(root);
    const profile = await store.create("Alpha");
    const games = [{ profileId: profile.id, window: fakeWindow() }];
    let restarted = false;
    const manager = new ProfileManager({
      store,
      windows: { gameWindows: () => games as never },
      close: async () => undefined,
      launch: async () => undefined,
      confirmSwitch: async () => true,
      restart: () => {
        restarted = true;
      },
      notify: () => undefined,
    });
    await assert.rejects(manager.rename(profile.id, "Renamed"), /stopped/);
    await assert.rejects(manager.forgetSavedLogin(profile.id), /stopped/);
    await assert.rejects(manager.moveToTrash(profile.id), /stopped/);
    games.splice(0);
    await manager.moveToTrash(profile.id);
    assert.equal(restarted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
