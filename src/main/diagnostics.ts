/**
 * The diagnostics subsystem's one entry point, and the composition of its
 * parts: the recorder under `./diagnostics/`, the capture session, the OS
 * samplers, the renderer's reports, and the export.
 *
 * Main-process features import diagnostics from here. The low-level renderer
 * command transport imports the recorder leaf directly because capture uses
 * that transport; routing its log back through this facade would close a
 * diagnostics → capture → renderer-commands → diagnostics runtime cycle.
 */
import type { BrowserWindow } from "electron";
import type { DiagnosticSummary } from "../shared/diagnostics.js";
import {
  activeCaptureLevel,
  captureLevelForWindow,
  discardTrace,
  stopDiagnosticCapture,
} from "./diagnostics/capture.js";
import { recorder, sweepDiagnosticsDirectory } from "./diagnostics/recorder.js";
import { startSampling, stopSampling } from "./diagnostics/samplers.js";
import { windowRegistry } from "./window-registry.js";

export {
  count,
  diagnosticTimestampUs,
  flushDiagnostics,
  gauge,
  logEvent,
  observe,
  peakGauge,
} from "./diagnostics/recorder.js";
export {
  markPerformanceProblem,
  setDiagnosticCaptureStoppedHandler,
  startDiagnosticCapture,
  stopDiagnosticCapture,
  stopDiagnosticCaptureForWindow,
} from "./diagnostics/capture.js";
export {
  startClientUpdateSpan,
  startDnsResolveSpan,
  startProxyRequestSpan,
  startSnapshotReadSpan,
  type ClientUpdateSpanOutcome,
  type ClosedDiagnosticSpan,
  type ProxyRequestSpanOutcome,
  type ProxyRequestSpanStart,
  type SnapshotReadSpanOutcome,
  type SnapshotReadSpanStart,
} from "./diagnostics/spans.js";
export {
  forgetRendererDiagnosticsOwner,
  recordClockOffset,
  recordGraphics,
  recordRendererFrames,
  recordRendererMetrics,
  recordRendererMilestone,
  resetRendererDiagnostics,
} from "./diagnostics/renderer.js";
export {
  exportDiagnosticsForWindow,
  exportDiagnosticsZip,
} from "./diagnostics/export.js";

/** The live summary, which reports whatever a running capture is paying for. */
export function diagnosticSummary(win?: BrowserWindow): DiagnosticSummary {
  if (!win) return recorder.summary(activeCaptureLevel());
  const level = captureLevelForWindow(win);
  const ownerId = windowRegistry.diagnosticOwnerForWindow(win);
  if (ownerId === null) return recorder.summary(0);
  return level === 0
    ? recorder.summaryForOwner(ownerId, 0)
    : recorder.activeCaptureSummary(level);
}

export async function startDiagnostics(): Promise<void> {
  await sweepDiagnosticsDirectory();
  startSampling();
}

export async function stopDiagnostics(): Promise<void> {
  stopSampling();
  await stopDiagnosticCapture("shutdown");
  await recorder.flush();
  // A session that is never exported still bounds itself at quit rather than
  // waiting for the next launch to sweep.
  await discardTrace();
}
