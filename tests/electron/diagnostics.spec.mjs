import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
import {
  closeOffline,
  launchOffline,
  main,
  root,
} from "./fixtures.mjs";

const execFileAsync = promisify(execFile);
const clickMenu = (app, id) =>
  app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
    if (!item) throw new Error(`menu item ${menuId} is missing`);
    item.click();
  }, id);

test.describe("diagnostics", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

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
      await clickMenu(app, "stop-capture");
      await expect(page.locator("#capture-status")).toBeHidden();

      await clickMenu(app, "start-performance-capture");
      await expect(page.locator("#capture-status")).toBeVisible();
      await clickMenu(app, "stop-capture");
      await expect(page.locator("#capture-status")).toBeHidden();
      expect(
        await page.evaluate(async () =>
          (await window.gwNative.diagnostics.current()).captureLevel,
        ),
      ).toBe(0);

      await clickMenu(app, "start-chromium-trace");
      await expect(page.locator("#capture-label")).toContainText(
        "Chromium trace",
      );
      await page.waitForTimeout(500);
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
      await clickMenu(app, "stop-capture");
      await expect(page.locator("#capture-status")).toBeHidden();
      const diagnosticsDirectory = path.join(fixture.userData, "diagnostics");
      const traceName = (await readdir(diagnosticsDirectory)).find((name) =>
        name.startsWith("chromium-") && name.endsWith(".json"));
      expect(traceName).toBeTruthy();
      const trace = JSON.parse(
        await readFile(path.join(diagnosticsDirectory, traceName), "utf8"),
      );
      const traceNames = new Set(trace.traceEvents.map((event) => event.name));
      expect(traceNames.has("gw.snapshot.resolve")).toBe(true);
      expect(traceNames.has("gw.frame.submit")).toBe(true);
    } finally {
      await closeOffline(fixture);
    }
  });

  // P5.9 moved every channel's parser into the handler registry, ahead of the
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
        const refused = async (call) => {
          try {
            await call();
            return "accepted";
          } catch {
            return "refused";
          }
        };
        return [
          await refused(() =>
            window.gwNative.credentials.save({ username: "a", password: 1234 })),
          await refused(() => window.gwNative.settings.set("not a patch")),
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

  test("releases game input before opening the diagnostics save panel", async () => {
    const fixture = await launchOffline("gw-diagnostic-dialog-input-e2e-");
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 0,
          checkboxChecked: false,
        });
        dialog.showSaveDialog = async () => ({
          canceled: true,
          filePath: "",
        });
      });
      await page.evaluate(() => {
        window.__diagnosticExportReleasedInput = false;
        window.addEventListener("gw:input-reset", () => {
          window.__diagnosticExportReleasedInput = true;
        });
      });

      await clickMenu(app, "report-problem");
      await expect
        .poll(() =>
          page.evaluate(() => window.__diagnosticExportReleasedInput),
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
      await clickMenu(app, "start-performance-capture");
      await expect(page.locator("#capture-status")).toBeVisible();
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

      const target = path.join(diagnosticRoot, "capture.gwdiag");
      const modulePath = path.join(root, "build/main/diagnostics.js");
      await app.evaluate(
        async ({ app: electronApp }, args) => {
          const createRequire =
            process.getBuiltinModule("node:module").createRequire;
          const require = createRequire(args.modulePath);
          const diagnostics = require(args.modulePath);
          diagnostics.log("app", "info", "redaction fixture", {
            password: "should-never-export",
            url: "https://example.invalid/?token=also-secret",
            message:
              "open /private/var/folders/example/player.db for player@example.invalid",
          });
          await diagnostics.exportDiagnosticsZip(args.target, {
            appVersion: electronApp.getVersion(),
            electronVersions: { electron: process.versions.electron },
            settings: {
              renderScale: 1,
              nativeCursor: false,
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
      // P2.5 — `redaction` is the detector's result, not a literal the exporter
      // writes about itself. `schemaChecked` counts records matched exactly
      // against the closed schema; `openFields` counts string values carried by
      // records the schema does not declare yet. Asserting both, rather than
      // just "it is an object", is what makes the residue visible: a phase that
      // closes more events must move these numbers.
      expect(manifest.redaction).toMatchObject({
        records: expect.any(Number),
        schemaChecked: expect.any(Number),
        openFields: expect.any(Number),
        traceBytesScanned: expect.any(Number),
      });
      expect(manifest.redaction.records).toBeGreaterThan(0);
      expect(manifest.redaction.schemaChecked).toBeGreaterThan(0);

      // The fixture above plants three secrets through the free-text `log()`
      // path on purpose. This test has always been named "redacted" and until
      // now only checked a string the exporter wrote about itself, which is
      // exactly the circular proof P2 exists to remove. Check the export.
      const exportedFiles = await readdir(extracted);
      for (const name of exportedFiles) {
        const stats = await stat(path.join(extracted, name));
        if (!stats.isFile()) continue;
        const body = await readFile(path.join(extracted, name), "latin1");
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
      expect(events).toContain("[redacted]");
      expect(events).toContain("[redacted-path]");
      expect(events).toContain("[redacted-email]");
      expect(events).toContain("performance.problemmarked");

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
      await rm(diagnosticRoot, { recursive: true, force: true });
      await closeOffline(fixture);
    }
  });

  test("recovers the sandbox after a renderer crash", async () => {
    const fixture = await launchOffline("gw-renderer-recovery-e2e-");
    try {
      await fixture.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
      });
      await expect
        .poll(
          async () => {
            const windows = fixture.app.windows();
            if (!windows.length) return false;
            try {
              return await windows[0].evaluate(
                () =>
                  globalThis.location.protocol === "gw:" &&
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
      await closeOffline(fixture);
    }
  });
});
