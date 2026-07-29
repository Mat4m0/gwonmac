import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  BrowserWindow,
  WebContents,
} from "electron";
import { AppRuntime } from "../../src/main/app-runtime.js";
import { WindowRegistry } from "../../src/main/window-registry.js";

class FakeContents extends EventEmitter {
  readonly id = 1;
  readonly sent: Array<[string, unknown]> = [];

  isDestroyed(): boolean {
    return false;
  }

  isCrashed(): boolean {
    return false;
  }

  send(channel: string, value: unknown): void {
    this.sent.push([channel, value]);
  }
}

class FakeWindow extends EventEmitter {
  readonly webContents = new FakeContents() as FakeContents & WebContents;

  isDestroyed(): boolean {
    return false;
  }
}

test("AppRuntime serializes settings and broadcasts through owned games", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gw-runtime-"));
  const settingsPath = path.join(root, "settings.json");
  const windows = new WindowRegistry();
  const window = new FakeWindow() as FakeWindow & BrowserWindow;
  windows.registerGame(window);
  const runtime = new AppRuntime(
    { shutdown: async () => {} },
    { closeAll: () => {} },
    windows,
    settingsPath,
    {
      flushWindowState: async () => {},
      clearBrowserCookies: async () => {},
      stopDiagnostics: async () => {},
      updateLongRunningTaskFeedback: () => {},
    },
  );

  await Promise.all([
    runtime.updateSettings({ renderScale: 1.5 }),
    runtime.updateSettings({ touchMode: "augment" }),
  ]);
  const saved = JSON.parse(await readFile(settingsPath, "utf8")) as {
    renderScale: number;
    touchMode: string;
  };
  assert.equal(saved.renderScale, 1.5);
  assert.equal(saved.touchMode, "augment");

  runtime.publishProgress({ phase: "error", errorCode: "wrong_profile" });
  runtime.publishPrefetch({ completedChunks: 2, totalChunks: 3 });
  assert.deepEqual(
    window.webContents.sent.map(([channel]) => channel),
    ["gw:progress:event", "gw:prefetch:event"],
  );
});

test("dispose is idempotent, ordered, and continues after cleanup failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gw-runtime-dispose-"));
  const order: string[] = [];
  const windows = new WindowRegistry();
  const runtime = new AppRuntime(
    {
      shutdown: async () => {
        order.push("client");
      },
    },
    {
      closeAll: () => {
        order.push("sockets");
      },
    },
    windows,
    path.join(root, "settings.json"),
    {
      flushWindowState: async () => {
        order.push("windows");
        throw new Error("window flush failed");
      },
      clearBrowserCookies: async () => {
        order.push("cookies");
      },
      stopDiagnostics: async () => {
        order.push("diagnostics");
      },
      updateLongRunningTaskFeedback: () => {},
    },
  );

  const first = runtime.dispose();
  const second = runtime.dispose();
  assert.equal(first, second);
  await assert.rejects(first, /runtime cleanup failed/u);
  assert.deepEqual(order, [
    "windows",
    "sockets",
    "client",
    "cookies",
    "diagnostics",
  ]);
  await assert.rejects(runtime.dispose(), /runtime cleanup failed/u);
  assert.deepEqual(order, [
    "windows",
    "sockets",
    "client",
    "cookies",
    "diagnostics",
  ]);
});

test("dispose waits for queued settings, window, and recorder writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gw-runtime-waits-"));
  const settingsPath = path.join(root, "settings.json");
  let releaseWindow!: () => void;
  let releaseRecorder!: () => void;
  const windowBarrier = new Promise<void>((resolve) => {
    releaseWindow = resolve;
  });
  const recorderBarrier = new Promise<void>((resolve) => {
    releaseRecorder = resolve;
  });
  const runtime = new AppRuntime(
    { shutdown: async () => {} },
    { closeAll: () => {} },
    new WindowRegistry(),
    settingsPath,
    {
      flushWindowState: () => windowBarrier,
      clearBrowserCookies: async () => {},
      stopDiagnostics: () => recorderBarrier,
      updateLongRunningTaskFeedback: () => {},
    },
  );

  const settings = runtime.updateSettings({ showDiagnostics: true });
  const disposal = runtime.dispose();
  let settled = false;
  void disposal.then(() => {
    settled = true;
  });
  await settings;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  releaseWindow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  releaseRecorder();
  await disposal;
  assert.equal(settled, true);
  const saved = JSON.parse(await readFile(settingsPath, "utf8")) as {
    showDiagnostics: boolean;
  };
  assert.equal(saved.showDiagnostics, true);
});
