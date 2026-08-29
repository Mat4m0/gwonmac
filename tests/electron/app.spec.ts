import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { electronBin, root } from "./fixtures.mjs";

/** How a spawned Electron process ended, as `child_process` reports it. */
type ProcessExit = { code: number | null; signal: NodeJS.Signals | null };

/**
 * The socket host ArenaNet's glue reaches through `Module`.
 *
 * `Window.Module` in `src/renderer/gw-native.d.ts` declares only the canvas
 * member, so the surface `src/renderer/harness.ts` installs is named here.
 * Widening that declaration is a renderer change, not a test one.
 */
type GameSocket = {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  send(data: Uint8Array): Promise<void>;
  close(): void;
};
type GameModule = { socket?: { connect(destination: string): GameSocket } };

/**
 * A window carrying the probe the window-state test installs on the page. It
 * is the test's own observation point rather than part of the application's
 * surface, so it stays out of the global `Window` declaration.
 */
type ResetProbeWindow = Window & { __windowResetReleasedInput?: boolean };

/**
 * The environment every launch here runs under. `process.env` types every
 * value `string | undefined` and Playwright's launch environment takes defined
 * values only; `ELECTRON_RUN_AS_NODE` is dropped because it would start the
 * binary as a plain Node process, with no application and no window.
 */
const launchEnv = (
  overrides: Record<string, string>,
): Record<string, string> => {
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && name !== "ELECTRON_RUN_AS_NODE") {
      inherited[name] = value;
    }
  }
  return {
    ...inherited,
    GW_TEST_ALLOW_UNREADY_LAUNCH: "1",
    ...overrides,
  };
};

/**
 * Global setup verifies the executable before any spec starts.
 */
const launch = (userData: string, env: Record<string, string>) =>
  electron.launch({
    cwd: root,
    args: [".", `--user-data-dir=${userData}`],
    env,
    executablePath: electronBin,
  });

async function openFirstProfile(app: ElectronApplication) {
  const launcher = await app.firstWindow({ timeout: 30_000 });
  await launcher.waitForLoadState("domcontentloaded");
  const profileId = await launcher.evaluate(async () =>
    (await window.launcherNative.state.get()).profiles.find(
      (profile) => !profile.archived,
    )?.id,
  );
  if (!profileId) throw new Error("launcher has no active profile");
  const game = app.waitForEvent("window", { timeout: 30_000 });
  await launcher.evaluate((id) => window.launcherNative.profiles.play([id]), profileId);
  const page = await game;
  await page.waitForLoadState("domcontentloaded");
  return page;
}

test.describe("Electron application", () => {
  test("a second instance exits and reveals the primary window", async () => {
    const env = launchEnv({
      GW_REQUIRE_CACHED_CLIENT: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-single-instance-e2e-"));
    const app = await launch(userData, env);
    try {
      await app.firstWindow({ timeout: 30_000 });
      expect(await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.minimize();
        win?.hide();
      });

      const second = spawn(
        electronBin,
        [".", `--user-data-dir=${userData}`],
        { cwd: root, env, stdio: "ignore" },
      );
      const exit = await new Promise<ProcessExit>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("second instance did not exit")),
          10_000,
        );
        second.once("error", reject);
        second.once("exit", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      });

      expect(exit).toEqual({ code: 0, signal: null });
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => {
            const windows = BrowserWindow.getAllWindows();
            return {
              count: windows.length,
              minimized: windows[0]?.isMinimized() ?? true,
              visible: windows[0]?.isVisible() ?? false,
            };
          }),
        )
        .toEqual({ count: 1, minimized: false, visible: true });
    } finally {
      await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("a startup failure exits nonzero and releases the instance lock", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "gw-startup-failure-e2e-"));
    const baseEnv = launchEnv({
      GW_REQUIRE_CACHED_CLIENT: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const failed = spawn(
      electronBin,
      [".", `--user-data-dir=${userData}`],
      {
        cwd: root,
        env: { ...baseEnv, GW_TEST_STARTUP_FAILURE: "1" },
        stdio: "ignore",
      },
    );
    try {
      const exit = await new Promise<ProcessExit>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("failed startup did not exit")),
          10_000,
        );
        failed.once("error", reject);
        failed.once("exit", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      });
      expect(exit).toEqual({ code: 1, signal: null });

      const diagnosticsDir = path.join(userData, "diagnostics");
      const events = (
        await Promise.all(
          (await readdir(diagnosticsDir))
            .filter((name) => name.endsWith(".jsonl"))
            .map((name) => readFile(path.join(diagnosticsDir, name), "utf8")),
        )
      ).join("\n");
      expect(events).toContain('"name":"app.startupFailed"');
      expect(events).toContain('"name":"quit.cleanupStarted"');
      expect(events).toContain('"name":"quit.cleanupCompleted"');

      // A successful launch with the same profile proves the failed primary did
      // not remain headless while holding Electron's singleton lock.
      const restarted = await launch(userData, baseEnv);
      try {
        await restarted.firstWindow({ timeout: 30_000 });
      } finally {
        await restarted.close().catch(() => undefined);
      }
    } finally {
      failed.kill();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("red X closes profile sockets and application quit exits cleanly", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", () => resolve());
    });
    const env = launchEnv({
      GW_REQUIRE_CACHED_CLIENT: "1",
      GW_TEST_SOCKET_LOOPBACK: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-electron-quit-e2e-"));
    let app: ElectronApplication | undefined;
    try {
      app = await launch(userData, env);
      const page = await openFirstProfile(app);
      // The socket host arrives behind a dynamic import, so it is not present
      // at domcontentloaded. Wait for the capability instead of racing it.
      await page.waitForFunction(
        () => (window.Module as GameModule | undefined)?.socket !== undefined,
      );
      await page.evaluate(async () => {
        const host = (window.Module as GameModule | undefined)?.socket;
        if (!host) throw new Error("the game module published no socket host");
        const sock = host.connect("127.0.0.1:6112");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("socket did not open")), 5_000);
          sock.onopen = () => {
            clearTimeout(timer);
            resolve();
          };
          sock.onclose = () => {
            clearTimeout(timer);
            reject(new Error("socket closed before opening"));
          };
        });
      });
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.getMenuItemById("start-performance-capture")
          ?.click();
      });
      const electronProcess = app.process();
      const exited = new Promise<ProcessExit>((resolve) => {
        electronProcess.once("exit", (code, signal) => resolve({ code, signal }));
      });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL() === "gw://app/")
          ?.close();
      }).catch(() => undefined);
      await expect.poll(() => app?.windows().filter((win) => win.url() === "gw://app/").length)
        .toBe(0);
      await app.evaluate(({ app: electronApp }) => electronApp.quit());
      const result = await exited;
      expect(result).toEqual({ code: 0, signal: null });

      const diagnosticsDir = path.join(userData, "diagnostics");
      const sessionFiles = (await readdir(diagnosticsDir))
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => path.join(diagnosticsDir, name));
      const events = (
        await Promise.all(sessionFiles.map((file) => readFile(file, "utf8")))
      ).join("\n");
      expect(events).toContain('"name":"window.closeRequested"');
      expect(events).toContain('"name":"app.beforeQuit"');
      expect(events).toContain('"name":"quit.cleanupStarted"');
      expect(events).toContain('"name":"quit.cleanupCompleted"');
      expect(events).toContain('"reason":"owner-gone"');
      expect(events).not.toContain('"name":"app.uncaughtException"');
      expect(events).not.toContain('"name":"renderer.recoveryScheduled"');
      expect(events).not.toContain("Object has been destroyed");
    } finally {
      await app?.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true });
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  test("persists fullscreen and normal bounds, then resets safely", async () => {
    // No GW_BACKGROUND_LAUNCH: setFullScreen is unreliable on a non-key window.
    const env = launchEnv({ GW_REQUIRE_CACHED_CLIENT: "1" });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-window-state-e2e-"));
    // Exercise the adopted released owner whose state remains at the root.
    await writeFile(path.join(userData, "settings.json"), "{}", { mode: 0o600 });
    const closeCleanly = async (runningApp: ElectronApplication) => {
      const processHandle = runningApp.process();
      const exited = new Promise<ProcessExit>((resolve) => {
        processHandle.once("exit", (code, signal) => resolve({ code, signal }));
      });
      await runningApp.evaluate(({ app: electronApp, BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL() === "gw://app/")
          ?.close();
        electronApp.quit();
      }).catch(() => undefined);
      expect(await exited).toEqual({ code: 0, signal: null });
    };

    let app = await launch(userData, env);
    try {
      await openFirstProfile(app);
      await app.evaluate(({ app: electronApp, BrowserWindow }) =>
        new Promise<void>((resolve, reject) => {
          const win = BrowserWindow.getAllWindows()
            .find((candidate) => candidate.webContents.getURL() === "gw://app/");
          if (!win) {
            reject(new Error("window missing"));
            return;
          }
          if (win.isFocused()) {
            resolve();
            return;
          }
          const focused = () => {
            clearTimeout(timeout);
            resolve();
          };
          const timeout = setTimeout(() => {
            win.removeListener("focus", focused);
            reject(new Error("window did not receive focus"));
          }, 5_000);
          win.once("focus", focused);
          win.show();
          electronApp.focus({ steal: true });
          win.focus();
        }));
      const statePath = path.join(userData, "window-state.json");
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()
          .find((candidate) => candidate.webContents.getURL() === "gw://app/");
        if (!win) throw new Error("window missing");
        win.setBounds({ x: 120, y: 90, width: 960, height: 700 });
      });
      await expect.poll(async () => {
        try {
          const saved = JSON.parse(await readFile(statePath, "utf8")) as {
            bounds?: unknown;
            mode?: unknown;
          };
          return saved.mode === "normal" ? saved.bounds : null;
        } catch {
          return null;
        }
      }).not.toBeNull();
      const normalBounds = (JSON.parse(await readFile(statePath, "utf8")) as {
        bounds: { x: number; y: number; width: number; height: number };
      }).bounds;
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()
          .find((candidate) => candidate.webContents.getURL() === "gw://app/");
        if (!win) throw new Error("window missing");
        win.setFullScreen(true);
      });
      await expect.poll(async () => {
        try {
          return JSON.parse(await readFile(statePath, "utf8")).mode;
        } catch {
          return null;
        }
      }, { timeout: 15_000 }).toBe("fullscreen");
      await closeCleanly(app);

      expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
        formatVersion: 1,
        bounds: normalBounds,
        mode: "fullscreen",
        displayWorkArea: {
          x: expect.any(Number),
          y: expect.any(Number),
          width: expect.any(Number),
          height: expect.any(Number),
        },
      });
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);

      app = await launch(userData, env);
      const resetPage = await openFirstProfile(app);
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((win) => win.webContents.getURL() === "gw://app/")
              ?.isFullScreen()),
        )
        .toBe(true);
      // AppKit can adjust a restored frame by a few pixels between processes.
      // The saved placement is gwonmac's invariant; unit tests own the exact
      // display-fitting calculation and this test proves startup preserves it.
      expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
        formatVersion: 1,
        bounds: normalBounds,
        mode: "fullscreen",
        displayWorkArea: {
          x: expect.any(Number),
          y: expect.any(Number),
          width: expect.any(Number),
          height: expect.any(Number),
        },
      });

      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()
          .find((candidate) => candidate.webContents.getURL() === "gw://app/");
        if (!win) throw new Error("window missing");
        win.show();
        electronApp.focus({ steal: true });
        win.focus();
      });
      await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((candidate) => candidate.webContents.getURL() === "gw://app/")
          ?.isFocused(),
      )).toBe(true);
      await resetPage.evaluate(() => {
        const probe = window as ResetProbeWindow;
        probe.__windowResetReleasedInput = false;
        probe.addEventListener("gw:input-reset", () => {
          probe.__windowResetReleasedInput = true;
        });
      });
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById("reset-window-state")?.click();
      });
      await expect
        .poll(() =>
          resetPage.evaluate(
            () => (window as ResetProbeWindow).__windowResetReleasedInput,
          ),
          { timeout: 15_000 },
        )
        .toBe(true);
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()
              .find((candidate) => candidate.webContents.getURL() === "gw://app/");
            return win && !win.isFullScreen() ? win.getBounds() : null;
          }),
          { timeout: 15_000 },
        )
        .not.toBeNull();
      await expect
        .poll(async () => {
          try {
            return JSON.parse(await readFile(statePath, "utf8")).mode;
          } catch {
            return null;
          }
        }, {
          timeout: 15_000,
        })
        .toBe("normal");
      const actualReset = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()
          .find((candidate) => candidate.webContents.getURL() === "gw://app/");
        if (!win) throw new Error("window missing");
        return win.getBounds();
      });
      const savedReset = JSON.parse(await readFile(statePath, "utf8")) as {
        formatVersion: number;
        bounds: typeof actualReset;
        displayWorkArea: typeof actualReset;
        mode: string;
      };
      expect(
        await app.evaluate(({ screen }, bounds) =>
          screen.getAllDisplays().some(({ workArea }) =>
            bounds.x >= workArea.x
            && bounds.y >= workArea.y
            && bounds.x + bounds.width <= workArea.x + workArea.width
            && bounds.y + bounds.height <= workArea.y + workArea.height
          ), actualReset),
      ).toBe(true);
      expect(savedReset).toMatchObject({ formatVersion: 1, mode: "normal" });
      expect(await app.evaluate(({ screen }, bounds) =>
        screen.getAllDisplays().some(({ workArea }) =>
          bounds.x >= workArea.x
          && bounds.y >= workArea.y
          && bounds.x + bounds.width <= workArea.x + workArea.width
          && bounds.y + bounds.height <= workArea.y + workArea.height
        ), savedReset.bounds)).toBe(true);
      await closeCleanly(app);
    } finally {
      await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("compacts WASM-backed socket views before crossing Electron", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on("data", (data) => received.push(Buffer.from(data)));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", () => resolve());
    });
    const env = launchEnv({
      GW_REQUIRE_CACHED_CLIENT: "1",
      GW_TEST_SOCKET_LOOPBACK: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-electron-socket-e2e-"));
    let app: ElectronApplication | undefined;
    try {
      app = await launch(userData, env);
      const page = await openFirstProfile(app);
      await page.waitForFunction(
        () => (window.Module as GameModule | undefined)?.socket !== undefined,
      );
      const externalBefore = await app.evaluate(() => process.memoryUsage().external);
      const result = await page.evaluate(async () => {
        const host = (window.Module as GameModule | undefined)?.socket;
        if (!host) throw new Error("the game module published no socket host");
        const sock = host.connect("127.0.0.1:6112");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("socket did not open")),
            5_000,
          );
          sock.onopen = () => {
            clearTimeout(timer);
            resolve();
          };
          sock.onclose = () => {
            clearTimeout(timer);
            reject(new Error("socket closed before opening"));
          };
        });
        const backing = new Uint8Array(64 * 1024 * 1024);
        const view = backing.subarray(backing.byteLength - 21);
        for (let index = 0; index < view.length; index++) view[index] = index;
        for (let index = 0; index < 20; index++) {
          await sock.send(view);
          if (index < 19) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        sock.close();
        await window.gwDiagnostics.flush();
        return {
          backingBytes: view.buffer.byteLength,
          payloadBytes: view.byteLength,
          summary: await window.gwNative.diagnostics.current(),
        };
      });
      await expect
        .poll(() => received.reduce((sum, chunk) => sum + chunk.byteLength, 0))
        .toBe(420);
      const payload = Buffer.concat(received);
      expect([...payload.subarray(0, 21)]).toEqual(
        Array.from({ length: 21 }, (_value, index) => index),
      );
      const externalAfter = await app.evaluate(() => process.memoryUsage().external);
      expect(result.backingBytes).toBe(64 * 1024 * 1024);
      expect(result.payloadBytes).toBe(21);
      expect(externalAfter - externalBefore).toBeLessThan(16 * 1024 * 1024);
      expect(result.summary.counters["socket.rendererSendCalls"]).toBe(20);
      expect(result.summary.counters["socket.rendererPayloadBytes"]).toBe(420);
      expect(
        result.summary.latest["socket.rendererPeakSourceBackingBytes"],
      ).toBe(64 * 1024 * 1024);
      expect(result.summary.counters["socket.rendererCompactBytes"]).toBe(420);
      expect(result.summary.counters["socket.ipcPayloadBytes"]).toBe(420);
      expect(result.summary.counters["socket.ipcBackingBytes"]).toBe(420);
      expect(result.summary.counters["socket.sendCalls"]).toBe(20);
      expect(result.summary.counters["socket.sendPayloadBytes"]).toBe(420);
      // A histogram the recorder never wrote reads `undefined` here and fails
      // the assertion, which is what a missing measurement should do.
      expect(result.summary.histograms["socket.writeCallback"]?.count).toBe(20);
      expect(result.summary.histograms["socket.rendererSync"]?.count).toBe(20);
      expect(result.summary.histograms["socket.rendererSettle"]?.count).toBe(20);
      expect(result.summary.latest["socket.activeWrites"]).toBe(0);
      expect(result.summary.latest["socket.queuedBytes"]).toBe(0);
      expect(result.summary.latest["socket.peakActiveWrites"]).toBeGreaterThanOrEqual(1);
      expect(result.summary.latest["socket.peakQueuedBytes"]).toBeGreaterThanOrEqual(21);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true });
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  test("unofficial builds keep login volatile without deleting retired secrets", async () => {
    const env = launchEnv({
      GW_REQUIRE_CACHED_CLIENT: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-credentials-e2e-"));
    const settings = JSON.stringify({ autoCheckUpdates: false });
    await writeFile(path.join(userData, "settings.json"), settings);
    const windowState = JSON.stringify({
      bounds: { x: 120, y: 64, width: 1024, height: 768 },
      mode: "normal",
    });
    await writeFile(path.join(userData, "window-state.json"), windowState);
    await writeFile(path.join(userData, "credentials.bin"), "retired-credentials");
    await writeFile(path.join(userData, "steam-session.bin"), "retired-steam");

    let app = await launch(userData, env);
    try {
      const page = await openFirstProfile(app);
      await page.evaluate(() =>
        window.gwNative.credentials.save({
          username: "relaunch@example.invalid",
          password: "relaunch-password",
        }),
      );
      expect(await page.evaluate(() => window.gwNative.credentials.load())).toEqual({
        username: "relaunch@example.invalid",
        password: "relaunch-password",
      });
      expect(await readFile(path.join(userData, "credentials.bin"), "utf8"))
        .toBe("retired-credentials");
      expect(await readFile(path.join(userData, "steam-session.bin"), "utf8"))
        .toBe("retired-steam");
      expect(await readFile(path.join(userData, "settings.json"), "utf8")).toBe(settings);
      expect(await readFile(path.join(userData, "window-state.json"), "utf8"))
        .toBe(windowState);
      await app.evaluate(({ app: electronApp }) => electronApp.quit());
      await app.close().catch(() => undefined);

      app = await launch(userData, env);
      const relaunchedPage = await openFirstProfile(app);
      expect(await relaunchedPage.evaluate(() =>
        window.gwNative.credentials.load())).toBeNull();
      expect(await readFile(path.join(userData, "credentials.bin"), "utf8"))
        .toBe("retired-credentials");
      expect(await readFile(path.join(userData, "steam-session.bin"), "utf8"))
        .toBe("retired-steam");
      expect(await readFile(path.join(userData, "settings.json"), "utf8")).toBe(settings);
    } finally {
      await app.close().catch(() => {});
      await rm(userData, { recursive: true, force: true });
    }
  });

});
