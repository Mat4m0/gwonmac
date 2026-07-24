import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
      const resetPage = await app.firstWindow({ timeout: 30_000 });
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
      await resetPage.evaluate(() => {
        window.__windowResetReleasedInput = false;
        window.addEventListener("gw:input-reset", () => {
          window.__windowResetReleasedInput = true;
        });
      });
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById("reset-window-state")?.click();
      });
      await expect
        .poll(() =>
          resetPage.evaluate(() => window.__windowResetReleasedInput),
        )
        .toBe(true);
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

});
