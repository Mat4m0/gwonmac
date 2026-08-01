import { dialog, shell, type BrowserWindow } from "electron";
import { EXTERNAL_URLS } from "../shared/contracts.js";
import { errorCode } from "../shared/errors.js";
import { logEvent } from "./diagnostics.js";
import { resetGameInput } from "./renderer-commands.js";
import type { WindowHost } from "./window.js";

/**
 * What a player does when something goes wrong: choose between exporting what
 * the recorder already holds and recording the problem as it happens, then be
 * handed the file and the place to attach it.
 *
 * Every surface that offers this — the menu, the settings pane, the crash
 * notice — arrives here, so the choice, the prose about what the archive
 * contains, and the one-at-a-time rule are stated once.
 */

const BUG_REPORT_URL =
  `${EXTERNAL_URLS.github}/issues/new?template=bug-report.yml`;

let problemReportInFlight = false;

export async function exportProblemReport(
  win: BrowserWindow,
  exportDiagnostics: () => Promise<string>,
): Promise<void> {
  // One report flow at a time, whichever surface asked: a second invocation
  // while the save dialog is up would stack sheets and run two exports.
  if (problemReportInFlight) return;
  problemReportInFlight = true;
  try {
    const saved = await exportDiagnostics();
    if (!saved) return;
    logEvent({ k: "diagnostics.exported" });
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Open Bug Report", "Reveal in Finder", "Done"],
      defaultId: 0,
      cancelId: 2,
      message: "Problem report ready",
      detail:
        "Diagnostics are optional. The .zip can be attached to the GitHub bug report as it is. It is redacted and contains no credentials.",
    });
    if (response === 0) await shell.openExternal(BUG_REPORT_URL);
    if (response === 1) shell.showItemInFolder(saved);
  } catch (error) {
    logEvent({ k: "diagnostics.exportFailed", code: errorCode(error) });
    // The prose is for the person in front of the screen, not for the export.
    dialog.showErrorBox(
      "Report export failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    problemReportInFlight = false;
  }
}

export async function reportProblem(
  win: BrowserWindow,
  host: Pick<WindowHost, "exportDiagnostics" | "startCapture">,
): Promise<void> {
  await resetGameInput(win);
  const { response } = await dialog.showMessageBox(win, {
    type: "info",
    buttons: [
      "Export Recent Diagnostics…",
      "Record Performance Problem",
      "Cancel",
    ],
    defaultId: 0,
    cancelId: 2,
    message: "Report a problem",
    detail:
      "Export immediately for crashes, startup, downloads, or general bugs. For stutter, record the problem, press Cmd+Shift+M when it happens, then stop the capture.",
  });
  if (response === 0) {
    await exportProblemReport(win, host.exportDiagnostics);
  }
  if (response === 1) {
    try {
      await host.startCapture(1);
    } catch (error) {
      dialog.showErrorBox(
        "Capture could not start",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
