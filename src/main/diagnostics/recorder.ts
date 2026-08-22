/**
 * The one main-process flight recorder, and the only writes into it.
 *
 * Every other module in this subsystem records through the functions here
 * rather than holding a recorder of its own, so a second recorder — with its
 * own session id, its own ring, and its own JSONL — cannot exist.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { gamePaths } from "../paths.js";
import { FlightRecorder } from "./flight-recorder.js";
import {
  diagnosticEventSpec,
  type AppDiagnosticEvent,
  type DiagnosticEvent,
  type OwnerDiagnosticEvent,
} from "./schema.js";

export const recorder = new FlightRecorder();

/**
 * The only way to record an event that carries information about a failure.
 * The event owns its name, subsystem, level and fields, so two producers of
 * one event cannot disagree, and no field of one can hold free text.
 */
export interface EventDetail {
  durationUs?: number;
  traceId?: string;
  spanId?: string;
  timestampUs?: number;
}

function writeEvent(
  event: DiagnosticEvent,
  detail: EventDetail,
  ownerId?: number,
): void {
  const scope = diagnosticEventSpec(event.k).scope;
  if (
    (scope === "owner" && ownerId === undefined)
    || (scope === "app" && ownerId !== undefined)
  ) {
    throw new Error(`diagnostic event ${event.k} has invalid ${scope} ownership`);
  }
  recorder.record(event, detail, ownerId);
}

export function recordEvent(
  event: AppDiagnosticEvent,
  detail?: EventDetail,
): void;
export function recordEvent(
  event: OwnerDiagnosticEvent,
  detail: EventDetail,
  ownerId: number,
): void;
export function recordEvent(
  event: DiagnosticEvent,
  detail: EventDetail = {},
  ownerId?: number,
): void {
  writeEvent(event, detail, ownerId);
}

/** The only public event-recording API. */
export function logEvent(event: AppDiagnosticEvent): void;
export function logEvent(event: OwnerDiagnosticEvent, ownerId: number): void;
export function logEvent(event: DiagnosticEvent, ownerId?: number): void {
  writeEvent(event, {}, ownerId);
}

export function count(name: string, delta = 1, ownerId?: number): void {
  recorder.count(name, delta, ownerId);
}

export function observe(name: string, durationUs: number, ownerId?: number): void {
  recorder.observe(name, durationUs, ownerId);
}

export function gauge(
  name: string,
  value: string | number | boolean | null,
): void {
  recorder.setLatest(name, value);
}

export function peakGauge(name: string, value: number): void {
  recorder.setPeak(name, value);
}

export function diagnosticTimestampUs(): number {
  return recorder.timestampUs();
}

export async function flushDiagnostics(): Promise<void> {
  await recorder.flush();
}

/**
 * The recorder owns the diagnostics directory outright, and the only entries
 * that must outlive a launch are earlier sessions' JSONL. A whitelist is the
 * rule: prefix matching missed Chromium's `.<bundle-id>.XXXXXX` atomic-write
 * temporaries, which left a truncated 111 MB trace behind for days.
 */
function staleDiagnosticEntries(names: string[]): string[] {
  return names.filter((name) => !/^session-.+\.jsonl$/.test(name));
}

export async function sweepDiagnosticsDirectory(): Promise<void> {
  const diagnosticsDir = gamePaths().diagnostics;
  const stale = staleDiagnosticEntries(
    await readdir(diagnosticsDir).catch(() => []),
  ).map((name) => path.join(diagnosticsDir, name));
  await Promise.all(
    stale.map((file) => rm(file, { recursive: true, force: true })),
  );
}
