import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { closeOffline, launchOffline, root } from "./fixtures.mjs";

declare global {
  interface Window {
    __diagnosticExportReleasedInput?: boolean;
  }
}

const execFileAsync = promisify(execFile);
const clickMenu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
    if (!item) throw new Error(`menu item ${menuId} is missing`);
    item.click();
  }, id);

test.describe("visual problem report", () => {
  test("refuses visual screenshot bytes without consent before export", async () => {
    const fixture = await launchOffline("gw-visual-consent-boundary-e2e-");
    const saveRoot = await mkdtemp(path.join(tmpdir(), "gw-visual-consent-"));
    const target = path.join(saveRoot, "must-not-exist.zip");
    try {
      const outcome = await fixture.app.evaluate(
        async ({ app: electronApp, BrowserWindow }, args) => {
          const load = process
            .getBuiltinModule("node:module")
            .createRequire(args.modulePath);
          const diagnostics = load(args.modulePath);
          const { DEFAULT_SETTINGS } = load(args.contractsPath);
          const { windowRegistry } = load(args.registryPath);
          const owner = BrowserWindow.getAllWindows()[0];
          const ownerId = owner
            ? windowRegistry.diagnosticOwnerForWindow(owner)
            : null;
          if (ownerId === null) throw new Error("diagnostics owner is unavailable");
          try {
            await diagnostics.exportDiagnosticsZip(args.target, {
              appVersion: electronApp.getVersion(),
              diagnosticOwnerId: ownerId,
              includePreviousSession: false,
              electronVersions: { electron: process.versions.electron },
              settings: DEFAULT_SETTINGS,
              visualProblem: {
                rendererOutcome: "completed",
                gameWindowCount: 1,
                screenshotRequested: false,
                screenshotPng: Uint8Array.from([
                  137, 80, 78, 71, 13, 10, 26, 10,
                ]),
              },
            });
            return { accepted: true, message: null };
          } catch (error) {
            return {
              accepted: false,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
        {
          modulePath: path.join(root, "build/main/diagnostics.js"),
          contractsPath: path.join(root, "build/shared/contracts.js"),
          registryPath: path.join(root, "build/main/window-registry.js"),
          target,
        },
      );
      expect(outcome).toEqual({
        accepted: false,
        message: "visual-problem screenshot requires explicit consent",
      });
      expect(await stat(target).catch(() => null)).toBeNull();
    } finally {
      await closeOffline(fixture);
      await rm(saveRoot, { recursive: true, force: true });
    }
  });

  test("exports an owner-bound visual report with a consented screenshot", async () => {
    const fixture = await launchOffline("gw-visual-problem-report-e2e-");
    const saveRoot = await mkdtemp(path.join(tmpdir(), "gw-visual-report-"));
    const target = path.join(saveRoot, "visual-problem.zip");
    const extracted = path.join(saveRoot, "extracted");
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showMessageBox = async (...args: unknown[]) => {
          const options = args.at(-1);
          if (
            !options
            || typeof options !== "object"
            || !("defaultId" in options)
            || options.defaultId !== 1
          ) {
            throw new Error("visual screenshot consent must be opt-in");
          }
          return { response: 0, checkboxChecked: false };
        };
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, target);
      await page.evaluate(() => {
        window.__diagnosticExportReleasedInput = false;
        window.addEventListener("gw:input-reset", () => {
          window.__diagnosticExportReleasedInput = true;
        });
      });

      await clickMenu(app, "report-visual-problem");
      await expect.poll(async () =>
        (await stat(target).catch(() => null))?.size ?? 0,
      ).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__diagnosticExportReleasedInput))
        .toBe(true);

      await execFileAsync("ditto", ["-x", "-k", target, extracted]);
      const manifest = JSON.parse(
        await readFile(path.join(extracted, "manifest.json"), "utf8"),
      );
      expect(manifest.visualProblem).toEqual({
        rendererOutcome: "completed",
        gameWindowCount: 1,
        screenshotRequested: true,
        screenshotIncluded: true,
        screenshotPrivacy: "player-consented-unscanned",
      });
      expect(manifest.includedFiles).toContain("visual-problem.png");
      const screenshot = await readFile(
        path.join(extracted, "visual-problem.png"),
      );
      expect([...screenshot.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      expect(
        await readFile(path.join(extracted, "events.jsonl"), "utf8"),
      ).toContain('"name":"graphics.visualProblem"');

      const validated = await execFileAsync(process.execPath, [
        path.join(root, "build/tools/diagnostics/validate.js"),
        target,
      ]);
      expect(validated.stdout).toContain("valid capture");
    } finally {
      await closeOffline(fixture);
      await rm(saveRoot, { recursive: true, force: true });
    }
  });
});
