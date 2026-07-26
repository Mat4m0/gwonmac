import type {
  EventChannel,
  InvokeChannel,
  SocketCloseReason,
  SocketFailureCode,
} from "../../shared/contracts.js";
import { EVENT_CHANNELS, IPC } from "../../shared/contracts.js";
import type {
  DiagnosticLevel,
  DiagnosticSubsystem,
} from "../../shared/diagnostics.js";
import { AppError, isErrorCode, type ErrorCode } from "../../shared/errors.js";
import { isProxyRoute, type ProxyRoute } from "../core/proxy-routes.js";
import {
  isDigest,
  type AppPhase,
  type Digest,
  type DiagnosticEvent,
  type DiagnosticEventName,
} from "./schema.js";

/**
 * The independent detector (P2.4).
 *
 * It imports nothing from `../diagnostic-recorder.js` and nothing from
 * `./text-scan.js`, and that is the point. The check it replaces was
 * `redactText(text) !== text` applied to output `redactText` had just
 * produced: it proved the redactor reached a fixed point and nothing else.
 * A detector that shares the redactor's patterns can only ever agree with it.
 *
 * This one works on structure. Every record in the exported event log is
 * matched against the closed schema in `./schema.js`: an event the schema
 * declares must carry **exactly** the fields the schema declares, each one a
 * value its declared guard accepts. There is no "looks like an enum" test —
 * a shape check is weaker than the phase claims, which is what the Appendix A
 * defect note says about the sketch this replaces.
 *
 * What it does not cover, it counts rather than waves through. Producers the
 * schema has not absorbed yet (spans, milestones, the `log()` counters) still
 * push strings into fields; `openFields` is how many such values the export
 * contains, and it reaches zero when the schema is complete. The manifest
 * carries that number instead of the word "passed".
 */

type Guard<T> = (value: unknown) => value is T;

/** `true` only when every member of `Union` appears in `Listed`. */
type Covers<Union extends string, Listed extends string> = [Union] extends [
  Listed,
]
  ? true
  : never;

function literal<T extends string>(values: readonly T[]): Guard<T> {
  const allowed: ReadonlySet<string> = new Set(values);
  return (value): value is T =>
    typeof value === "string" && allowed.has(value);
}

const LEVELS = ["debug", "info", "warn", "error"] as const;
const _levelsCover: Covers<DiagnosticLevel, (typeof LEVELS)[number]> = true;
const isLevel = literal<DiagnosticLevel>(LEVELS);

const SUBSYSTEMS = [
  "app",
  "update",
  "cache",
  "protocol",
  "snapshot",
  "renderer",
  "wasm",
  "graphics",
  "dns",
  "socket",
  "proxy",
  "settings",
  "credentials",
  "filesystem",
  "release",
] as const;
const _subsystemsCover: Covers<
  DiagnosticSubsystem,
  (typeof SUBSYSTEMS)[number]
> = true;
const isSubsystem = literal<DiagnosticSubsystem>(SUBSYSTEMS);

const APP_PHASES = ["startup", "quit"] as const;
const _phasesCover: Covers<AppPhase, (typeof APP_PHASES)[number]> = true;
const isAppPhase = literal<AppPhase>(APP_PHASES);

const CLOSE_REASONS = [
  "requested",
  "peer",
  "owner",
  "timeout",
  "error",
] as const;
const _closeReasonsCover: Covers<
  SocketCloseReason,
  (typeof CLOSE_REASONS)[number]
> = true;
const isCloseReason = literal<SocketCloseReason>(CLOSE_REASONS);

const FAILURE_CODES = [
  "timeout",
  "refused",
  "reset",
  "unreachable",
  "dns",
  "other",
] as const;
const _failureCodesCover: Covers<
  SocketFailureCode,
  (typeof FAILURE_CODES)[number]
> = true;
const isFailureCode = literal<SocketFailureCode>(FAILURE_CODES);

// Derived from the canonical channel table rather than listed, so there is no
// second copy for a `Covers<>` check to police: `InvokeChannel` is exactly the
// keys of `IPC` that are not event channels.
const isInvokeChannel = literal<InvokeChannel>(
  Object.keys(IPC).filter(
    (key): key is InvokeChannel =>
      !(EVENT_CHANNELS as readonly string[]).includes(key as EventChannel),
  ),
);

const isNumber: Guard<number> = (value): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCode: Guard<ErrorCode> = isErrorCode;

const isRoute: Guard<ProxyRoute> = (value): value is ProxyRoute =>
  typeof value === "string" && isProxyRoute(value);

const isDigestOrNull: Guard<Digest | null> = (value): value is Digest | null =>
  value === null || isDigest(value);

type FieldsOf<K extends DiagnosticEventName> = Omit<
  Extract<DiagnosticEvent, { k: K }>,
  "k"
>;

/**
 * One guard per field, and the guard must be a type predicate for exactly the
 * field's declared type. A missing field, an extra field or a guard for the
 * wrong type is a compile error here — so this table is a projection of the
 * schema rather than a second copy of it.
 */
type FieldGuards<K extends DiagnosticEventName> = {
  [F in keyof FieldsOf<K>]-?: Guard<Exclude<FieldsOf<K>[F], undefined>>;
};

const EVENT_FIELDS: { [K in DiagnosticEventName]: FieldGuards<K> } = {
  "app.uncaughtException": { code: isCode },
  "app.unhandledRejection": { code: isCode },
  "quit.cleanupFailed": { code: isCode },
  "capture.automationStartFailed": { code: isCode },
  "chromiumTrace.startFailed": { code: isCode },
  "chromiumTrace.stopFailed": { code: isCode },
  "diagnostics.exportFailed": { code: isCode },
  "browserCache.cleared": { phase: isAppPhase },
  "browserCache.clearFailed": { phase: isAppPhase, code: isCode },
  "browserCookies.cleared": { phase: isAppPhase },
  "browserCookies.clearFailed": { phase: isAppPhase, code: isCode },
  "cache.infoFailed": { code: isCode },
  "cache.clearRequestFailed": { code: isCode },
  "cache.staleChunkCleanupSkipped": { code: isCode },
  "prefetch.failed": { code: isCode },
  "fullDownload.failed": { code: isCode },
  "patch.updateFallback": { code: isCode },
  "patch.updateFailed": { code: isCode, fallbackCode: isCode },
  "client.candidatePromotionFailed": { code: isCode },
  "client.candidatePromoted": { fingerprint: isDigestOrNull },
  "client.candidateRolledBack": { fingerprint: isDigestOrNull },
  "client.candidateRolledBackAfterRendererCrash": {
    fingerprint: isDigestOrNull,
  },
  "client.integrityMetadataReady": { fingerprint: isDigestOrNull },
  "client.integrityMigrationSkipped": { code: isCode },
  "renderer.recoveryPreparationFailed": { code: isCode },
  "snapshot.rangeFailed": {
    offsetBytes: isNumber,
    bytes: isNumber,
    code: isCode,
  },
  "proxy.requestFailed": { route: isRoute, code: isCode },
  "socket.open": { socketId: isNumber },
  "socket.close": { socketId: isNumber, reason: isCloseReason },
  "socket.error": { socketId: isNumber, code: isFailureCode },
  "ipc.rejected": { channel: isInvokeChannel, code: isCode },
  "settings.loadFailed": { code: isCode },
  "settings.saveFailed": { code: isCode },
  "settings.resetFailed": { code: isCode },
  "filesystem.resetFailed": { code: isCode },
};

const DECLARED: ReadonlySet<string> = new Set(Object.keys(EVENT_FIELDS));

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What `canonicalEventName` produces, and nothing else. */
const EVENT_NAME = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/;

const isIso: Guard<string> = (value): value is string =>
  typeof value === "string" && ISO.test(value);
const isUuid: Guard<string> = (value): value is string =>
  typeof value === "string" && UUID.test(value);
const isEventName: Guard<string> = (value): value is string =>
  typeof value === "string" && EVENT_NAME.test(value);

const ENVELOPE: Readonly<Record<string, Guard<unknown>>> = {
  seq: isNumber,
  tsUs: isNumber,
  wallTime: isIso,
  level: isLevel,
  subsystem: isSubsystem,
  name: isEventName,
};

const OPTIONAL_ENVELOPE: Readonly<Record<string, Guard<unknown>>> = {
  durationUs: isNumber,
  traceId: isUuid,
  spanId: isUuid,
  parentSpanId: isUuid,
};

export interface EventLogInspection {
  /** Records walked. */
  records: number;
  /** Records matched exactly against the closed schema. */
  schemaChecked: number;
  /**
   * String values carried by records the schema does not declare. These are
   * the residue the closed schema has not absorbed yet; zero means the export
   * contains no free text this process authored.
   */
  openFields: number;
}

/**
 * What the export manifest records in place of the literal `"passed"`. Both
 * the exporter and the `.gwdiag` validator use this declaration, so the
 * manifest field has one owner.
 */
export interface RedactionResult extends EventLogInspection {
  /** Bytes of Chromium trace passed through the pattern scanner. */
  traceBytesScanned: number;
}

function reject(what: string): AppError {
  // The message names the position and the field, never the value: an export
  // failure must not become the leak it was trying to prevent.
  return new AppError("validation", `diagnostics export: ${what}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function checkDeclared(
  name: DiagnosticEventName,
  fields: Record<string, unknown>,
  where: string,
): void {
  const guards: Readonly<Record<string, Guard<unknown>>> = EVENT_FIELDS[name];
  for (const [key, guard] of Object.entries(guards)) {
    if (!Object.hasOwn(fields, key)) {
      throw reject(`${where}: ${name} is missing declared field ${key}`);
    }
    if (!guard(fields[key])) {
      throw reject(`${where}: ${name}.${key} is not a declared value`);
    }
  }
  for (const key of Object.keys(fields)) {
    if (!Object.hasOwn(guards, key)) {
      throw reject(`${where}: ${name} carries undeclared field ${key}`);
    }
  }
}

function countOpenFields(
  fields: Record<string, unknown>,
  where: string,
): number {
  let open = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      open += 1;
      continue;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      continue;
    }
    // `DiagnosticFields` is one flat layer of scalars. A nested object or an
    // array is a structure the recorder cannot have produced, so it is a
    // schema error rather than something to walk into.
    throw reject(`${where}: field ${key} is not a scalar`);
  }
  return open;
}

function inspectRecord(
  value: unknown,
  where: string,
  into: EventLogInspection,
): void {
  if (!isPlainObject(value)) throw reject(`${where} is not an object`);
  for (const [key, guard] of Object.entries(ENVELOPE)) {
    if (!guard(value[key])) throw reject(`${where}: envelope field ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (Object.hasOwn(ENVELOPE, key) || key === "fields") continue;
    const guard = OPTIONAL_ENVELOPE[key];
    if (!guard) throw reject(`${where}: undeclared record key ${key}`);
    if (!guard(value[key])) throw reject(`${where}: record key ${key}`);
  }
  const fields = value.fields;
  if (fields !== undefined && !isPlainObject(fields)) {
    throw reject(`${where}: fields is not an object`);
  }
  const present = fields ?? {};
  const name = value.name as string;
  if (DECLARED.has(name)) {
    checkDeclared(name as DiagnosticEventName, present, where);
    into.schemaChecked += 1;
  } else {
    into.openFields += countOpenFields(present, where);
  }
  into.records += 1;
}

/**
 * Walks an exported JSONL event log and throws on the first record that is not
 * exportable. Fail closed: the caller writes no export at all.
 */
export function inspectEventLog(text: string): EventLogInspection {
  const result: EventLogInspection = {
    records: 0,
    schemaChecked: 0,
    openFields: 0,
  };
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line) continue;
    const where = `line ${index + 1}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw reject(`${where} is not JSON`);
    }
    inspectRecord(parsed, where, result);
  }
  return result;
}
