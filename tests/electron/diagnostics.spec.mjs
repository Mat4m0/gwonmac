import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
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
      await page.evaluate(() => window.gwNative.diagnostics.startCapture(1));
      await expect(page.locator("#capture-status")).toBeVisible();
      await expect(page.locator("#capture-label")).toContainText(
        "Performance capture",
      );
      await page.evaluate(async () => {
        await window.gwDiagnostics.flush();
        window.gwDiagnostics.swap(200, 50, 25);
        await window.gwDiagnostics.flush();
      });
      await page.evaluate(() => window.gwNative.diagnostics.stopCapture());
      await expect(page.locator("#capture-status")).toBeHidden();

      await page.evaluate(async () => {
        const starting = window.gwNative.diagnostics.startCapture(1);
        const stopping = window.gwNative.diagnostics.stopCapture();
        await Promise.all([starting, stopping]);
      });
      expect(
        await page.evaluate(async () =>
          (await window.gwNative.diagnostics.current()).captureLevel,
        ),
      ).toBe(0);

      await page.evaluate(() => window.gwNative.diagnostics.startCapture(2));
      await expect(page.locator("#capture-label")).toContainText(
        "Chromium trace",
      );
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
      await page.evaluate(() => window.gwNative.diagnostics.stopCapture());
      await expect(page.locator("#capture-status")).toBeHidden();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("releases game input before opening the diagnostics save panel", async () => {
    const fixture = await launchOffline("gw-diagnostic-dialog-input-e2e-");
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }) => {
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

      expect(
        await page.evaluate(() => window.gwNative.diagnostics.export()),
      ).toBe("");
      expect(
        await page.evaluate(() => window.__diagnosticExportReleasedInput),
      ).toBe(true);
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
      await page.evaluate(() => window.gwNative.diagnostics.startCapture(1));
      await page.evaluate(async () => {
        window.gwDiagnostics.swap(200, 50, 25);
        await window.gwDiagnostics.flush();
      });
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.getMenuItemById("mark-performance-problem")
          ?.click();
      });
      await page.evaluate(() => window.gwNative.diagnostics.stopCapture());

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
              pointerLock: true,
              cursorTheme: "guild-wars",
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
      expect(manifest).toMatchObject({
        redaction: "passed",
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
