/**
 * Independent structural certification for `events.jsonl`.
 *
 * This module imports neither the recorder nor the pattern scanner. It walks
 * the bytes that will be exported and requires every record to match the
 * canonical schema exactly: declared event, owned subsystem/level, exact
 * fields, and declared values. Unknown events and fields are export failures;
 * there is no open-field counter or fallback path.
 */
import { AppError } from "../../shared/errors.js";
import {
  DIAGNOSTIC_EVENT_SCHEMA,
  diagnosticEventSpec,
  type DiagnosticEventName,
} from "./schema.js";

type Guard<T> = (value: unknown) => value is T;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isNumber: Guard<number> = (value): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNonnegativeNumber: Guard<number> = (value): value is number =>
  isNumber(value) && value >= 0;
const isSequence: Guard<number> = (value): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const isOwnerId: Guard<number> = (value): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isString: Guard<string> = (value): value is string =>
  typeof value === "string";
const isIso: Guard<string> = (value): value is string =>
  typeof value === "string" && ISO.test(value);
const isUuid: Guard<string> = (value): value is string =>
  typeof value === "string" && UUID.test(value);

const ENVELOPE: Readonly<Record<string, Guard<unknown>>> = {
  seq: isSequence,
  tsUs: isNonnegativeNumber,
  wallTime: isIso,
  level: isString,
  subsystem: isString,
};
const OPTIONAL_ENVELOPE: Readonly<Record<string, Guard<unknown>>> = {
  durationUs: isNonnegativeNumber,
  traceId: isUuid,
  spanId: isUuid,
  ownerId: isOwnerId,
};

export interface EventLogInspection {
  /** Records walked. */
  records: number;
  /** Records matched exactly against the closed schema. Always equals records. */
  schemaChecked: number;
}

export interface RedactionResult extends EventLogInspection {
  /** Bytes of the Chromium trace passed through the pattern scanner. */
  traceBytesScanned: number;
}

function reject(what: string): AppError {
  // Positions and field names are safe; rejected values are never interpolated.
  return new AppError("validation", `diagnostics export: ${what}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function isEventName(value: unknown): value is DiagnosticEventName {
  return (
    typeof value === "string" &&
    Object.hasOwn(DIAGNOSTIC_EVENT_SCHEMA, value)
  );
}

function checkFields(
  name: DiagnosticEventName,
  fields: Record<string, unknown>,
  where: string,
): void {
  const guards = diagnosticEventSpec(name).fields;
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

function inspectRecord(
  value: unknown,
  where: string,
  into: EventLogInspection,
): void {
  if (!isPlainObject(value)) throw reject(`${where} is not an object`);
  for (const [key, guard] of Object.entries(ENVELOPE)) {
    if (!guard(value[key])) throw reject(`${where}: envelope field ${key}`);
  }
  if (!isEventName(value.name)) {
    throw reject(`${where}: undeclared event name`);
  }
  const spec = diagnosticEventSpec(value.name);
  if (value.subsystem !== spec.subsystem) {
    throw reject(`${where}: ${value.name} has the wrong subsystem`);
  }
  if (value.level !== spec.level) {
    throw reject(`${where}: ${value.name} has the wrong level`);
  }
  for (const key of Object.keys(value)) {
    if (
      Object.hasOwn(ENVELOPE, key) ||
      key === "name" ||
      key === "fields"
    ) {
      continue;
    }
    const guard = OPTIONAL_ENVELOPE[key];
    if (!guard) throw reject(`${where}: undeclared record key ${key}`);
    if (!guard(value[key])) throw reject(`${where}: record key ${key}`);
  }
  const fields = value.fields;
  if (fields !== undefined && !isPlainObject(fields)) {
    throw reject(`${where}: fields is not an object`);
  }
  checkFields(value.name, fields ?? {}, where);
  into.records += 1;
  into.schemaChecked += 1;
}

/** Walks an exported JSONL event log and fails closed on the first mismatch. */
export function inspectEventLog(text: string): EventLogInspection {
  const result: EventLogInspection = { records: 0, schemaChecked: 0 };
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
