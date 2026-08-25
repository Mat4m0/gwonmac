/** Main's reload owner must bind automatic-return intent to one new document. */
import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserWindow } from "electron";
import { GameReloader } from "../../src/main/game-reload.js";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.js";

function fixture(options: Readonly<{
  autoRelog?: boolean;
  settingsError?: Error;
}> = {}) {
  let routingId = 10;
  let loads = 0;
  let socketCloses = 0;
  const events: string[] = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      id: 7,
      isDestroyed: () => false,
      mainFrame: {
        get routingId() { return routingId; },
      },
    },
  } as unknown as BrowserWindow;
  const reloader = new GameReloader({
    sockets: { closeAll() { socketCloses += 1; } },
    async getSettings() {
      if (options.settingsError) throw options.settingsError;
      return {
        ...DEFAULT_SETTINGS,
        autoRelogAfterReload: options.autoRelog ?? true,
      };
    },
    diagnosticOwner: () => 3,
    record(event) { events.push(event.k); },
    sync: async () => "completed",
    async load() {
      loads += 1;
      routingId += 1;
    },
    rendererUrl: "gw://app/renderer/",
  });
  return {
    win,
    reloader,
    events,
    loads: () => loads,
    socketCloses: () => socketCloses,
  };
}

test("automatic-return intent is refused to the source and consumed by its replacement", async () => {
  const { reloader, win, loads, socketCloses } = fixture();
  const reload = reloader.reload(win, "menu");
  assert.equal(reloader.claimRelogIntent(win), false);
  await reload;
  assert.equal(loads(), 1);
  assert.equal(socketCloses(), 1);
  assert.equal(reloader.claimRelogIntent(win), true);
  assert.equal(reloader.claimRelogIntent(win), false);
});

test("a settings read failure performs no partial reload", async () => {
  const { reloader, win, loads, socketCloses, events } = fixture({
    settingsError: new Error("unreadable settings"),
  });
  await assert.rejects(reloader.reload(win, "command-q"), /unreadable settings/);
  assert.equal(loads(), 0);
  assert.equal(socketCloses(), 0);
  assert.deepEqual(events, []);
  assert.equal(reloader.claimRelogIntent(win), false);
});
