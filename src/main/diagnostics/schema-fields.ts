/**
 * The one runtime and compile-time schema for app-authored diagnostic events.
 *
 * Event names, subsystem/level ownership, field names, and field validators
 * live together. Producers receive the type derived from this value, and the
 * export detector executes these exact validators. There is no permissive
 * fallback: if an event is absent here, it cannot be recorded or exported.
 */
import {
  EVENT_CHANNELS,
  IPC,
  type AppUpdateErrorCode,
  type EventChannel,
  type InvokeChannel,
  type RendererCommand,
  type RendererCommandOutcome,
  type SocketCloseReason,
  type SocketFailureCode,
} from "../../shared/contracts.js";
import {
  isDigest,
  type Digest,
} from "../../shared/digest.js";
import {
  type DiagnosticLevel,
  type DiagnosticScalar,
  type DiagnosticSubsystem,
} from "../../shared/diagnostics.js";
import { AppError, isErrorCode, type ErrorCode } from "../../shared/errors.js";
import {
  formatReleaseVersion,
  parseReleaseVersion,
} from "../../shared/release.js";
import type { AppUpdateStage } from "../app-updater.js";
import { LOCAL_VERIFICATION_REASONS } from "../certification/local-client-verifier.js";
import {
  isProxyRoute,
  type ProxyRoute,
} from "../core/proxy-routes.js";
import type { CatalogueRefusal } from "../core/skill-catalogue.js";

export type FieldGuard<T extends DiagnosticScalar> = (
  value: unknown,
) => value is T;

export interface EventSpec {
  readonly subsystem: DiagnosticSubsystem;
  readonly level: DiagnosticLevel;
  readonly fields: Readonly<Record<string, FieldGuard<DiagnosticScalar>>>;
}

export const finiteNumber: FieldGuard<number> = (value): value is number =>
  typeof value === "number" && Number.isFinite(value);
export const boolean: FieldGuard<boolean> = (value): value is boolean =>
  typeof value === "boolean";

export function literal<T extends DiagnosticScalar>(
  values: readonly T[],
): FieldGuard<T> {
  const allowed: ReadonlySet<DiagnosticScalar> = new Set(values);
  return (value): value is T =>
    (typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null) &&
    allowed.has(value);
}

export function nullable<T extends DiagnosticScalar>(
  guard: FieldGuard<T>,
): FieldGuard<T | null> {
  return (value): value is T | null => value === null || guard(value);
}

/** The renderer supplies only this fixed-width non-text fingerprint. */
export type RendererFingerprint = string & {
  readonly __rendererFingerprint: unique symbol;
};
export const RENDERER_FINGERPRINT = /^[a-f0-9]{8}$/;
export function asRendererFingerprint(value: string): RendererFingerprint {
  if (!RENDERER_FINGERPRINT.test(value)) {
    throw new AppError("validation", "expected an 8-character renderer fingerprint");
  }
  return value as RendererFingerprint;
}
export const isRendererFingerprint: FieldGuard<RendererFingerprint> = (
  value,
): value is RendererFingerprint =>
  typeof value === "string" && RENDERER_FINGERPRINT.test(value);

/** The shipped CalVer/SemVer surface, constrained before it reaches a log. */
export type AppVersion = string & { readonly __appVersion: unique symbol };
export function isAppVersion(value: unknown): value is AppVersion {
  if (typeof value !== "string") return false;
  const parsed = parseReleaseVersion(value);
  return (
    parsed !== null
    && String(parsed.major).length === 4
    && formatReleaseVersion(parsed) === value
  );
}
export function asAppVersion(value: string): AppVersion {
  if (!isAppVersion(value)) {
    throw new AppError("validation", "expected a valid application version");
  }
  return value;
}
export const appVersion: FieldGuard<AppVersion> = isAppVersion;

export const APP_PHASES = ["startup", "quit"] as const;
export type AppPhase = (typeof APP_PHASES)[number];
export type ContractRendererCaptureAction = Extract<
  RendererCommand,
  { type: "diagnostics.capture" }
>["action"];
export const RENDERER_CAPTURE_ACTIONS = [
  "reset",
  "started",
  "stopped",
  "flush",
  "problem-marked",
] as const satisfies readonly ContractRendererCaptureAction[];
export type RendererCaptureAction =
  (typeof RENDERER_CAPTURE_ACTIONS)[number];
export type ContractIncompleteRendererCommandOutcome = Exclude<
  RendererCommandOutcome,
  "completed"
>;
export const INCOMPLETE_RENDERER_COMMAND_OUTCOMES = [
  "failed",
  "timed-out",
] as const satisfies readonly ContractIncompleteRendererCommandOutcome[];
export type IncompleteRendererCommandOutcome =
  (typeof INCOMPLETE_RENDERER_COMMAND_OUTCOMES)[number];

export const appPhase = literal(APP_PHASES);
export const captureAction = literal(RENDERER_CAPTURE_ACTIONS);
export const incompleteCommandOutcome = literal(
  INCOMPLETE_RENDERER_COMMAND_OUTCOMES,
);
export const appUpdateErrorCode = literal([
  "rate-limited",
  "offline",
  "timeout",
  "server",
  "unreadable",
  "unsupported-build",
  "updater-unavailable",
  "feed-invalid",
  "download-failed",
] as const satisfies readonly AppUpdateErrorCode[]);
export const appUpdateStage = literal([
  "releases",
  "feed",
] as const satisfies readonly AppUpdateStage[]);
export const closeReason = literal([
  "requested",
  "peer",
  "owner",
  "timeout",
  "error",
] as const satisfies readonly SocketCloseReason[]);
export const socketFailureCode = literal([
  "timeout",
  "refused",
  "reset",
  "unreachable",
  "dns",
  "other",
] as const satisfies readonly SocketFailureCode[]);
export const invokeChannel = literal<InvokeChannel>(
  Object.keys(IPC).filter(
    (key): key is InvokeChannel =>
      !(EVENT_CHANNELS as readonly string[]).includes(key as EventChannel),
  ),
);
export const code: FieldGuard<ErrorCode> = isErrorCode;
export const digestOrNull = nullable<Digest>(isDigest);
export const rendererFingerprintOrNull =
  nullable<RendererFingerprint>(isRendererFingerprint);
export const proxyRoute: FieldGuard<ProxyRoute> = (
  value,
): value is ProxyRoute =>
  typeof value === "string" && isProxyRoute(value);
// Steam sign-in reports outcomes and nothing else. There is deliberately no
// field here that could carry a Steam identifier, a token, or an expiry — the
// closed schema is what makes that a build-time guarantee.
export const steamTokenOutcome = literal(["vended", "absent", "acquired"] as const);
export const steamBlocked = literal([
  "navigation",
  "popup",
  "download",
  "webview",
] as const);
export const steamSignInOutcome = literal([
  "success",
  "cancelled",
  "failed",
  "state-mismatch",
  "no-token",
] as const);
export const steamStorebackOutcome = literal([
  "refreshed",
  "ignored",
  "failed",
] as const);
export const windowMode = literal(["normal", "maximized", "fullscreen"] as const);
export const launcherStrategy = literal(["quick", "full", "unselected"] as const);
export const snapshotPriority = literal(["demand", "prefetch"] as const);
export const proxyMethod = literal(["GET", "POST", "PUT"] as const);
export const catalogueRefusal = literal<CatalogueRefusal>([
  "client-unreadable",
  "table-not-found",
  "archive-unreadable",
]);
export const proxyEndReason = nullable(
  literal(["bodyTooLarge", "redirectEscape"] as const),
);
export const updateStatus = literal([
  "rejectedCandidateSkipped",
  "candidate",
  "ready",
  "cachedFallback",
  "cancelled",
  "error",
] as const);
export const captureLevel = literal([1, 2] as const);
export const CAPTURE_STOP_REASONS = [
  "manual",
  "automatic",
  "buffer-full",
  "export",
  "shutdown",
] as const;
export type CaptureStopReason = (typeof CAPTURE_STOP_REASONS)[number];
export const captureStopReason = literal(CAPTURE_STOP_REASONS);
export const socketSendStatus = literal(["sent", "failed"] as const);
export const thermalState = literal([
  "unknown",
  "nominal",
  "fair",
  "serious",
  "critical",
] as const);
export const localVerificationSource = literal(["cache", "process"] as const);
export const localVerificationReason = literal(LOCAL_VERIFICATION_REASONS);
export const buildCertification = literal([
  "certified",
  "template-only",
  "uncertified",
] as const);
export const none = {} as const;
