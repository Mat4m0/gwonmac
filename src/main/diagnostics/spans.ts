import { randomUUID } from "node:crypto";
import type { Digest } from "../../shared/digest.js";
import type { ErrorCode } from "../../shared/errors.js";
import type { ProxyRoute } from "../core/proxy-routes.js";
import { activeCaptureLevel } from "./capture.js";
import { recordEvent, recorder } from "./recorder.js";
import type { DiagnosticEvent } from "./schema.js";

/**
 * The bounded operations worth timing, each one begin/end pair declared here.
 *
 * A span is closed by construction: the caller receives nothing but `end`, the
 * finish event is derived from the begin event's own fields, and a second
 * `end` is ignored — so an unbalanced pair cannot reach the recorder and a
 * histogram cannot be fed a duration no event accounts for.
 */

export interface ClosedDiagnosticSpan<End> {
  readonly traceId: string;
  readonly spanId: string;
  end(outcome: End): number;
}

function closedSpan<End>(
  begin: DiagnosticEvent,
  finish: (outcome: End) => DiagnosticEvent,
  histogram: string,
  recordEvents = true,
): ClosedDiagnosticSpan<End> {
  const started = recorder.timestampUs();
  const traceId = randomUUID();
  const spanId = randomUUID();
  if (recordEvents) recordEvent(begin, { traceId, spanId });
  let ended = false;
  return {
    traceId,
    spanId,
    end(outcome) {
      if (ended) return 0;
      ended = true;
      const durationUs = recorder.timestampUs() - started;
      recorder.observe(histogram, durationUs);
      if (recordEvents || durationUs >= 50_000) {
        recordEvent(finish(outcome), { durationUs, traceId, spanId });
      }
      return durationUs;
    },
  };
}

export function startDnsResolveSpan(): ClosedDiagnosticSpan<
  | { status: "ok"; code: null }
  | { status: "error"; code: ErrorCode }
> {
  return closedSpan(
    { k: "dns.resolve.begin" },
    (outcome) => ({ k: "dns.resolve.end", ...outcome }),
    "dns.resolve",
  );
}

export type ClientUpdateSpanOutcome =
  | {
      status: "rejectedCandidateSkipped" | "candidate" | "ready";
      code: null;
      fingerprint: Digest | null;
    }
  | {
      status: "cachedFallback" | "error";
      code: ErrorCode;
      fingerprint: null;
    }
  | {
      status: "cancelled";
      code: null;
      fingerprint: null;
    };

export function startClientUpdateSpan(): ClosedDiagnosticSpan<ClientUpdateSpanOutcome> {
  return closedSpan(
    { k: "update.clientUpdate.begin" },
    (outcome) => ({ k: "update.clientUpdate.end", ...outcome }),
    "update.clientUpdate",
  );
}

export interface SnapshotReadSpanStart {
  offsetBytes: number;
  requestedBytes: number;
  priority: "demand" | "prefetch";
}

export type SnapshotReadSpanOutcome =
  | { returnedBytes: number; status: 206; code: null }
  | { returnedBytes: 0; status: 503; code: ErrorCode };

export function startSnapshotReadSpan(
  start: SnapshotReadSpanStart,
): ClosedDiagnosticSpan<SnapshotReadSpanOutcome> {
  return closedSpan(
    { k: "snapshot.read.begin", ...start },
    (outcome) => ({ k: "snapshot.read.end", ...start, ...outcome }),
    "snapshot.read",
    activeCaptureLevel() > 0,
  );
}

export interface ProxyRequestSpanStart {
  route: ProxyRoute;
  method: "GET" | "POST" | "PUT";
}

export type ProxyRequestSpanOutcome =
  | { status: number; reason: null; code: null }
  | { status: 413; reason: "bodyTooLarge"; code: null }
  | { status: 502; reason: "redirectEscape"; code: null }
  | { status: 502; reason: null; code: ErrorCode };

export function startProxyRequestSpan(
  start: ProxyRequestSpanStart,
): ClosedDiagnosticSpan<ProxyRequestSpanOutcome> {
  return closedSpan(
    { k: "proxy.request.begin", ...start },
    (outcome) => ({ k: "proxy.request.end", ...start, ...outcome }),
    "proxy.request",
  );
}
