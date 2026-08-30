/**
 * Hands validated, derived Cartography evidence to the existing diagnostics
 * ZIP workflow without exposing file-system capability to the renderer.
 */
import type { BrowserWindow } from "electron";
import {
  type CartographyEvidenceExportResult,
} from "../shared/cartography-evidence.js";
import type { AppSettings, ClientSession } from "../shared/contracts.js";
import {
  buildCartographyEvidenceReport,
  parseCartographyEvidenceCapture,
  renderCartographyEvidencePreview,
  renderCartographyEvidenceSummary,
} from "../tools/cartography-evidence/capture.js";
import { exportDiagnosticsReport } from "./diagnostics-export.js";
import { exportDiagnosticsForWindow } from "./diagnostics.js";

export async function exportCartographyEvidence(
  win: BrowserWindow,
  input: unknown,
  session: ClientSession,
  readSettings: () => Promise<AppSettings>,
): Promise<CartographyEvidenceExportResult> {
  const report = buildCartographyEvidenceReport(
    parseCartographyEvidenceCapture(input),
    session,
  );
  const preview = renderCartographyEvidencePreview(report);
  const summary = renderCartographyEvidenceSummary(report);
  let written = false;
  await exportDiagnosticsReport(win, async () => {
    const path = await exportDiagnosticsForWindow(win, readSettings, {
      cartographyEvidence: { report, preview, summary },
    });
    written = path !== "";
    return path;
  });
  return written ? { status: "written" } : { status: "cancelled" };
}
