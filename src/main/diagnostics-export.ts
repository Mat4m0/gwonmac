/**
 * Saves the diagnostics the recorder already holds. This module owns the
 * one-at-a-time guard and the player-facing export failure.
 */
import { dialog, type BrowserWindow } from "electron";
import { errorCode } from "../shared/errors.js";
import { logEvent } from "./diagnostics.js";
import { windowRegistry } from "./window-registry.js";

let diagnosticsExportInFlight = false;

export async function exportDiagnosticsReport(
  win: BrowserWindow,
  exportDiagnostics: () => Promise<string>,
): Promise<void> {
  const ownerId = windowRegistry.diagnosticOwnerForWindow(win);
  if (ownerId === null) {
    throw new Error("diagnostics export requires an account owner");
  }
  if (diagnosticsExportInFlight) {
    await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["OK"],
      message: "Another diagnostics export is in progress",
      detail: "Wait for it to finish, then try again.",
    }).catch(() => undefined);
    return;
  }
  diagnosticsExportInFlight = true;
  try {
    const saved = await exportDiagnostics();
    if (!saved) return;
    logEvent({ k: "diagnostics.exported" }, ownerId);
  } catch (error) {
    logEvent({ k: "diagnostics.exportFailed", code: errorCode(error) }, ownerId);
    await dialog.showMessageBox(win, {
      type: "error",
      buttons: ["OK"],
      message: "Diagnostics export failed",
      detail: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  } finally {
    diagnosticsExportInFlight = false;
  }
}
