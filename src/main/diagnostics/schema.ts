import type {
  InvokeChannel,
  SocketCloseReason,
  SocketFailureCode,
} from "../../shared/contracts.js";
import type {
  DiagnosticFields,
  DiagnosticLevel,
  DiagnosticScalar,
  DiagnosticSubsystem,
} from "../../shared/diagnostics.js";
import type { ErrorCode } from "../../shared/errors.js";
import { AppError } from "../../shared/errors.js";
import type { ProxyRoute } from "../core/proxy-routes.js";

/**
 * The closed schema for recorded diagnostic events.
 *
 * Free text is not redacted here — it is made unrepresentable. Every field of
 * every event is a number, a boolean, a member of a closed union, or a
 * `Digest`. There is no field an arbitrary string can reach, so there is
 * nothing for a redactor to miss.
 *
 * This union covers the producers that used to push `error.message` into a
 * field, plus the four that publish a client fingerprint. Events that carry no
 * fields at all were already safe and stay where they are; events join this
 * union as they are converted.
 */

/**
 * A 64-hex digest. `string` is deliberately *not* assignable to this, which is
 * what lets the guard at the bottom of this file tell a digest apart from
 * prose that merely happens to be a string.
 */
export type Digest = string & { readonly __digest: unique symbol };

const DIGEST = /^[a-f0-9]{64}$/;

export function asDigest(value: string): Digest {
  if (!DIGEST.test(value)) {
    throw new AppError("bad_digest", "expected a 64-character hex digest");
  }
  return value as Digest;
}

export function isDigest(value: unknown): value is Digest {
  return typeof value === "string" && DIGEST.test(value);
}

/** Which run of the application a lifecycle event belongs to. */
export type AppPhase = "startup" | "quit";

export type DiagnosticEvent =
  // Application lifecycle
  | { k: "app.uncaughtException"; code: ErrorCode }
  | { k: "app.unhandledRejection"; code: ErrorCode }
  | { k: "quit.cleanupFailed"; code: ErrorCode }
  // Diagnostics capture and export
  | { k: "capture.automationStartFailed"; code: ErrorCode }
  | { k: "chromiumTrace.startFailed"; code: ErrorCode }
  | { k: "chromiumTrace.stopFailed"; code: ErrorCode }
  | { k: "diagnostics.exportFailed"; code: ErrorCode }
  // Chromium storage clearing. `phase` is a field rather than part of the
  // event name: a templated name is an open string by another route.
  | { k: "browserCache.cleared"; phase: AppPhase }
  | { k: "browserCache.clearFailed"; phase: AppPhase; code: ErrorCode }
  | { k: "browserCookies.cleared"; phase: AppPhase }
  | { k: "browserCookies.clearFailed"; phase: AppPhase; code: ErrorCode }
  // Chunk cache
  | { k: "cache.infoFailed"; code: ErrorCode }
  | { k: "cache.clearRequestFailed"; code: ErrorCode }
  | { k: "cache.staleChunkCleanupSkipped"; code: ErrorCode }
  | { k: "prefetch.failed"; code: ErrorCode }
  | { k: "fullDownload.failed"; code: ErrorCode }
  // ArenaNet client update
  | { k: "patch.updateFallback"; code: ErrorCode }
  | { k: "patch.updateFailed"; code: ErrorCode; fallbackCode: ErrorCode }
  | { k: "client.candidatePromotionFailed"; code: ErrorCode }
  // Every fingerprint is `Digest | null`. Its producers parse it as 64-hex at
  // their own boundary, so null is unreachable in practice — but the crossing
  // into this schema must fail closed rather than throw inside a log call.
  | { k: "client.candidatePromoted"; fingerprint: Digest | null }
  | { k: "client.candidateRolledBack"; fingerprint: Digest | null }
  | {
      k: "client.candidateRolledBackAfterRendererCrash";
      fingerprint: Digest | null;
    }
  | { k: "client.integrityMetadataReady"; fingerprint: Digest | null }
  | { k: "client.integrityMigrationSkipped"; code: ErrorCode }
  // Renderer recovery
  | { k: "renderer.recoveryPreparationFailed"; code: ErrorCode }
  // Snapshot ranges over gw://app
  | { k: "snapshot.rangeFailed"; offsetBytes: number; bytes: number; code: ErrorCode }
  // Proxy. `route` is back: `PROXY_ROUTES` is a five-key allowlist and is now
  // `as const`, so `ProxyRoute` is a literal union rather than `string`.
  | { k: "proxy.requestFailed"; route: ProxyRoute; code: ErrorCode }
  // Managed TCP sockets. The event name used to be `socket.${event.type}` and
  // the payload carried libuv's `error.message`, which quotes the destination.
  | { k: "socket.open"; socketId: number }
  | { k: "socket.close"; socketId: number; reason: SocketCloseReason }
  | { k: "socket.error"; socketId: number; code: SocketFailureCode }
  // A renderer payload the channel's parser refused, recorded once for all of
  // them by the handler registry. `channel` is `InvokeChannel`, a literal union
  // derived from `IPC`, so it is closed for the same reason `route` above is.
  | { k: "ipc.rejected"; channel: InvokeChannel; code: ErrorCode }
  // Settings and saved game files
  | { k: "settings.loadFailed"; code: ErrorCode }
  | { k: "settings.saveFailed"; code: ErrorCode }
  | { k: "settings.resetFailed"; code: ErrorCode }
  | { k: "filesystem.resetFailed"; code: ErrorCode };

export type DiagnosticEventName = DiagnosticEvent["k"];

interface EventSpec {
  subsystem: DiagnosticSubsystem;
  level: DiagnosticLevel;
}

/**
 * Subsystem and level belong to the event, not to the call site. Two producers
 * of the same event cannot disagree about which subsystem it came from.
 */
const EVENT_SPECS = {
  "app.uncaughtException": { subsystem: "app", level: "error" },
  "app.unhandledRejection": { subsystem: "app", level: "error" },
  "quit.cleanupFailed": { subsystem: "app", level: "error" },
  "capture.automationStartFailed": { subsystem: "app", level: "error" },
  "chromiumTrace.startFailed": { subsystem: "app", level: "error" },
  "chromiumTrace.stopFailed": { subsystem: "app", level: "error" },
  "diagnostics.exportFailed": { subsystem: "app", level: "error" },
  "browserCache.cleared": { subsystem: "app", level: "info" },
  "browserCache.clearFailed": { subsystem: "app", level: "warn" },
  "browserCookies.cleared": { subsystem: "app", level: "info" },
  "browserCookies.clearFailed": { subsystem: "app", level: "warn" },
  "cache.infoFailed": { subsystem: "cache", level: "error" },
  "cache.clearRequestFailed": { subsystem: "cache", level: "error" },
  "cache.staleChunkCleanupSkipped": { subsystem: "cache", level: "warn" },
  "prefetch.failed": { subsystem: "cache", level: "warn" },
  "fullDownload.failed": { subsystem: "cache", level: "error" },
  "patch.updateFallback": { subsystem: "update", level: "warn" },
  "patch.updateFailed": { subsystem: "update", level: "error" },
  "client.candidatePromotionFailed": { subsystem: "update", level: "error" },
  "client.candidatePromoted": { subsystem: "update", level: "info" },
  "client.candidateRolledBack": { subsystem: "update", level: "warn" },
  "client.candidateRolledBackAfterRendererCrash": {
    subsystem: "update",
    level: "warn",
  },
  "client.integrityMetadataReady": { subsystem: "update", level: "info" },
  "client.integrityMigrationSkipped": { subsystem: "update", level: "warn" },
  "renderer.recoveryPreparationFailed": {
    subsystem: "renderer",
    level: "error",
  },
  "snapshot.rangeFailed": { subsystem: "snapshot", level: "error" },
  "proxy.requestFailed": { subsystem: "proxy", level: "error" },
  "socket.open": { subsystem: "socket", level: "info" },
  "socket.close": { subsystem: "socket", level: "info" },
  "socket.error": { subsystem: "socket", level: "warn" },
  "ipc.rejected": { subsystem: "app", level: "warn" },
  "settings.loadFailed": { subsystem: "settings", level: "error" },
  "settings.saveFailed": { subsystem: "settings", level: "error" },
  "settings.resetFailed": { subsystem: "settings", level: "error" },
  "filesystem.resetFailed": { subsystem: "filesystem", level: "error" },
} as const satisfies Record<DiagnosticEventName, EventSpec>;

export interface DiagnosticEventRecord {
  subsystem: DiagnosticSubsystem;
  level: DiagnosticLevel;
  name: DiagnosticEventName;
  fields: DiagnosticFields;
}

/**
 * Flattens an event into what the flight recorder writes. The recorder keeps
 * ownership of sequencing, timestamps and files; this owns the mapping from a
 * typed event to its name, subsystem, level and fields.
 */
export function diagnosticEventRecord(
  event: DiagnosticEvent,
): DiagnosticEventRecord {
  const spec: EventSpec = EVENT_SPECS[event.k];
  const fields: DiagnosticFields = {};
  // `Object.entries` over a union loses the value type. The copy is sound
  // because `_scalarsOnly` below proves every field of every event already is
  // a `DiagnosticScalar` — there is nothing here to validate at runtime.
  for (const [key, value] of Object.entries(event)) {
    if (key !== "k") fields[key] = value;
  }
  return {
    subsystem: spec.subsystem,
    level: spec.level,
    name: event.k,
    fields,
  };
}

/**
 * P2.2 — the guard that makes the schema above enforceable rather than
 * aspirational.
 *
 * `FreeTextKeys` distributes over the union and collects any key whose type
 * `string` is assignable to. Literal unions, `ErrorCode` and `Digest` all
 * survive, because `string` extends none of them. The moment someone adds
 * `message: string` to any event, the annotation below becomes `never`, `true`
 * stops being assignable to it, and this file fails to compile.
 */
type FreeTextKeys<T> = T extends unknown
  ? { [K in keyof T]-?: string extends T[K] ? K : never }[keyof T]
  : never;

const _noFreeText: [FreeTextKeys<DiagnosticEvent>] extends [never]
  ? true
  : never = true;

/**
 * The companion property: no event field is a nested object or an array
 * either, so the whole schema is one flat layer of scalars. Without this,
 * `{ detail: { message: string } }` would slip past the guard above.
 */
const _scalarsOnly: DiagnosticEvent extends Record<
  string,
  DiagnosticScalar | undefined
>
  ? true
  : never = true;
