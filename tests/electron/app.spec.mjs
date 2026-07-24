import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);
const main = path.join(root, "build/main/main.js");
const electronBin = path.join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);

test.describe("Electron application", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

  test("red X closes sockets and exits cleanly", async () => {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", resolve);
    });
    const env = {
      ...process.env,
      GW_ALLOW_PRIVATE: "1",
      GW_OFFLINE_SHELL: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const userData = await mkdtemp(path.join(tmpdir(), "gw-electron-quit-e2e-"));
    const app = await electron.launch({
      cwd: root,
      args: [".", `--user-data-dir=${userData}`],
      env,
      executablePath: existsSync(electronBin) ? electronBin : undefined,
    });
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
      await page.evaluate(async () => {
        const sock = window.Module.socket.connect("127.0.0.1:6112");
        await new Promise((resolve, reject) => {
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
        await window.gwNative.diagnostics.startCapture(1);
      });
      const electronProcess = app.process();
      const exited = new Promise((resolve) => {
        electronProcess.once("exit", (code, signal) => resolve({ code, signal }));
      });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close();
      }).catch(() => undefined);
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
      expect(events).toContain('"reason":"owner closed"');
      expect(events).not.toContain('"name":"app.uncaughtException"');
      expect(events).not.toContain('"name":"renderer.recoveryScheduled"');
      expect(events).not.toContain("Object has been destroyed");
    } finally {
      await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true });
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("restores fullscreen and normal bounds, then resets safely", async () => {
    const env = { ...process.env, GW_OFFLINE_SHELL: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    const userData = await mkdtemp(path.join(tmpdir(), "gw-window-state-e2e-"));
    const launch = () =>
      electron.launch({
        cwd: root,
        args: [".", `--user-data-dir=${userData}`],
        env,
        executablePath: existsSync(electronBin) ? electronBin : undefined,
      });
    const closeCleanly = async (runningApp) => {
      const processHandle = runningApp.process();
      const exited = new Promise((resolve) => {
        processHandle.once("exit", (code, signal) => resolve({ code, signal }));
      });
      await runningApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close();
      }).catch(() => undefined);
      expect(await exited).toEqual({ code: 0, signal: null });
    };

    let app = await launch();
    try {
      await app.firstWindow({ timeout: 30_000 });
      const normalBounds = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) throw new Error("window missing");
        win.setBounds({ x: 120, y: 90, width: 960, height: 700 });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const bounds = win.getBounds();
        await new Promise((resolve) => {
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

      const statePath = path.join(userData, "window-state.json");
      expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
        bounds: normalBounds,
        mode: "fullscreen",
      });
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);

      app = await launch();
      await app.firstWindow({ timeout: 30_000 });
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]?.isFullScreen()),
        )
        .toBe(true);
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getNormalBounds()),
      ).toEqual(normalBounds);

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
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById("reset-window-state")?.click();
      });
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            return win && !win.isFullScreen() ? win.getBounds() : null;
          }),
          { timeout: 15_000 },
        )
        .toEqual(expectedReset);
      await expect
        .poll(
          async () => JSON.parse(await readFile(statePath, "utf8")),
          { timeout: 15_000 },
        )
        .toEqual({
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
    const received = [];
    const server = net.createServer((socket) => {
      socket.on("data", (data) => received.push(Buffer.from(data)));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", resolve);
    });
    const env = {
      ...process.env,
      GW_ALLOW_PRIVATE: "1",
      GW_OFFLINE_SHELL: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const userData = await mkdtemp(path.join(tmpdir(), "gw-electron-socket-e2e-"));
    const app = await electron.launch({
      cwd: root,
      args: [".", `--user-data-dir=${userData}`],
      env,
      executablePath: existsSync(electronBin) ? electronBin : undefined,
    });
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
      const externalBefore = await app.evaluate(() => process.memoryUsage().external);
      const result = await page.evaluate(async () => {
        const sock = window.Module.socket.connect("127.0.0.1:6112");
        await new Promise((resolve, reject) => {
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
      expect(result.summary.counters["socket.rendererSourceBackingBytes"]).toBe(
        20 * 64 * 1024 * 1024,
      );
      expect(result.summary.counters["socket.rendererCompactBytes"]).toBe(420);
      expect(result.summary.counters["socket.ipcPayloadBytes"]).toBe(420);
      expect(result.summary.counters["socket.ipcBackingBytes"]).toBe(420);
      expect(result.summary.counters["socket.sendCalls"]).toBe(20);
      expect(result.summary.counters["socket.sendPayloadBytes"]).toBe(420);
      expect(result.summary.histograms["socket.writeCallback"].count).toBe(20);
      expect(result.summary.latest["socket.activeWrites"]).toBe(0);
      expect(result.summary.latest["socket.queuedBytes"]).toBe(0);
      expect(result.summary.latest["socket.peakActiveWrites"]).toBeGreaterThanOrEqual(1);
      expect(result.summary.latest["socket.peakQueuedBytes"]).toBeGreaterThanOrEqual(21);
      expect(
        result.summary.histograms["socket.rendererSync"].p95Us,
      ).toBeLessThanOrEqual(1_000);
      expect(
        result.summary.histograms["socket.rendererSettle"].p95Us,
      ).toBeLessThanOrEqual(8_000);
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("saved login survives an application relaunch without Keychain", async () => {
    const env = { ...process.env, GW_OFFLINE_SHELL: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    const userData = await mkdtemp(path.join(tmpdir(), "gw-credentials-e2e-"));
    const launch = () =>
      electron.launch({
        cwd: root,
        args: [".", `--user-data-dir=${userData}`],
        env,
        executablePath: existsSync(electronBin) ? electronBin : undefined,
      });

    let app = await launch();
    try {
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
      await page.evaluate(() =>
        window.gwNative.credentials.save({
          username: "relaunch@example.invalid",
          password: "relaunch-password",
        }),
      );
      await app.close();

      app = await launch();
      const relaunchedPage = await app.firstWindow({ timeout: 30_000 });
      await relaunchedPage.waitForLoadState("domcontentloaded");
      expect(
        await relaunchedPage.evaluate(() =>
          window.gwNative.credentials.load()),
      ).toEqual({
        username: "relaunch@example.invalid",
        password: "relaunch-password",
      });
      await relaunchedPage.evaluate(() => window.gwNative.credentials.clear());
    } finally {
      await app.close().catch(() => {});
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("in-game Full Game strategy owns the next launch", async () => {
    const env = {
      ...process.env,
      GW_OFFLINE_SHELL: "1",
      GW_OFFLINE_SNAPSHOT_SIZE: String(8 * 1024 ** 3),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const userData = await mkdtemp(path.join(tmpdir(), "gw-strategy-e2e-"));
    const app = await electron.launch({
      cwd: root,
      args: [".", `--user-data-dir=${userData}`],
      env,
      executablePath: existsSync(electronBin) ? electronBin : undefined,
    });
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

  test("opens gw://app with sandboxed preload bridge", async () => {
    const env = {
      ...process.env,
      GW_OFFLINE_SHELL: "1",
      GW_OFFLINE_SNAPSHOT_SIZE: String(8 * 1024 ** 3),
    };
    const userData = await mkdtemp(path.join(tmpdir(), "gw-electron-e2e-"));
    const previousSessionId = randomUUID();
    const diagnosticsDir = path.join(userData, "diagnostics");
    await mkdir(diagnosticsDir, { recursive: true });
    await writeFile(
      path.join(diagnosticsDir, `session-${previousSessionId}.jsonl`),
      [
        JSON.stringify({
          seq: 1,
          tsUs: 1,
          wallTime: new Date(0).toISOString(),
          level: "info",
          subsystem: "app",
          name: "diagnostics.started",
        }),
        JSON.stringify({
          seq: 2,
          tsUs: 2,
          wallTime: new Date(1).toISOString(),
          level: "error",
          subsystem: "app",
          name: "app.uncaughtException",
        }),
        JSON.stringify({
          seq: 3,
          tsUs: 3,
          wallTime: new Date(2).toISOString(),
          level: "info",
          subsystem: "app",
          name: "quit.cleanupCompleted",
        }),
        '{"seq":4',
      ].join("\n"),
      { mode: 0o600 },
    );
    // Cursor/agent sandboxes often set this; it makes Electron run as Node.
    delete env.ELECTRON_RUN_AS_NODE;

    const app = await electron.launch({
      cwd: root,
      args: [".", `--user-data-dir=${userData}`],
      env,
      executablePath: existsSync(electronBin) ? electronBin : undefined,
    });
    try {
    const page = await app.firstWindow({ timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded");
    expect(page.url().startsWith("gw://app")).toBeTruthy();
    const loadingFont = await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      return {
        loaded: globalThis.document.fonts.check('16px "QT Friz Quad"'),
        family: globalThis.getComputedStyle(
          globalThis.document.getElementById("loading"),
        ).fontFamily,
      };
    });
    expect(loadingFont.loaded).toBe(true);
    expect(loadingFont.family).toContain("QT Friz Quad");

    await expect(page.locator("#data-choice")).toBeVisible();
    expect(
      await page.evaluate(async () =>
        (await window.gwNative.settings.get()).dataStrategy),
    ).toBe(null);
    await expect(page.locator("#data-choice")).toContainText(
      "Choose what should happen before Guild Wars starts",
    );
    await expect(page.locator("#data-choice-quick")).toContainText(
      "Recommended",
    );
    await expect(page.locator("#data-choice-full-size")).toHaveText(
      "Download 8.00 GB before starting.",
    );
    expect(
      await page.evaluate(() =>
        [...globalThis.document.scripts].some((script) =>
          script.src.endsWith("/Gw.jspi.js"))),
    ).toBe(false);
    await app.evaluate(({ ipcMain }) => {
      let firstRequest = true;
      ipcMain.removeHandler("gw:cache:downloadAll");
      ipcMain.handle("gw:cache:downloadAll", () => {
        if (!firstRequest) return false;
        firstRequest = false;
        return new Promise((_resolve, reject) => {
          globalThis.__rejectLauncherDownloadTest = reject;
        });
      });
    });
    await page.locator("#data-choice-full").click();
    await expect(page.locator("#data-choice")).toBeHidden();
    await expect(page.locator("#data-download")).toBeVisible();
    await expect(page.locator("#data-download-status")).toContainText(
      "Starting download",
    );
    await expect(page.locator("#data-download-status")).not.toContainText(
      "paused",
    );
    await expect(page.locator("#data-download-toggle")).toHaveText(
      "Pause Download",
    );
    await app.evaluate(() => {
      globalThis.__rejectLauncherDownloadTest?.(
        new Error("ArenaNet is unavailable. The download can resume later."),
      );
      delete globalThis.__rejectLauncherDownloadTest;
    });
    await expect(page.locator("#data-download-status")).toContainText(
      "ArenaNet is unavailable",
    );
    await expect(page.locator("#data-download-detail")).toHaveText(
      "Verified data is safe. Choose Resume Download to try again.",
    );
    await expect(page.locator("#data-download-toggle")).toHaveText(
      "Resume Download",
    );
    await page.locator("#data-download-toggle").click();
    await expect(page.locator("#data-download-status")).toContainText(
      "Download paused",
    );
    expect(
      await page.evaluate(async () =>
        (await window.gwNative.settings.get()).dataStrategy),
    ).toBe("full");
    expect(
      await page.evaluate(() =>
        [...globalThis.document.scripts].some((script) =>
          script.src.endsWith("/Gw.jspi.js"))),
    ).toBe(false);
    await page.locator("#data-download-play").click();
    await expect(page.locator("#data-download")).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...globalThis.document.scripts].some((script) =>
            script.src.endsWith("/Gw.jspi.js"))),
      )
      .toBe(true);

    await page.evaluate(() => {
      window.gwLoading.fail(
        "ArenaNet is unavailable and no previous game client could be restored.",
      );
    });
    await expect(page.locator("#loading-retry")).toBeVisible();
    await expect(page.locator("#loading-detail")).toHaveText(
      "You can retry, or choose Help → Report a Problem.",
    );
    await page.evaluate(() => window.gwLoading.done());

    await page.evaluate(() => {
      const canvas = globalThis.document.getElementById("canvas");
      globalThis.document.getElementById("loading").classList.add("gone");
      window.__inputReleases = [];
      window.__wheelSteps = [];
      window.addEventListener("keyup", (event) => {
        if (!event.isTrusted) window.__inputReleases.push(`key:${event.code}`);
      });
      window.addEventListener("mouseup", (event) => {
        if (!event.isTrusted) window.__inputReleases.push(`mouse:${event.button}`);
      });
      window.addEventListener("wheel", (event) => {
        if (!event.isTrusted && event.deltaMode === 1) {
          window.__wheelSteps.push([event.deltaMode, event.deltaY]);
        }
      }, true);
      canvas.focus();
    });
    await page.keyboard.down("w");
    const canvasBox = await page.locator("#canvas").boundingBox();
    await page.mouse.move(canvasBox.x + 100, canvasBox.y + 100);
    await page.mouse.down({ button: "left" });
    await page.evaluate(() =>
      window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset")));
    expect(await page.evaluate(() => window.__inputReleases)).toEqual([
      "key:KeyW",
      "mouse:0",
    ]);
    await page.keyboard.up("w");
    await page.mouse.up({ button: "left" });
    await page.evaluate(() => {
      const canvas = globalThis.document.getElementById("canvas");
      for (const deltaY of [60, 60]) {
        canvas.dispatchEvent(new globalThis.WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY,
          deltaMode: globalThis.WheelEvent.DOM_DELTA_PIXEL,
        }));
      }
    });
    expect(await page.evaluate(() => window.__wheelSteps)).toEqual([[1, 1]]);

    const bridge = await page.evaluate(() => ({
      hasNative: typeof window.gwNative === "object" && window.gwNative !== null,
      keys: window.gwNative ? Object.keys(window.gwNative).sort() : [],
      hasRequire: typeof window.require,
      hasProcess: typeof window.process,
    }));
    expect(bridge.hasNative).toBeTruthy();
    expect(bridge.keys).toEqual([
      "app",
      "cache",
      "credentials",
      "diagnostics",
      "dns",
      "progress",
      "settings",
      "snapshot",
      "sockets",
      "update",
    ]);
    expect(bridge.hasRequire).toBe("undefined");
    expect(bridge.hasProcess).toBe("undefined");
    expect(
      await app.evaluate(({ app: electronApp }) =>
        electronApp.commandLine.hasSwitch("use-mock-keychain"),
      ),
    ).toBe(true);

    const diagnostics = await page.evaluate(async () => {
      const summary = await window.gwNative.diagnostics.current();
      return {
        sessionId: summary.sessionId,
        captureLevel: summary.captureLevel,
        hasRendererRecorder: typeof window.gwDiagnostics?.flush === "function",
      };
    });
    expect(diagnostics.sessionId).toBeTruthy();
    expect(diagnostics.captureLevel).toBe(0);
    expect(diagnostics.hasRendererRecorder).toBeTruthy();
    const aggregate = await page.evaluate(async () => {
      window.gwDiagnostics.snapshot(1_000, 4_096, "native");
      window.gwDiagnostics.event("graphics.contextLost", new Error("fixture"));
      await window.gwDiagnostics.flush();
      await window.gwNative.diagnostics.recordRendererMilestone(
        "runtime.initialized",
        performance.now() * 1_000,
      );
      return window.gwNative.diagnostics.current();
    });
    expect(aggregate.counters["snapshot.reads"]).toBe(1);
    expect(aggregate.counters["renderer.event.graphics.contextLost"]).toBe(1);
    expect(aggregate.histograms["snapshot.rendererRead"]).toMatchObject({
      count: 1,
      minUs: 1_000,
      maxUs: 1_000,
      p95Us: 1_000,
    });
    expect(aggregate.latest["milestone.runtime.initializedUs"]).toBeGreaterThan(0);
    const graphics = await page.evaluate(async () => {
      await window.gwNative.diagnostics.recordGraphics({
        userAgent: globalThis.navigator.userAgent,
        jspi: true,
        webglVersion: "WebGL2",
        renderer: "fixture",
        vendor: "fixture",
        hardwareAcceleration: true,
        canvasWidth: 1280,
        canvasHeight: 800,
        offscreenWidth: 2560,
        offscreenHeight: 1600,
        drawingBufferWidth: 2560,
        drawingBufferHeight: 1600,
        devicePixelRatio: 2,
        renderScale: 2,
        antialias: false,
        samples: 0,
      });
      return (await window.gwNative.diagnostics.current()).latest;
    });
    expect(graphics).toMatchObject({
      "graphics.drawingBufferWidth": 2560,
      "graphics.drawingBufferHeight": 1600,
      "graphics.antialias": false,
      "graphics.samples": 0,
    });
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page.evaluate(() => window.gwNative.diagnostics.startCapture(1));
    await expect(page.locator("#capture-status")).toBeVisible();
    await expect(page.locator("#capture-label")).toContainText(
      "Performance capture",
    );
    expect(
      await page.evaluate(async () => (await window.gwNative.diagnostics.current()).captureLevel),
    ).toBe(1);
    await page.evaluate(async () => {
      await window.gwDiagnostics.flush();
      window.gwDiagnostics.swap(200, 50, 25);
      await window.gwDiagnostics.flush();
    });
    await page.evaluate(() => window.gwNative.diagnostics.stopCapture());
    await expect(page.locator("#capture-status")).toBeHidden();
    await page.evaluate(() => window.gwNative.diagnostics.startCapture(2));
    await expect(page.locator("#capture-label")).toContainText("Chromium trace");
    await page.waitForTimeout(100);
    await page.evaluate(async () => {
      window.gwDiagnostics.swap(200, 50, 25);
      await window.gwDiagnostics.flush();
    });
    expect(
      await app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(
          "mark-performance-problem",
        );
        item?.click();
        return {
          label: item?.label,
          accelerator: item?.accelerator,
        };
      }),
    ).toEqual({
      label: "Mark Performance Problem",
      accelerator: "CmdOrCtrl+Shift+M",
    });
    await expect(page.locator("#capture-marker")).toBeVisible();
    await expect(page.locator("#capture-marker")).toHaveText("Problem marked ✓");
    expect(
      await app.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()?.getMenuItemById("report-problem")?.label,
      ),
    ).toBe("Report a Problem…");
    await page.evaluate(() => window.gwNative.diagnostics.stopCapture());
    await expect(page.locator("#capture-status")).toBeHidden();

    expect(await page.evaluate(() => window.gwNative.cache.info())).toEqual({
      bytes: 0,
      chunks: 0,
      totalBytes: 0,
      totalChunks: 0,
    });
    expect(
      await page.evaluate(async () => {
        let missingBeforeStore = false;
        let missingAfterClear = false;
        try {
          await window.Module.secureStorage.getCredentials();
        } catch {
          missingBeforeStore = true;
        }
        await window.Module.secureStorage.storeCredentials(
          "pilot@example.invalid",
          "persisted-password",
        );
        const stored = await window.Module.secureStorage.getCredentials();
        await window.Module.secureStorage.clearCredentials();
        try {
          await window.Module.secureStorage.getCredentials();
        } catch {
          missingAfterClear = true;
        }
        return { missingBeforeStore, stored, missingAfterClear };
      }),
    ).toEqual({
      missingBeforeStore: true,
      stored: {
        username: "pilot@example.invalid",
        password: "persisted-password",
      },
      missingAfterClear: true,
    });
    await page.evaluate(() =>
      window.Module.secureStorage.storeCredentials(
        "pilot@example.invalid",
        "survives-reload",
      ),
    );
    const credentialFile = path.join(userData, "credentials.bin");
    const credentialBytes = await readFile(credentialFile);
    expect(credentialBytes.includes(Buffer.from("pilot@example.invalid"))).toBe(false);
    expect(credentialBytes.includes(Buffer.from("survives-reload"))).toBe(false);
    expect((await stat(credentialFile)).mode & 0o777).toBe(0o600);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.Module?.secureStorage);
    expect(
      await page.evaluate(() => window.Module.secureStorage.getCredentials()),
    ).toEqual({
      username: "pilot@example.invalid",
      password: "survives-reload",
    });
    await page.locator("#loading-links [data-settings]").click();
    await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
    await expect(page.locator("#settings-cache")).toContainText(
      "Game data is still preparing",
    );
    await expect(page.locator("#settings-dialog")).toContainText(
      "Game data mode",
    );
    await expect(page.locator("#settings-download-full")).toHaveText(
      "Start Downloading Now",
    );
    await expect(page.locator("#settings-download-full")).toBeDisabled();
    await expect(
      page.locator('input[name="dataStrategy"][value="full"]'),
    ).toBeChecked();
    await page.locator('input[name="dataStrategy"][value="quick"]').check();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.gwNative.settings.get()).dataStrategy),
      )
      .toBe("quick");
    await expect(page.locator("#settings-feedback")).toContainText(
      "Quick Start will be used next time",
    );
    await expect(page.locator("#settings-dialog")).toContainText("Advanced");
    await expect(page.locator("#settings-clear-creds")).toHaveCount(0);
    await expect(page.locator("#settings-save")).toHaveCount(0);
    await page.locator("#settings-tab-display").click();
    await expect(page.locator("#settings-dialog")).toContainText("Graphics quality");
    const renderDimensions = await page.evaluate(() => {
      const canvas = globalThis.document.getElementById("canvas");
      const label = (scale) =>
        globalThis.document.querySelector(
          `[data-render-scale="${scale}"]`,
        ).textContent;
      return {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        one: label("1"),
        oneAndHalf: label("1.5"),
        two: label("2"),
      };
    });
    expect(renderDimensions.one).toBe(
      `${renderDimensions.width} × ${renderDimensions.height}`,
    );
    expect(renderDimensions.oneAndHalf).toBe(
      `${Math.round(renderDimensions.width * 1.5)} × ` +
        `${Math.round(renderDimensions.height * 1.5)}`,
    );
    expect(renderDimensions.two).toBe(
      `${renderDimensions.width * 2} × ${renderDimensions.height * 2}`,
    );
    await expect(page.locator("#settings-pane-display")).toContainText(
      "2× renders four times the pixels",
    );
    await expect(
      page.locator('input[name="renderScale"][value="1"]'),
    ).toBeChecked();
    await page.locator('input[name="renderScale"][value="1.5"]').check();
    await expect(
      page.locator('input[name="renderScale"][value="1.5"]'),
    ).toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.gwNative.settings.get()).renderScale),
      )
      .toBe(1.5);
    await page.locator("#settings-tab-advanced").click();
    await page.locator('input[name="showDiagnostics"]').check();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const settings = await window.gwNative.settings.get();
          return {
            renderScale: settings.renderScale,
            showDiagnostics: settings.showDiagnostics,
            dataStrategy: settings.dataStrategy,
          };
        }),
      )
      .toEqual({
        renderScale: 1.5,
        showDiagnostics: true,
        dataStrategy: "quick",
      });
    await page.locator("#settings-tab-controls").click();
    await page.locator('select[name="cursorTheme"]').selectOption("guild-wars-2");
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.gwNative.settings.get()).cursorTheme),
      )
      .toBe("guild-wars-2");
    expect(
      await page.locator("#canvas").getAttribute("data-cursor-theme"),
    ).toBe("guild-wars-2");
    expect(
      await page.locator("#canvas").evaluate((canvas) =>
        globalThis.getComputedStyle(canvas).cursor),
    ).toContain("guild-wars-2.png");
    expect(
      await page.locator("#settings-cursor-preview").evaluate((preview) =>
        globalThis.getComputedStyle(preview).cursor),
    ).toContain("guild-wars-2.png");
    expect(
      await page.evaluate(async () => {
        const response = await globalThis.fetch("assets/cursors/guild-wars-2.png");
        const bitmap = await globalThis.createImageBitmap(await response.blob());
        return {
          contentType: response.headers.get("content-type"),
          width: bitmap.width,
          height: bitmap.height,
        };
      }),
    ).toEqual({ contentType: "image/png", width: 32, height: 32 });
    await page.locator("#settings-done").click();
    await page.evaluate(() =>
      globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
    );
    await expect(page.locator(".settings-panes")).toHaveAttribute(
      "data-active",
      "controls",
    );
    await page.locator("#settings-tab-advanced").click();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await page.locator("#settings-reset-launcher").click();
    await expect(page.locator("#settings-feedback")).toContainText(
      "download choice will appear next launch",
    );
    await expect
      .poll(() => page.evaluate(() => window.gwNative.settings.get()))
      .toEqual({
        renderScale: 1,
        pointerLock: true,
        cursorTheme: "guild-wars",
        touchMode: "dbltap",
        showDiagnostics: false,
        dataStrategy: null,
      });
    expect(
      await page.locator("#canvas").getAttribute("data-cursor-theme"),
    ).toBe("guild-wars");
    expect(
      await page.locator("#canvas").evaluate((canvas) =>
        globalThis.getComputedStyle(canvas).cursor),
    ).toContain("guild-wars.png");
    expect(
      await page.evaluate(() => window.gwNative.credentials.load()),
    ).toEqual({
      username: "pilot@example.invalid",
      password: "survives-reload",
    });
    await page.evaluate(() => window.gwNative.credentials.clear());
    expect(existsSync(credentialFile)).toBe(false);
    await page.locator("#settings-done").click();
    await expect(page.locator("#settings-dialog")).not.toHaveAttribute("open", "");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#data-choice")).toBeVisible();
    await page.locator("#data-choice-quick").click();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.gwNative.settings.get()).dataStrategy),
      )
      .toBe("quick");
    await expect
      .poll(() =>
        page.evaluate(async () => ({
          scale: (await window.gwNative.settings.get()).renderScale,
          diagnostics: globalThis.getComputedStyle(
            globalThis.document.getElementById("diagnostics"),
          ).display,
        })),
      )
      .toEqual({ scale: 1, diagnostics: "none" });

    const diagnosticRoot = await mkdtemp(path.join(tmpdir(), "gwdiag-e2e-"));
    try {
      const target = path.join(diagnosticRoot, "capture.gwdiag");
      const modulePath = path.join(root, "build/main/diagnostics.js");
      await app.evaluate(
        async ({ app: electronApp }, args) => {
          const createRequire = process.getBuiltinModule("node:module").createRequire;
          const require = createRequire(args.modulePath);
          const diagnostics = require(args.modulePath);
          diagnostics.log("app", "info", "redaction fixture", {
            password: "should-never-export",
            url: "https://example.invalid/?token=also-secret",
            message:
              "open /private/var/folders/example/player.db for player@example.invalid",
          });
          diagnostics.log("app", "info", "retained-start-fixture");
          for (let index = 0; index < 2_100; index++) {
            diagnostics.log("app", "debug", "retained-tail-fixture", { index });
          }
          await diagnostics.exportDiagnosticsZip(args.target, {
            appVersion: electronApp.getVersion(),
            electronVersions: { electron: process.versions.electron },
            settings: {
              renderScale: 1,
              pointerLock: true,
              cursorTheme: "system",
              touchMode: "dbltap",
              showDiagnostics: false,
              dataStrategy: "quick",
            },
          });
        },
        { modulePath, target },
      );
      const extracted = path.join(diagnosticRoot, "extracted");
      await execFileAsync("ditto", ["-x", "-k", target, extracted]);
      const manifest = JSON.parse(
        await readFile(path.join(extracted, "manifest.json"), "utf8"),
      );
      expect(manifest.redaction).toBe("passed");
      expect(manifest.captureLevel).toBe(2);
      expect(manifest.includedFiles).toContain("events.jsonl");
      expect(manifest.includedFiles).toContain("report.json");
      expect(manifest.includedFiles).toContain("previous-events.jsonl");
      expect(manifest.includedFiles).toContain("capture-summary.json");
      expect(manifest.includedFiles).toContain("frames.bin");
      expect(manifest.includedFiles).toContain("chromium-trace.json");
      expect(manifest.frameSchema).toMatchObject({
        format: "GWFRAME1",
        stride: 7,
      });
      expect(manifest.profilerContaminated).toBe(true);
      expect(manifest.previousSession).toMatchObject({
        sessionId: previousSessionId,
        cleanShutdown: false,
        finalEventName: "quit.cleanupCompleted",
        abnormalReason: "app.uncaughtException",
      });
      expect(manifest.capture).toMatchObject({
        stopReason: "manual",
      });
      expect(manifest.capture.firstSequenceNumber).toBeLessThanOrEqual(
        manifest.capture.lastSequenceNumber,
      );
      expect(manifest.eventLog.completeFromStart).toBe(true);
      const captureSummary = JSON.parse(
        await readFile(path.join(extracted, "capture-summary.json"), "utf8"),
      );
      const report = JSON.parse(
        await readFile(path.join(extracted, "report.json"), "utf8"),
      );
      expect(report.currentSession.startupStage).toBe("runtime.initialized");
      expect(report.previousSession).toMatchObject({
        sessionId: previousSessionId,
        cleanShutdown: false,
        finalEventName: "quit.cleanupCompleted",
        abnormalReason: "app.uncaughtException",
        errorCount: 1,
      });
      expect(report.capture).toMatchObject({
        level: 2,
        profilerContaminated: true,
        stopReason: "manual",
      });
      expect(
        await readFile(path.join(extracted, "previous-events.jsonl"), "utf8"),
      ).toContain("app.uncaughtException");
      expect(captureSummary.counters["snapshot.reads"] || 0).toBe(0);
      expect(
        (await stat(path.join(extracted, "chromium-trace.json"))).size,
      ).toBeGreaterThan(100);
      const trace = JSON.parse(
        await readFile(path.join(extracted, "chromium-trace.json"), "utf8"),
      );
      expect(Array.isArray(trace.traceEvents)).toBe(true);
      const events = (
        await readFile(path.join(extracted, "events.jsonl"), "utf8")
      ).toLowerCase();
      expect(events).not.toContain("should-never-export");
      expect(events).not.toContain("also-secret");
      expect(events).not.toContain("/private/var/folders/example/player.db");
      expect(events).not.toContain("player@example.invalid");
      expect(events).toContain("[redacted]");
      expect(events).toContain("[redacted-path]");
      expect(events).toContain("[redacted-email]");
      expect(events).toContain("performance.problemmarked");
      expect(events).toContain("retained.start.fixture");
      const eventLines = events.trim().split("\n");
      expect(eventLines.length).toBeGreaterThan(2_048);
      const redactionFixture = eventLines
        .map((line) => JSON.parse(line))
        .find((event) => event.name === "redaction.fixture");
      expect(redactionFixture.fields).toEqual({
        url: "https://example.invalid/?token=[redacted]",
        message: "open [redacted-path] for [redacted-email]",
      });
      expect(
        eventLines.every((line) =>
          /^[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(JSON.parse(line).name),
        ),
      ).toBe(true);
      const validated = await execFileAsync(process.execPath, [
        path.join(root, "build/tools/diagnostics/validate.js"),
        target,
      ]);
      expect(validated.stdout).toContain("valid capture");
      const summarized = await execFileAsync(process.execPath, [
        path.join(root, "build/tools/diagnostics/summarize.js"),
        target,
      ]);
      expect(summarized.stdout).toContain("visible exact p50/p95/p99");
    } finally {
      await rm(diagnosticRoot, { recursive: true, force: true });
    }

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
    });
    await expect
      .poll(
        async () => {
          const windows = app.windows();
          if (!windows.length) return false;
          try {
            return await windows[0].evaluate(
              () =>
                window.location.protocol === "gw:" &&
                typeof window.gwNative === "object",
            );
          } catch {
            return false;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
});
