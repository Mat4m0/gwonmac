import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
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
import { developmentElectronExecutable } from "../../scripts/electron-layout.js";
import { fitWindowStateToDisplays } from "../../src/main/core/window-state.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const main = path.join(root, "build/main/main.js");
const electronBin = developmentElectronExecutable(root);

async function onlyProfileFile(
  userData: string,
  name: string,
): Promise<string> {
  const entries = (await readdir(path.join(userData, "profiles"))).filter(
    (entry) => /^[0-9a-f]{32}$/u.test(entry),
  );
  if (entries.length !== 1) {
    throw new Error(`expected one profile, found ${entries.length}`);
  }
  return path.join(userData, "profiles", entries[0]!, name);
}

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
  return { ...inherited, GW_TEST_DIRECT_GAME: "1", ...overrides };
};

/**
 * An absent `electronBin` means Playwright resolves the binary itself, so the
 * property is omitted rather than passed as `undefined`.
 */
const launch = (userData: string, env: Record<string, string>) =>
  electron.launch({
    cwd: root,
    args: [".", `--user-data-dir=${userData}`],
    env,
    ...(existsSync(electronBin) ? { executablePath: electronBin } : {}),
  });

/**
 * Playwright launches the downloaded Linux development binary with
 * `--no-sandbox`: its chrome-sandbox helper is not installed setuid-root.
 * Raw child launches in this spec must match that test harness or Chromium
 * aborts with SIGTRAP before Electron can exercise the application contract.
 */
const rawLaunchArgs = (userData: string): string[] => [
  ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ".",
  `--user-data-dir=${userData}`,
];

test.describe("Electron application", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

  test("a second instance exits and reveals the primary window", async () => {
    test.skip(!existsSync(electronBin), "Electron application binary is unavailable");
    const env = launchEnv({
      GW_OFFLINE_SHELL: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-single-instance-e2e-"));
    const app = await launch(userData, env);
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      const applicationWindow = await app.browserWindow(page);
      await applicationWindow.evaluate((win) => {
        win.minimize();
        win.hide();
      });

      const second = spawn(
        electronBin,
        rawLaunchArgs(userData),
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
        .poll(() => applicationWindow.evaluate((win) => ({
          minimized: win.isMinimized(),
          visible: win.isVisible(),
        })))
        .toEqual({ minimized: false, visible: true });
    } finally {
      await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("a startup failure exits nonzero and releases the instance lock", async () => {
    test.skip(!existsSync(electronBin), "Electron application binary is unavailable");
    const userData = await mkdtemp(path.join(tmpdir(), "gw-startup-failure-e2e-"));
    const baseEnv = launchEnv({
      GW_OFFLINE_SHELL: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const failed = spawn(
      electronBin,
      rawLaunchArgs(userData),
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

  test("red X closes sockets and exits cleanly", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", () => resolve());
    });
    const env = launchEnv({
      GW_OFFLINE_SHELL: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-electron-quit-e2e-"));
    const app = await launch(userData, env);
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
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
      const applicationWindow = await app.browserWindow(page);
      await applicationWindow.evaluate((win) => win.close())
        .catch(() => undefined);
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
      expect(events).toContain('"reason":"owner"');
      expect(events).not.toContain('"name":"app.uncaughtException"');
      expect(events).not.toContain('"name":"renderer.recoveryScheduled"');
      expect(events).not.toContain("Object has been destroyed");
    } finally {
      await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true });
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  test("restores fullscreen and normal bounds, then resets safely", async () => {
    // No GW_BACKGROUND_LAUNCH: setFullScreen is unreliable on a non-key window.
    const env = launchEnv({ GW_OFFLINE_SHELL: "1" });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-window-state-e2e-"));
    const closeCleanly = async (runningApp: ElectronApplication) => {
      const processHandle = runningApp.process();
      const exited = new Promise<ProcessExit>((resolve) => {
        processHandle.once("exit", (code, signal) => resolve({ code, signal }));
      });
      const page = await runningApp.firstWindow({ timeout: 30_000 });
      const applicationWindow = await runningApp.browserWindow(page);
      await applicationWindow.evaluate((win) => win.close())
        .catch(() => undefined);
      expect(await exited).toEqual({ code: 0, signal: null });
    };

    let app = await launch(userData, env);
    try {
      const firstPage = await app.firstWindow({ timeout: 30_000 });
      const firstWindow = await app.browserWindow(firstPage);
      const normalBounds = await firstWindow.evaluate(async (win) => {
        win.setBounds({ x: 120, y: 90, width: 960, height: 700 });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const bounds = win.getBounds();
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5_000);
          win.once("enter-full-screen", () => {
            clearTimeout(timeout);
            resolve();
          });
          win.setFullScreen(true);
        });
        return bounds;
      });
      await closeCleanly(app);

      const statePath = await onlyProfileFile(userData, "window-state.json");
      expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
        formatVersion: 1,
        bounds: normalBounds,
        mode: "fullscreen",
      });
      if (process.platform !== "win32") {
        expect((await stat(statePath)).mode & 0o777).toBe(0o600);
      }

      app = await launch(userData, env);
      const resetPage = await app.firstWindow({ timeout: 30_000 });
      const resetWindow = await app.browserWindow(resetPage);
      const displays = await app.evaluate(({ screen }) => ({
        primary: { ...screen.getPrimaryDisplay().workArea },
        workAreas: screen.getAllDisplays().map(({ workArea }) => ({
          ...workArea,
        })),
      }));
      const expectedRestored = fitWindowStateToDisplays(
        { bounds: normalBounds, mode: "fullscreen" },
        displays.workAreas,
        displays.primary,
      ).bounds;
      await expect
        .poll(() => resetWindow.evaluate((win) => win.isFullScreen()))
        .toBe(true);
      expect(
        await resetWindow.evaluate((win) => win.getNormalBounds()),
      ).toEqual(expectedRestored);

      const expectedReset = await app.evaluate(({ screen }) => {
        const area = screen.getPrimaryDisplay().workArea;
        const width = Math.min(
          1280,
          Math.max(Math.min(800, area.width), area.width - 64),
        );
        const height = Math.min(
          800,
          Math.max(Math.min(600, area.height), area.height - 64),
        );
        return {
          x: Math.round(area.x + (area.width - width) / 2),
          y: Math.round(area.y + (area.height - height) / 2),
          width,
          height,
        };
      });
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
        )
        .toBe(true);
      await expect
        .poll(() =>
          resetWindow.evaluate((win) =>
            !win.isFullScreen() ? win.getBounds() : null),
          { timeout: 15_000 },
        )
        .not.toBeNull();
      const actualReset = await resetWindow.evaluate((win) => win.getBounds());
      expect(
        await app.evaluate(({ screen }, bounds) =>
          screen.getAllDisplays().some(({ workArea }) =>
            bounds.x >= workArea.x
            && bounds.y >= workArea.y
            && bounds.x + bounds.width <= workArea.x + workArea.width
            && bounds.y + bounds.height <= workArea.y + workArea.height
          ), actualReset),
      ).toBe(true);
      await expect
        .poll(
          async () => JSON.parse(await readFile(statePath, "utf8")),
          { timeout: 15_000 },
        )
        .toEqual({
          formatVersion: 1,
          bounds: expectedReset,
          mode: "normal",
        });
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
      GW_OFFLINE_SHELL: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-electron-socket-e2e-"));
    const app = await launch(userData, env);
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
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
      expect(result.summary.latest["socket.activeWrites"]).toBe(0);
      expect(result.summary.latest["socket.queuedBytes"]).toBe(0);
      expect(result.summary.latest["socket.peakActiveWrites"]).toBeGreaterThanOrEqual(1);
      expect(result.summary.latest["socket.peakQueuedBytes"]).toBeGreaterThanOrEqual(21);
      expect(
        result.summary.histograms["socket.rendererSync"]?.p95Us,
      ).toBeLessThanOrEqual(1_000);
      expect(
        result.summary.histograms["socket.rendererSettle"]?.p95Us,
      ).toBeLessThanOrEqual(8_000);
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  test("saved login survives an application relaunch without Keychain", async () => {
    const env = launchEnv({
      GW_OFFLINE_SHELL: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-credentials-e2e-"));

    let app = await launch(userData, env);
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator("#loading-credential-posture")).toContainText(
        process.platform === "darwin"
          ? "not Keychain-backed"
          : process.platform === "win32"
            ? "signed-in Windows account"
            : "Secret Service or KWallet",
      );
      await page.evaluate(() =>
        window.gwNative.credentials.save({
          username: "relaunch@example.invalid",
          password: "relaunch-password",
        }),
      );
      await app.close();

      app = await launch(userData, env);
      const relaunchedPage = await app.firstWindow({ timeout: 30_000 });
      await relaunchedPage.waitForLoadState("domcontentloaded");
      expect(
        await relaunchedPage.evaluate(() =>
          window.gwNative.credentials.load()),
      ).toEqual({
        state: "available",
        credentials: {
          username: "relaunch@example.invalid",
          password: "relaunch-password",
        },
      });
      await relaunchedPage.evaluate(() => window.gwNative.credentials.clear());
    } finally {
      await app.close().catch(() => {});
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("a raw preview ciphertext migrates only after Electron decrypts it", async () => {
    test.skip(process.platform !== "darwin", "legacy raw ciphertext was macOS-only");
    const env = launchEnv({
      GW_OFFLINE_SHELL: "1",
      GW_BACKGROUND_LAUNCH: "1",
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-credentials-legacy-"));
    const app = await launch(userData, env);
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
      const credentialsPath = await onlyProfileFile(
        userData,
        "credentials.bin",
      );
      const legacyCiphertext = await app.evaluate(
        ({ safeStorage }, value) => [
          ...safeStorage.encryptString(JSON.stringify(value)),
        ],
        {
          username: "legacy@example.invalid",
          password: "legacy-password",
        },
      );
      await writeFile(credentialsPath, Buffer.from(legacyCiphertext));

      expect(
        await page.evaluate(() => window.gwNative.credentials.load()),
      ).toEqual({
        state: "available",
        credentials: {
          username: "legacy@example.invalid",
          password: "legacy-password",
        },
      });
      const envelope = JSON.parse(
        await readFile(credentialsPath, "utf8"),
      ) as Record<string, unknown>;
      expect(envelope).toMatchObject({
        formatVersion: 1,
        protection: "mac-preview-mock-v1",
      });
      expect(Object.keys(envelope).sort()).toEqual([
        "ciphertext",
        "formatVersion",
        "protection",
      ]);
    } finally {
      await app.close().catch(() => {});
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("in-game Full Game strategy owns the next launch", async () => {
    const env = launchEnv({
      GW_OFFLINE_SHELL: "1",
      GW_BACKGROUND_LAUNCH: "1",
      GW_OFFLINE_SNAPSHOT_SIZE: String(8 * 1024 ** 3),
    });
    const userData = await mkdtemp(path.join(tmpdir(), "gw-strategy-e2e-"));
    const app = await launch(userData, env);
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator("#data-choice")).toBeVisible();
      await page.locator("#data-choice-quick").click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            [...globalThis.document.scripts].some((script) =>
              script.src.endsWith("/Gw.jspi.js"))),
        )
        .toBe(true);

      await page.locator("#loading-links [data-settings]").click();
      await page.locator('input[name="dataStrategy"][value="full"]').check();
      await expect
        .poll(() =>
          page.evaluate(async () =>
            (await window.gwNative.settings.get()).dataStrategy),
        )
        .toBe("full");
      await expect(page.locator("#settings-feedback")).toContainText(
        "before Guild Wars starts next time",
      );
      await page.locator("#settings-done").click();

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("#data-download")).toBeVisible();
      expect(
        await page.evaluate(() =>
          [...globalThis.document.scripts].some((script) =>
            script.src.endsWith("/Gw.jspi.js"))),
      ).toBe(false);
      await page.locator("#data-download-quick").click();
      await expect
        .poll(() =>
          page.evaluate(async () =>
            (await window.gwNative.settings.get()).dataStrategy),
        )
        .toBe("quick");
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

});
