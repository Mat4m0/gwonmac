/**
 * The one player-facing visual-problem workflow. It records the initiating
 * renderer's exact bounded graphics state, optionally captures only that
 * window after explicit consent, and feeds both into the existing owner-bound
 * diagnostics ZIP.
 */
import { dialog, type BrowserWindow } from "electron";
import type { AppSettings } from "../shared/contracts.js";
import { exportDiagnosticsReport } from "./diagnostics-export.js";
import { exportDiagnosticsForWindow } from "./diagnostics/export.js";
import { sendRendererCommand } from "./renderer-commands.js";
import { windowRegistry } from "./window-registry.js";

export function reportVisualProblem(
  win: BrowserWindow,
  readSettings: () => Promise<AppSettings>,
): Promise<void> {
  return exportDiagnosticsReport(win, async () => {
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Include Screenshot", "Diagnostics Only", "Cancel"],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
      message: "Report a visual problem",
      detail:
        "A screenshot helps identify missing or corrupted textures. It can show your character, account name, or visible chat. Diagnostics never include passwords, tokens, raw game memory, or texture pixels.",
    });
    if (response === 2 || win.isDestroyed()) return "";

    const screenshotRequested = response === 0;
    // This is defect-time evidence. Sampling again after the save dialog could
    // turn a two-account reproduction into a one-account report.
    const gameWindowCount = windowRegistry.gameWindows().length;
    const rendererOutcome = await sendRendererCommand(win, {
      type: "diagnostics.capture",
      action: "visual-problem",
    });
    let screenshotPng: Uint8Array | undefined;
    if (
      screenshotRequested
      && !win.isDestroyed()
      && !win.webContents.isDestroyed()
    ) {
      const image = await win.capturePage().catch(() => null);
      if (image && !image.isEmpty()) screenshotPng = image.toPNG();
    }

    return exportDiagnosticsForWindow(win, readSettings, {
      visualProblem: screenshotRequested
        ? {
            rendererOutcome,
            gameWindowCount,
            screenshotRequested: true,
            ...(screenshotPng ? { screenshotPng } : {}),
          }
        : {
            rendererOutcome,
            gameWindowCount,
            screenshotRequested: false,
          },
    });
  });
}
