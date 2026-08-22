/**
 * The bounded operations worth timing, each one begin/end pair declared here.
 *
 * A span is closed by construction: the caller receives nothing but `end`, the
 * finish event is derived from the begin event's own fields, and a second
 * `end` is ignored — so an unbalanced pair cannot reach the recorder and a
 * histogram cannot be fed a duration no event accounts for.
 */
import { randomUUID } from "node:crypto";
import type { Digest } from "../../shared/digest.js";
import type { ErrorCode } from "../../shared/errors.js";
import type { ProxyRoute } from "../core/proxy-routes.js";
import {
  activeCaptureLevel,
  captureOwnsDiagnosticOwner,
} from "./capture.js";
import { recordEvent, recorder } from "./recorder.js";
import type {
  AppDiagnosticEvent,
  OwnerDiagnosticEvent,
} from "./schema.js";

export interface ClosedDiagnosticSpan<End> {
  readonly traceId: string;
  readonly spanId: string;
  end(outcome: End): number;
}

function closedAppSpan<End>(
  begin: AppDiagnosticEvent,
  finish: (outcome: End) => AppDiagnosticEvent,
  histogram: string,
): ClosedDiagnosticSpan<End> {
  const started = recorder.timestampUs();
  const traceId = randomUUID();
  const spanId = randomUUID();
  recordEvent(begin, { traceId, spanId });
  let ended = false;
  return {
    traceId,
    spanId,
    end(outcome) {
      if (ended) return 0;
      ended = true;
      const durationUs = recorder.timestampUs() - started;
      recorder.observe(histogram, durationUs);
      recordEvent(finish(outcome), { durationUs, traceId, spanId });
      return durationUs;
    },
  };
}

function closedOwnerSpan<End>(
  begin: OwnerDiagnosticEvent,
  finish: (outcome: End) => OwnerDiagnosticEvent,
  histogram: string,
  ownerId: number | undefined,
  recordEvents = true,
): ClosedDiagnosticSpan<End> {
  const started = recorder.timestampUs();
  const traceId = randomUUID();
  const spanId = randomUUID();
  if (recordEvents && ownerId !== undefined) {
    recordEvent(begin, { traceId, spanId }, ownerId);
  }
  let ended = false;
  return {
    traceId,
    spanId,
    end(outcome) {
      if (ended) return 0;
      ended = true;
      const durationUs = recorder.timestampUs() - started;
      recorder.observe(histogram, durationUs, ownerId);
      if (ownerId !== undefined && (recordEvents || durationUs >= 50_000)) {
        recordEvent(finish(outcome), { durationUs, traceId, spanId }, ownerId);
      }
      return durationUs;
    },
  };
}

export function startDnsResolveSpan(ownerId?: number): ClosedDiagnosticSpan<
  | { status: "ok"; code: null }
  | { status: "error"; code: ErrorCode }
> {
  return closedOwnerSpan(
    { k: "dns.resolve.begin" },
    (outcome) => ({ k: "dns.resolve.end", ...outcome }),
    "dns.resolve",
    ownerId,
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
  return closedAppSpan(
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
  ownerId?: number,
): ClosedDiagnosticSpan<SnapshotReadSpanOutcome> {
  return closedOwnerSpan(
    { k: "snapshot.read.begin", ...start },
    (outcome) => ({ k: "snapshot.read.end", ...start, ...outcome }),
    "snapshot.read",
    ownerId,
    ownerId === undefined
      ? activeCaptureLevel() > 0
      : captureOwnsDiagnosticOwner(ownerId),
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
  ownerId?: number,
): ClosedDiagnosticSpan<ProxyRequestSpanOutcome> {
  return closedOwnerSpan(
    { k: "proxy.request.begin", ...start },
    (outcome) => ({ k: "proxy.request.end", ...start, ...outcome }),
    "proxy.request",
    ownerId,
    true,
  );
}
