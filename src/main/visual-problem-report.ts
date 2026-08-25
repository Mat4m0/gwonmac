/**
 * The one player-facing visual-problem workflow. It records the initiating
 * renderer's exact bounded graphics state, optionally captures only that
 * window after explicit consent, and feeds both into the existing owner-bound
 * diagnostics ZIP.
 */
import { dialog, shell, type BrowserWindow } from "electron";
import type {
  AppSettings,
  RuntimeDiagnosticState,
} from "../shared/contracts.js";
import { exportDiagnosticsReport } from "./diagnostics-export.js";
import { exportDiagnosticsForWindow } from "./diagnostics/export.js";
import { sendRendererCommand } from "./renderer-commands.js";
import { windowRegistry } from "./window-registry.js";
import {
  beginVisualCapture,
  cancelVisualCapture,
  takeVisualCapture,
} from "./visual-capture.js";

const SWISS_TRANSFER_URL = "https://www.swisstransfer.com/";

export function reportVisualProblem(
  win: BrowserWindow,
  readSettings: () => Promise<AppSettings>,
  readRuntimeState: () => Promise<RuntimeDiagnosticState>,
): Promise<void> {
  return exportDiagnosticsReport(win, async () => {
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Include Images", "Diagnostics Only", "Cancel"],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
      message: "Capture visual corruption",
      detail:
        "Four synchronized images help locate where corruption begins. They can show your character, account name, or visible chat. Nothing is uploaded automatically.",
    });
    if (response === 2 || win.isDestroyed()) return "";

    const screenshotRequested = response === 0;
    const runtimeStatePromise = readRuntimeState();
    // This is defect-time evidence. Sampling again after the save dialog could
    // turn a two-account reproduction into a one-account report.
    const gameWindowCount = windowRegistry.gameWindows().length;
    let token: string | null = null;
    let evidence = null;
    let rendererOutcome;
    try {
      if (screenshotRequested) {
        token = beginVisualCapture(win);
        rendererOutcome = await sendRendererCommand(win, {
          type: "diagnostics.visual",
          token,
        });
        evidence = takeVisualCapture(token);
        token = null;
      } else {
        rendererOutcome = await sendRendererCommand(win, {
          type: "diagnostics.capture",
          action: "visual-problem",
        });
      }
    } finally {
      if (token) cancelVisualCapture(token);
    }
    const runtimeState = await runtimeStatePromise;

    const reportPath = await exportDiagnosticsForWindow(win, readSettings, {
      runtimeState,
      visualProblem: screenshotRequested
        ? {
            rendererOutcome,
            gameWindowCount,
            screenshotRequested: true,
            evidence,
            ...(!evidence
              ? {
                  failureReason: rendererOutcome === "timed-out"
                    ? "timed-out" as const
                    : "capture-failed" as const,
                }
              : {}),
          }
        : {
            rendererOutcome,
            gameWindowCount,
            screenshotRequested: false,
          },
    });
    if (!reportPath || win.isDestroyed()) return reportPath;
    const { response: next } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Show in Finder", "Open SwissTransfer", "Done"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: "Visual corruption report saved",
      detail:
        "Review the ZIP because its images can contain names or chat. Upload it manually to SwissTransfer, then send the download link with your bug report.",
    });
    if (next === 0) shell.showItemInFolder(reportPath);
    if (next === 1) await shell.openExternal(SWISS_TRANSFER_URL);
    return reportPath;
  });
}
