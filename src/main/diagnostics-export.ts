/**
 * Saves the diagnostics the recorder already holds. This module owns the
 * one-at-a-time guard and the player-facing export failure.
 */
import { dialog } from "electron";
import { errorCode } from "../shared/errors.js";
import { logEvent } from "./diagnostics.js";

let diagnosticsExportInFlight = false;

export async function exportDiagnosticsReport(
  exportDiagnostics: () => Promise<string>,
): Promise<void> {
  if (diagnosticsExportInFlight) return;
  diagnosticsExportInFlight = true;
  try {
    const saved = await exportDiagnostics();
    if (!saved) return;
    logEvent({ k: "diagnostics.exported" });
  } catch (error) {
    logEvent({ k: "diagnostics.exportFailed", code: errorCode(error) });
    dialog.showErrorBox(
      "Diagnostics export failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    diagnosticsExportInFlight = false;
  }
}
