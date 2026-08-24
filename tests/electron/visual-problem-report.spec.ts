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
  test("binds each capture token to one window and consumes it once", async () => {
    const fixture = await launchOffline("gw-visual-token-e2e-");
    try {
      const result = await fixture.app.evaluate(
        async ({ BrowserWindow }, modulePath) => {
          const load = process.getBuiltinModule("node:module").createRequire(modulePath);
          const visual = load(modulePath);
          const owner = BrowserWindow.getAllWindows()[0];
          if (!owner) throw new Error("owner window is unavailable");
          const intruder = new BrowserWindow({ show: false });
          try {
            const token = visual.beginVisualCapture(owner);
            let duplicate = "accepted";
            try {
              visual.beginVisualCapture(owner);
            } catch {
              duplicate = "rejected";
            }
            let wrongOwner = "accepted";
            try {
              await visual.submitVisualCapture(intruder, {
                token,
                status: "failed",
                reason: "context-lost",
              });
            } catch {
              wrongOwner = "rejected";
            }
            await visual.submitVisualCapture(owner, {
              token,
              status: "failed",
              reason: "context-lost",
            });
            let replay = "accepted";
            try {
              await visual.submitVisualCapture(owner, {
                token,
                status: "failed",
                reason: "context-lost",
              });
            } catch {
              replay = "rejected";
            }
            const evidence = visual.takeVisualCapture(token);
            return {
              duplicate,
              wrongOwner,
              replay,
              missing: evidence?.missing,
              consumed: visual.takeVisualCapture(token) === null,
            };
          } finally {
            intruder.destroy();
          }
        },
        path.join(root, "build/main/visual-capture.js"),
      );
      expect(result).toEqual({
        duplicate: "rejected",
        wrongOwner: "rejected",
        replay: "rejected",
        missing: {
          webgl: "context-lost",
          offscreen: "context-lost",
          canvas: "context-lost",
          window: "context-lost",
        },
        consumed: true,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("captures the same submitted frame before and after off-screen transfer", async () => {
    const fixture = await launchOffline("gw-visual-frame-capture-e2e-");
    try {
      const result = await fixture.page.evaluate(async () => {
        const importRenderer = async <T>(specifier: string): Promise<T> =>
          import(specifier);
        const { installGraphics } = await importRenderer<
          typeof import("../../src/renderer/graphics.js")
        >("./graphics.js");
        const { createVisualFrameCapture } = await importRenderer<
          typeof import("../../src/renderer/visual-frame-capture.js")
        >("./visual-frame-capture.js");
        const canvas: HTMLCanvasElement & { offscreen?: OffscreenCanvas } =
          document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 4;
        const module: ArenaNetGraphicsModule = { canvas };
        const env: ArenaNetEglImports = {
          eglCreateContext: () => module.canvas.getContext("webgl"),
          eglSwapBuffers: () => 1,
        };
        installGraphics({
          env,
          module,
          renderScale: () => 1,
          firstFrame: () => undefined,
          log: () => undefined,
        });
        env.eglCreateContext();
        const gl = canvas.offscreen?.getContext("webgl");
        if (!gl) throw new Error("off-screen WebGL is unavailable");
        gl.clearColor(1, 0, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const capture = window.gwVisualCapture;
        if (!capture) throw new Error("visual capture controller is unavailable");
        const pending = capture.capture();
        env.eglSwapBuffers();
        const lease = await pending;

        const firstPixel = async (bytes: Uint8Array) => {
          const copy = Uint8Array.from(bytes);
          const bitmap = await createImageBitmap(new Blob([copy.buffer]));
          const decoded = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = decoded.getContext("2d");
          if (!context) throw new Error("2D decode context is unavailable");
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const webgl = await firstPixel(lease.webglPng);
        const offscreen = await firstPixel(lease.offscreenPng);
        const metadata = lease.metadata;
        lease.release();

        let directFailure = "unknown";
        try {
          await createVisualFrameCapture("direct").capture();
        } catch (error) {
          directFailure = error instanceof Error
            && "visualCaptureFailure" in error
            ? String(error.visualCaptureFailure)
            : "untyped";
        }
        return { webgl, offscreen, metadata, directFailure };
      });

      expect(result.webgl).toEqual([255, 0, 255, 255]);
      expect(result.offscreen).toEqual([255, 0, 255, 255]);
      expect(result.metadata).toMatchObject({
        offscreenWidth: 4,
        offscreenHeight: 4,
        drawingBufferWidth: 4,
        drawingBufferHeight: 4,
      });
      expect(result.directFailure).toBe("unsupported");
    } finally {
      await closeOffline(fixture);
    }
  });

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
                evidence: {
                  metadata: {},
                  images: { webgl: Uint8Array.from([137]) },
                  missing: {},
                  dimensions: {},
                },
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
        message: "visual capture evidence requires explicit consent",
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
      await page.evaluate(async () => {
        window.__diagnosticExportReleasedInput = false;
        window.addEventListener("gw:input-reset", () => {
          window.__diagnosticExportReleasedInput = true;
        });
        const proof = new OffscreenCanvas(1, 1);
        const context = proof.getContext("2d");
        if (!context) throw new Error("test 2D canvas is unavailable");
        context.fillStyle = "#ff00ff";
        context.fillRect(0, 0, 1, 1);
        const png = new Uint8Array(
          await (await proof.convertToBlob({ type: "image/png" })).arrayBuffer(),
        );
        window.gwVisualCapture = {
          async capture() {
            return {
              webglPng: png,
              offscreenPng: png,
              metadata: {
                frameSequence: 1,
                capturedAtRendererMs: performance.now(),
                canvasBounds: { x: 0, y: 0, width: 32, height: 32 },
                canvasWidth: 32,
                canvasHeight: 32,
                offscreenWidth: 1,
                offscreenHeight: 1,
                drawingBufferWidth: 1,
                drawingBufferHeight: 1,
                devicePixelRatio: 1,
              },
              release() {},
            };
          },
        };
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
        includedStages: ["webgl", "offscreen", "canvas", "window"],
        missingStages: {},
        screenshotPrivacy: "player-consented-unscanned",
      });
      expect(manifest.formatVersion).toBe(3);
      expect(manifest.includedFiles).toContain("visual-webgl.png");
      expect(manifest.includedFiles).toContain("runtime-state.json");
      const screenshot = await readFile(
        path.join(extracted, "visual-webgl.png"),
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
      const analysisRoot = path.join(saveRoot, "analysis");
      const analyzed = await execFileAsync(process.execPath, [
        path.join(root, "build/tools/diagnostics/visual.js"),
        target,
        analysisRoot,
      ]);
      expect(analyzed.stdout).toContain("webgl -> offscreen: 0.0000% mismatched");
      const analysis = JSON.parse(
        await readFile(path.join(analysisRoot, "visual-analysis.json"), "utf8"),
      );
      expect(analysis.comparisons[0].material).toBe(false);
      expect(analysis.arenaNetAttributionReady).toBe(false);
      expect(analysis.humanReviewRequired).toBe(true);
      expect(
        await stat(path.join(analysisRoot, "arenanet-report.md")).catch(() => null),
      ).toBeNull();
    } finally {
      await closeOffline(fixture);
      await rm(saveRoot, { recursive: true, force: true });
    }
  });
});
