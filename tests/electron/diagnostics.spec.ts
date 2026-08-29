import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ElectronApplication } from "@playwright/test";
import {
  closeOffline,
  launchOffline,
  root,
} from "./fixtures.mjs";

declare global {
  interface Window {
    // The renderer probe this spec installs; it exists only while it runs.
    __diagnosticExportReleasedInput?: boolean;
    __feedbackInputResetCount?: number;
  }
}

const execFileAsync = promisify(execFile);
const clickMenu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
    if (!item) throw new Error(`menu item ${menuId} is missing`);
    item.click();
  }, id);

test.describe("diagnostics", () => {
  test("waits for a starting capture before opening export", async () => {
    const fixture = await launchOffline("gw-capture-export-start-race-e2e-");
    try {
      const result = await fixture.app.evaluate(
        async ({ BrowserWindow, dialog }, modulePath) => {
          const load = process
            .getBuiltinModule("node:module")
            .createRequire(modulePath);
          const diagnostics = load(modulePath);
          const recorderModule = load(
            modulePath.replace(/diagnostics\.js$/u, "diagnostics/recorder.js"),
          );
          const owner = BrowserWindow.getAllWindows()[0];
          if (!owner) throw new Error("diagnostics owner is unavailable");

          const originalBegin = recorderModule.recorder.beginCapture.bind(
            recorderModule.recorder,
          );
          const originalShowSaveDialog = dialog.showSaveDialog;
          let releaseStart: () => void = () => undefined;
          let enteredStart: () => void = () => undefined;
          const startEntered = new Promise<void>((resolve) => {
            enteredStart = resolve;
          });
          const startReleased = new Promise<void>((resolve) => {
            releaseStart = resolve;
          });
          let saveDialogCalls = 0;
          recorderModule.recorder.beginCapture = async (ownerId: number) => {
            await originalBegin(ownerId);
            enteredStart();
            await startReleased;
          };
          dialog.showSaveDialog = async () => {
            saveDialogCalls += 1;
            return { canceled: true, filePath: "" };
          };

          try {
            const starting = diagnostics.startDiagnosticCapture(owner, 1);
            await startEntered;
            const exporting = diagnostics.exportDiagnosticsForWindow(
              owner,
              async () => ({}),
            );
            await new Promise((resolve) => setTimeout(resolve, 50));
            const callsBeforeStartSettled = saveDialogCalls;
            releaseStart();
            await Promise.all([starting, exporting]);
            return {
              callsBeforeStartSettled,
              saveDialogCalls,
              captureLevel: diagnostics.diagnosticSummary().captureLevel,
            };
          } finally {
            recorderModule.recorder.beginCapture = originalBegin;
            dialog.showSaveDialog = originalShowSaveDialog;
          }
        },
        path.join(root, "build/main/diagnostics.js"),
      );

      expect(result).toEqual({
        callsBeforeStartSettled: 0,
        saveDialogCalls: 1,
        captureLevel: 0,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("serializes capture lifecycle and exposes an unmistakable marker", async () => {
    const fixture = await launchOffline("gw-capture-e2e-");
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      const stopCapture = async () => {
        await clickMenu(app, "stop-capture");
        await expect.poll(() => page.evaluate(async () =>
          (await window.gwNative.diagnostics.current()).captureLevel,
        ), { timeout: 30_000 }).toBe(0);
        await expect(page.locator("#capture-status")).toBeHidden();
      };
      await clickMenu(app, "start-performance-capture");
      await expect(page.locator("#capture-status")).toBeVisible();
      await expect(page.locator("#capture-label")).toContainText(
        "Performance capture",
      );
      await page.evaluate(async () => {
        await window.gwDiagnostics.flush();
        window.gwDiagnostics.swap(200, 50, 25);
        await window.gwDiagnostics.flush();
      });
      await stopCapture();

      await clickMenu(app, "start-performance-capture");
      await expect(page.locator("#capture-status")).toBeVisible();
      await stopCapture();
      expect(
        await page.evaluate(async () =>
          (await window.gwNative.diagnostics.current()).captureLevel,
        ),
      ).toBe(0);

      await clickMenu(app, "start-chromium-trace");
      await expect(page.locator("#capture-label")).toContainText(
        "Chromium trace",
      );
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.diagnostics.current()).captureLevel,
      )).toBe(2);
      await page.evaluate(async () => {
        window.gwDiagnostics.snapshot(100, 4096, "memory");
        window.gwDiagnostics.swap(100, 50, 25);
        await new Promise((resolve) => setTimeout(resolve, 25));
        window.gwDiagnostics.swap(100, 50, 25);
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
      await expect(page.locator("#capture-marker")).toHaveText(
        "Problem marked ✓",
      );
      await stopCapture();
      const diagnosticsDirectory = path.join(fixture.userData, "diagnostics");
      const traceName = (await readdir(diagnosticsDirectory)).find((name) =>
        name.startsWith("chromium-") && name.endsWith(".json"));
      if (!traceName) throw new Error("no Chromium trace was written");
      const trace: { traceEvents: Array<{ name: string }> } = JSON.parse(
        await readFile(path.join(diagnosticsDirectory, traceName), "utf8"),
      );
      const traceNames = new Set(trace.traceEvents.map((event) => event.name));
      expect(traceNames.has("gw.snapshot.resolve")).toBe(true);
      expect(traceNames.has("gw.frame.submit")).toBe(true);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("discards a completed Chromium trace before the next capture and at shutdown", async () => {
    const fixture = await launchOffline("gw-trace-lifecycle-e2e-");
    try {
      const { app, page, userData } = fixture;
      const diagnosticsDirectory = path.join(userData, "diagnostics");
      const traceNames = async () =>
        (await readdir(diagnosticsDirectory)).filter(
          (name) => name.startsWith("chromium-") && name.endsWith(".json"),
        );
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });

      await clickMenu(app, "start-chromium-trace");
      await expect(page.locator("#capture-status")).toBeVisible();
      await clickMenu(app, "stop-capture");
      await expect(page.locator("#capture-status")).toBeHidden();
      await expect.poll(traceNames).toHaveLength(1);

      // Beginning Level 1 replaces the completed Level 2 result. The raw
      // Chromium file has to be gone before that reset happens.
      await clickMenu(app, "start-performance-capture");
      await expect(page.locator("#capture-status")).toBeVisible();
      await expect.poll(traceNames).toEqual([]);
      await clickMenu(app, "stop-capture");
      await expect(page.locator("#capture-status")).toBeHidden();

      // The same ownership rule applies when no later capture replaces it:
      // quit cleanup deletes an unexported completed trace.
      await clickMenu(app, "start-chromium-trace");
      await expect(page.locator("#capture-status")).toBeVisible();
      await clickMenu(app, "stop-capture");
      await expect(page.locator("#capture-status")).toBeHidden();
      await expect.poll(traceNames).toHaveLength(1);
      await app.evaluate(async (_, modulePath) => {
        const load = process
          .getBuiltinModule("node:module")
          .createRequire(modulePath);
        await load(modulePath).stopDiagnostics();
      }, path.join(root, "build/main/diagnostics.js"));
      await expect.poll(traceNames).toEqual([]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("redacts OAuth redirect tokens from a Level 2 export", async () => {
    const fixture = await launchOffline("gw-trace-oauth-redaction-");
    const diagnosticRoot = await mkdtemp(path.join(tmpdir(), "gwdiag-oauth-trace-"));
    const fragmentSecret = "FRAGMENTSECRET123";
    const querySecret = "QUERYSECRET456";
    try {
      const { app, page } = fixture;
      await clickMenu(app, "start-chromium-trace");
      await expect(page.locator("#capture-status")).toBeVisible();
      await page.evaluate(
        ({ fragment, query }) => {
          performance.mark(
            `https://www.guildwars.test/app/live/auth#access_token=${fragment}&state=nonce`,
          );
          performance.mark(
            `https://www.guildwars.test/app/live/auth?access_token=${query}&state=nonce`,
          );
        },
        { fragment: fragmentSecret, query: querySecret },
      );
      await clickMenu(app, "stop-capture");
      await expect(page.locator("#capture-status")).toBeHidden();

      const target = path.join(diagnosticRoot, "capture.zip");
      await app.evaluate(async ({ app: electronApp, BrowserWindow }, args) => {
        const load = process
          .getBuiltinModule("node:module")
          .createRequire(args.modulePath);
        const diagnostics = load(args.modulePath);
        const { DEFAULT_SETTINGS } = load(args.contractsPath);
        const { windowRegistry } = load(
          args.modulePath.replace(/diagnostics\.js$/u, "window-registry.js"),
        );
        const win = BrowserWindow.getAllWindows()[0];
        const ownerId = win
          ? windowRegistry.diagnosticOwnerForWindow(win)
          : null;
        if (ownerId === null) throw new Error("diagnostics owner is unavailable");
        await diagnostics.exportDiagnosticsZip(args.target, {
          appVersion: electronApp.getVersion(),
          diagnosticOwnerId: ownerId,
          includePreviousSession: false,
          electronVersions: { electron: process.versions.electron },
          settings: DEFAULT_SETTINGS,
        });
      }, {
        modulePath: path.join(root, "build/main/diagnostics.js"),
        contractsPath: path.join(root, "build/shared/contracts.js"),
        target,
      });

      const extracted = path.join(diagnosticRoot, "extracted");
      await execFileAsync("ditto", ["-x", "-k", target, extracted]);
      const trace = await readFile(
        path.join(extracted, "chromium-trace.json"),
        "utf8",
      );
      expect(trace).not.toContain(fragmentSecret);
      expect(trace).not.toContain(querySecret);
      expect(() => JSON.parse(trace)).not.toThrow();
    } finally {
      await closeOffline(fixture);
      await rm(diagnosticRoot, { recursive: true, force: true });
    }
  });

  test("downgrades a failed Chromium stop to an exportable Level 1 capture", async () => {
    const fixture = await launchOffline("gw-trace-stop-failure-e2e-");
    const diagnosticRoot = await mkdtemp(path.join(tmpdir(), "gwdiag-stop-failure-"));
    try {
      const target = path.join(diagnosticRoot, "capture.zip");
      const modulePath = path.join(root, "build/main/diagnostics.js");
      const contractsPath = path.join(root, "build/shared/contracts.js");
      const stopped = await fixture.app.evaluate(
        async ({ app: electronApp, BrowserWindow, contentTracing }, args) => {
          const load = process
            .getBuiltinModule("node:module")
            .createRequire(args.modulePath);
          const diagnostics = load(args.modulePath);
          const { DEFAULT_SETTINGS } = load(args.contractsPath);
          const { windowRegistry } = load(
            args.modulePath.replace(/diagnostics\.js$/u, "window-registry.js"),
          );
          const owner = BrowserWindow.getAllWindows()[0];
          if (!owner) throw new Error("diagnostics owner is unavailable");
          const ownerId = windowRegistry.diagnosticOwnerForWindow(owner);
          if (ownerId === null) throw new Error("diagnostics owner is unavailable");
          await diagnostics.startDiagnosticCapture(owner, 2);

          const originalStopRecording = contentTracing.stopRecording;
          let attemptedTarget = "";
          contentTracing.stopRecording = async (traceTarget) => {
            attemptedTarget = traceTarget ?? "";
            // Stop Chromium for real and create its target, then fail at the
            // API boundary. This exercises the partial-target branch without
            // leaving content tracing active in the Electron test process.
            await originalStopRecording.call(contentTracing, traceTarget);
            throw new Error("forced stopRecording failure");
          };
          try {
            await diagnostics.stopDiagnosticCapture("manual");
          } finally {
            contentTracing.stopRecording = originalStopRecording;
          }
          await diagnostics.exportDiagnosticsZip(args.target, {
            appVersion: electronApp.getVersion(),
            diagnosticOwnerId: ownerId,
            includePreviousSession: false,
            electronVersions: { electron: process.versions.electron },
            settings: DEFAULT_SETTINGS,
          });
          return {
            attemptedTarget,
            captureLevel: diagnostics.diagnosticSummary().captureLevel,
          };
        },
        { modulePath, contractsPath, target },
      );

      expect(path.basename(stopped.attemptedTarget)).toMatch(/^chromium-.+\.json$/);
      expect(stopped.captureLevel).toBe(0);
      expect(
        (await readdir(path.join(fixture.userData, "diagnostics"))).filter(
          (name) => name.startsWith("chromium-"),
        ),
      ).toEqual([]);

      const extracted = path.join(diagnosticRoot, "extracted");
      await execFileAsync("ditto", ["-x", "-k", target, extracted]);
      const manifest = JSON.parse(
        await readFile(path.join(extracted, "manifest.json"), "utf8"),
      );
      const capture = JSON.parse(
        await readFile(path.join(extracted, "capture-summary.json"), "utf8"),
      );
      expect(manifest).toMatchObject({
        captureLevel: 1,
        profilerContaminated: false,
      });
      expect(manifest.includedFiles).not.toContain("chromium-trace.json");
      expect(capture.captureLevel).toBe(1);

      const validated = await execFileAsync(process.execPath, [
        path.join(root, "build/tools/diagnostics/validate.js"),
        target,
      ]);
      expect(validated.stdout).toContain("valid capture");
    } finally {
      await closeOffline(fixture);
      await rm(diagnosticRoot, { recursive: true, force: true });
    }
  });

  // Every channel's parser lives in the handler registry, ahead of the
  // handler's own try/catch. Two channels used to parse inside it and record
  // `credentials.saveFailed` / `settings.saveFailed`, so until the registry
  // recorded the rejection itself, "my saved login stopped working" produced an
  // export with no evidence of the refusal in it. The claim under test is the
  // recorder's, so it is asked of the file the recorder wrote.
  test("records which channel refused a renderer payload", async () => {
    const fixture = await launchOffline("gw-ipc-rejected-e2e-");
    try {
      const { page, userData } = fixture;
      // Both cross the bridge unvalidated: the preload is transport, and these
      // are exactly the shapes the game's own host calls can produce.
      const refusals = await page.evaluate(async () => {
        const refused = async (call: () => Promise<unknown>) => {
          try {
            await call();
            return "accepted";
          } catch {
            return "refused";
          }
        };
        // Deliberately ill-typed payloads: the claim is that the registry
        // refuses shapes the contracts forbid, which only a renderer ignoring
        // them can send. `unknown` is the honest parameter type at that edge.
        const bridge = window.gwNative as unknown as {
          credentials: { save(value: unknown): Promise<unknown> };
          settings: { set(value: unknown): Promise<unknown> };
        };
        return [
          await refused(() =>
            bridge.credentials.save({ username: "a", password: 1234 })),
          await refused(() => bridge.settings.set("not a patch")),
        ];
      });
      expect(refusals).toEqual(["refused", "refused"]);

      const rejections = async () => {
        const directory = path.join(userData, "diagnostics");
        const found = [];
        for (const name of await readdir(directory)) {
          if (!name.startsWith("session-") || !name.endsWith(".jsonl")) continue;
          const text = await readFile(path.join(directory, name), "utf8");
          for (const line of text.split("\n")) {
            if (!line) continue;
            let record;
            try {
              record = JSON.parse(line);
            } catch {
              continue; // The file being appended to can end mid-record.
            }
            if (record.name !== "ipc.rejected") continue;
            found.push({
              level: record.level,
              subsystem: record.subsystem,
              ...record.fields,
            });
          }
        }
        return found;
      };
      await expect.poll(rejections).toEqual([
        {
          level: "warn",
          subsystem: "app",
          channel: "credentialsSave",
          code: "credentials_corrupt",
        },
        {
          level: "warn",
          subsystem: "app",
          channel: "settingsSet",
          code: "bad_settings",
        },
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  // Stopping a capture on the quit path awaits a renderer acknowledgement, so a
  // renderer that cannot answer must settle the wait rather than hold it. A
  // renderer whose process is gone is exactly as unable to answer as a
  // destroyed one, and after a second crash the window, its webContents and its
  // URL are all still there — nothing else in the settle set fires.
  test("a command to a renderer whose process is gone settles instead of waiting", async () => {
    const fixture = await launchOffline("gw-renderer-command-crash-e2e-");
    try {
      const outcome = await fixture.app.evaluate(
        async ({ BrowserWindow }, modulePath) => {
          const load = process
            .getBuiltinModule("node:module")
            .createRequire(modulePath);
          const { sendRendererCommand } = load(modulePath);
          const settledWithin = (promise: Promise<unknown>, ms: number) =>
            Promise.race([
              promise,
              new Promise((resolve) => setTimeout(() => resolve("waiting"), ms)),
            ]);
          const probe = async () => {
            const win = new BrowserWindow({ show: false });
            await win.loadURL("about:blank");
            return win;
          };
          const crash = async (win: Electron.BrowserWindow) => {
            const pid = win.webContents.getOSProcessId();
            const gone = new Promise((resolve) =>
              win.webContents.once("render-process-gone", resolve));
            win.webContents.forcefullyCrashRenderer();
            await gone;
            return pid;
          };

          // A probe that shared the application's renderer process would crash
          // the real window instead, and prove nothing about this one.
          const [applicationWindow] = BrowserWindow.getAllWindows();
          if (!applicationWindow) throw new Error("the application window is gone");
          const mainPid = applicationWindow.webContents.getOSProcessId();

          // The process dies while a command is outstanding.
          const during = await probe();
          const outstanding = sendRendererCommand(during, { type: "input.reset" });
          const duringPid = await crash(during);
          const whileWaiting = await settledWithin(outstanding, 5_000);

          // The process is already gone when the command is sent: the state a
          // second crash leaves behind, and the one the quit path meets.
          const after = await probe();
          const afterPid = await crash(after);
          const alreadyGone = await settledWithin(
            sendRendererCommand(after, { type: "input.reset" }),
            5_000,
          );
          // A live page with no preload handler is bounded too. Destruction
          // would settle this for another reason, so leave it untouched until
          // the command's own deadline answers.
          const unresponsive = await probe();
          const timedOut = await settledWithin(
            sendRendererCommand(unresponsive, { type: "input.reset" }),
            7_000,
          );
          const stillAlive = !after.isDestroyed() && !after.webContents.isDestroyed();
          for (const win of [during, after, unresponsive]) win.destroy();
          return {
            whileWaiting,
            alreadyGone,
            timedOut,
            stillAlive,
            ownProcesses: duringPid !== mainPid && afterPid !== mainPid,
          };
        },
        path.join(root, "build/main/renderer-commands.js"),
      );
      expect(outcome).toEqual({
        whileWaiting: "failed",
        alreadyGone: "failed",
        timedOut: "timed-out",
        // The window that could not answer is neither destroyed nor closed —
        // that is what made this state unreachable for the other listeners.
        stillAlive: true,
        ownProcesses: true,
      });
      // The application's own renderer was never touched.
      expect(await fixture.page.evaluate(() => 1 + 1)).toBe(2);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("opens bug and feature issues directly after releasing game input", async () => {
    const fixture = await launchOffline("gw-feedback-links-e2e-");
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog, shell }) => {
        (globalThis as { __openedExternalUrls?: string[] }).__openedExternalUrls = [];
        shell.openExternal = async (url) => {
          const state = globalThis as { __openedExternalUrls?: string[] };
          state.__openedExternalUrls?.push(url);
        };
        dialog.showSaveDialog = async () => {
          throw new Error("feedback actions must not open a save dialog");
        };
      });
      await page.evaluate(() => {
        window.__feedbackInputResetCount = 0;
        window.addEventListener("gw:input-reset", () => {
          window.__feedbackInputResetCount =
            (window.__feedbackInputResetCount ?? 0) + 1;
        });
      });

      await clickMenu(app, "report-bug");
      await clickMenu(app, "request-feature");

      await expect.poll(() => page.evaluate(() => window.__feedbackInputResetCount)).toBe(2);
      await expect.poll(() => app.evaluate(() =>
        (globalThis as { __openedExternalUrls?: string[] }).__openedExternalUrls,
      )).toEqual([
        "https://github.com/Mat4m0/gwonmac/issues/new?template=bug-report.yml",
        "https://github.com/Mat4m0/gwonmac/issues/new?template=feature-request.yml",
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("exports diagnostics separately after releasing game input", async () => {
    const fixture = await launchOffline("gw-diagnostic-dialog-input-e2e-");
    const saveRoot = await mkdtemp(path.join(tmpdir(), "gw-diagnostic-menu-export-"));
    const target = path.join(saveRoot, "diagnostics.zip");
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, target);
      await page.evaluate(() => {
        window.__diagnosticExportReleasedInput = false;
        window.addEventListener("gw:input-reset", () => {
          window.__diagnosticExportReleasedInput = true;
        });
      });

      await clickMenu(app, "export-diagnostics");
      await expect
        .poll(() =>
          page.evaluate(() => window.__diagnosticExportReleasedInput),
        )
        .toBe(true);
      await expect
        .poll(async () => (await stat(target).catch(() => null))?.size ?? 0)
        .toBeGreaterThan(0);
    } finally {
      await closeOffline(fixture);
      await rm(saveRoot, { recursive: true, force: true });
    }
  });

  test("a crashed game keeps only the diagnostic fallback and recovers its sandbox", async () => {
    const fixture = await launchOffline("gw-crash-panel-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() => window.gwLoading.failCrash(1));
      await expect(page.locator("#loading-label")).toBeVisible();
      await expect(page.locator("#loading-retry, #loading-report")).toHaveCount(0);

      // A subsequent progress state clears the crash actions.
      await page.evaluate(() => {
        window.gwLoading.set("Checking the game client", null);
      });
      await expect(page.locator("#loading-label")).toHaveText("Checking the game client");

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL() === "gw://app/")
          ?.webContents.forcefullyCrashRenderer();
      });
      await expect
        .poll(
          async () => {
            const game = app.windows().find((candidate) => candidate.url() === "gw://app/");
            if (!game) return false;
            try {
              return await game.evaluate(() =>
                globalThis.location.protocol === "gw:" && typeof window.gwNative === "object");
            } catch {
              return false;
            }
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("exports a bounded, redacted report with prior crash context", async () => {
    const previousSessionId = randomUUID();
    const fixture = await launchOffline(
      "gw-diagnostic-export-e2e-",
      {},
      async (userData) => {
        const directory = path.join(userData, "diagnostics");
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, `session-${previousSessionId}.jsonl`),
          [
            {
              seq: 1,
              tsUs: 1,
              wallTime: new Date(0).toISOString(),
              level: "info",
              subsystem: "app",
              name: "diagnostics.started",
            },
            {
              seq: 2,
              tsUs: 2,
              wallTime: new Date(1).toISOString(),
              level: "error",
              subsystem: "app",
              name: "app.uncaughtException",
            },
            {
              seq: 3,
              tsUs: 3,
              wallTime: new Date(2).toISOString(),
              level: "info",
              subsystem: "app",
              name: "quit.cleanupCompleted",
            },
          ]
            .map((record) => JSON.stringify(record))
            .join("\n"),
          { mode: 0o600 },
        );
        // Chromium's atomic-write temporary for an interrupted trace, and an
        // old-format log. Neither matches a capture-file prefix, so both used
        // to survive every launch — one of them at 111 MB.
        await writeFile(
          path.join(directory, ".com.gwdevhub.guildwars.mpNbZp"),
          '{"traceEvents":[',
          { mode: 0o600 },
        );
        await writeFile(path.join(directory, "session-13880.log"), "legacy");
      },
    );
    const diagnosticRoot = await mkdtemp(path.join(tmpdir(), "gwdiag-e2e-"));
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      const diagnosticOwnerId = await app.evaluate(({ BrowserWindow }, modulePath) => {
        const load = process.getBuiltinModule("node:module").createRequire(modulePath);
        const { recorder } = load(
          modulePath.replace(/diagnostics\.js$/u, "diagnostics/recorder.js"),
        );
        const { windowRegistry } = load(
          modulePath.replace(/diagnostics\.js$/u, "window-registry.js"),
        );
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) throw new Error("diagnostics owner is unavailable");
        const ownerId = windowRegistry.diagnosticOwnerForWindow(win);
        if (ownerId === null) throw new Error("diagnostics owner id is unavailable");
        recorder.record({ k: "window.shown" }, {}, ownerId);
        recorder.count("test.session.before", 1, ownerId);
        return ownerId;
      }, path.join(root, "build/main/diagnostics.js"));
      await clickMenu(app, "start-performance-capture");
      await expect(page.locator("#capture-status")).toBeVisible();
      await app.evaluate((_, args) => {
        const load = process.getBuiltinModule("node:module").createRequire(args.modulePath);
        const { recorder } = load(
          args.modulePath.replace(/diagnostics\.js$/u, "diagnostics/recorder.js"),
        );
        recorder.count("test.capture", 1, args.ownerId);
      }, { modulePath: path.join(root, "build/main/diagnostics.js"), ownerId: diagnosticOwnerId });
      await page.evaluate(async () => {
        window.gwDiagnostics.swap(200, 50, 25);
        await window.gwDiagnostics.flush();
      });
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.getMenuItemById("mark-performance-problem")
          ?.click();
      });
      await clickMenu(app, "stop-capture");
      await expect(page.locator("#capture-status")).toBeHidden();
      await app.evaluate((_, args) => {
        const load = process.getBuiltinModule("node:module").createRequire(args.modulePath);
        const { recorder } = load(
          args.modulePath.replace(/diagnostics\.js$/u, "diagnostics/recorder.js"),
        );
        recorder.record({ k: "window.resized" }, {}, args.ownerId);
        recorder.count("test.session.after", 1, args.ownerId);
      }, { modulePath: path.join(root, "build/main/diagnostics.js"), ownerId: diagnosticOwnerId });

      const target = path.join(diagnosticRoot, "capture.zip");
      const modulePath = path.join(root, "build/main/diagnostics.js");
      await app.evaluate(
        async ({ app: electronApp }, args) => {
          const createRequire =
            process.getBuiltinModule("node:module").createRequire;
          const require = createRequire(args.modulePath);
          const diagnostics = require(args.modulePath);
          await diagnostics.exportDiagnosticsZip(args.target, {
            appVersion: electronApp.getVersion(),
            diagnosticOwnerId: args.ownerId,
            includePreviousSession: true,
            // OS/Chromium summary documents are pattern-scanned rather than
            // certified. Plant the adversarial values there; app-authored
            // events have no free-text recording API anymore.
            electronVersions: {
              electron: process.versions.electron,
              password: "should-never-export",
              url: "https://example.invalid/?token=also-secret",
              message:
                "open /private/var/folders/example/player.db for player@example.invalid",
            },
            settings: {
              renderScale: 1,
              nativeCursor: false,
              showDiagnostics: false,
            },
          });
        },
        { modulePath, target, ownerId: diagnosticOwnerId },
      );

      const extracted = path.join(diagnosticRoot, "extracted");
      await execFileAsync("ditto", ["-x", "-k", target, extracted]);
      const manifest = JSON.parse(
        await readFile(path.join(extracted, "manifest.json"), "utf8"),
      );
      // `redaction` is the detector's result, not a literal the exporter
      // writes about itself. Every app-authored record is schema-certified,
      // while traceBytesScanned states the separate pattern-scanner coverage.
      expect(manifest.redaction).toMatchObject({
        records: expect.any(Number),
        schemaChecked: expect.any(Number),
        traceBytesScanned: expect.any(Number),
      });
      expect(manifest.redaction.records).toBeGreaterThan(0);
      expect(manifest.redaction.schemaChecked).toBe(
        manifest.redaction.records,
      );

      // The fixture above plants three secrets in a pattern-scanned summary
      // document. Check the bytes, not a verdict the exporter wrote itself.
      const exportedFiles = await readdir(extracted);
      let exportedText = "";
      for (const name of exportedFiles) {
        const stats = await stat(path.join(extracted, name));
        if (!stats.isFile()) continue;
        const body = await readFile(path.join(extracted, name), "latin1");
        exportedText += body.toLowerCase();
        for (const secret of [
          "should-never-export",
          "also-secret",
          "player@example.invalid",
        ]) {
          expect(body, `${name} leaked ${secret}`).not.toContain(secret);
        }
      }

      expect(manifest).toMatchObject({
        captureLevel: 1,
        previousSession: {
          sessionId: previousSessionId,
          cleanShutdown: false,
          abnormalReason: "app.uncaughtException",
        },
        capture: { stopReason: "manual" },
      });
      expect(manifest.includedFiles).toEqual(
        expect.arrayContaining([
          "events.jsonl",
          "report.json",
          "previous-events.jsonl",
          "capture-summary.json",
          "frames.bin",
        ]),
      );
      expect(
        (await stat(path.join(extracted, "events.jsonl"))).size,
      ).toBeGreaterThan(0);
      const events = (
        await readFile(path.join(extracted, "events.jsonl"), "utf8")
      ).toLowerCase();
      expect(events).not.toContain("should-never-export");
      expect(events).not.toContain("also-secret");
      expect(events).not.toContain("/private/var/folders/example/player.db");
      expect(events).not.toContain("player@example.invalid");
      expect(exportedText).toContain("[redacted]");
      expect(exportedText).toContain("[redacted-path]");
      expect(exportedText).toContain("[redacted-email]");
      expect(events).toContain("performance.problemmarked");
      expect(events).toContain("window.shown");
      expect(events).toContain("window.resized");
      const eventRecords = events
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { name: string; seq: number });
      expect(eventRecords.find((event) => event.name === "window.shown")?.seq)
        .toBeLessThan(manifest.capture.firstSequenceNumber);
      expect(eventRecords.find((event) => event.name === "window.resized")?.seq)
        .toBeGreaterThan(manifest.capture.lastSequenceNumber);
      const summary = JSON.parse(
        await readFile(path.join(extracted, "summary.json"), "utf8"),
      );
      const captureSummary = JSON.parse(
        await readFile(path.join(extracted, "capture-summary.json"), "utf8"),
      );
      expect(summary.counters).toMatchObject({
        "test.session.before": 1,
        "test.capture": 1,
        "test.session.after": 1,
      });
      expect(captureSummary.counters).toMatchObject({ "test.capture": 1 });
      expect(captureSummary.counters["test.session.before"]).toBeUndefined();
      expect(captureSummary.counters["test.session.after"]).toBeUndefined();

      const environment = JSON.parse(
        await readFile(path.join(extracted, "environment.json"), "utf8"),
      );
      // Sampled at export, so it agrees with the renderer's own probe instead
      // of reporting the pre-initialization defaults from before ready.
      if (environment.graphics?.hardwareAcceleration === true) {
        expect(environment.gpu.featureStatus.gpu_compositing).not.toBe(
          "disabled_software",
        );
      }

      // The directory keeps session logs and nothing else — including the
      // seeded atomic-write temporary and the legacy log.
      const remaining = await readdir(path.join(fixture.userData, "diagnostics"));
      expect(remaining).toContain(`session-${previousSessionId}.jsonl`);
      expect(remaining).not.toContain(".com.gwdevhub.guildwars.mpNbZp");
      expect(remaining).not.toContain("session-13880.log");
      // A Level 1 capture's frames-<session>.bin is still live here; only the
      // Chromium trace is discarded once the export exists.
      expect(remaining.filter((name) => name.startsWith("chromium-"))).toEqual([]);

      const validated = await execFileAsync(process.execPath, [
        path.join(root, "build/tools/diagnostics/validate.js"),
        target,
      ]);
      expect(validated.stdout).toContain("valid capture");
    } finally {
      await closeOffline(fixture);
      await rm(diagnosticRoot, { recursive: true, force: true });
    }
  });

});
