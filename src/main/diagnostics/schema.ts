/**
 * The one runtime and compile-time schema for app-authored diagnostic events.
 *
 * Event names, subsystem/level ownership, field names, and field validators
 * live together. Producers receive the type derived from this value, and the
 * export detector executes these exact validators. There is no permissive
 * fallback: if an event is absent here, it cannot be recorded or exported.
 */
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  EVENT_CHANNELS,
  IPC,
  type AppUpdateErrorCode,
  type EnhancementCapabilityProfile,
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
  WASM_ABORT_REASON_KINDS,
  type DiagnosticFields,
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
import {
  CERTIFICATE_FEED_OUTCOMES,
  CERTIFICATE_FEED_SOURCES,
} from "../certification/certificate-feed-delivery.js";
import { LOCAL_VERIFICATION_REASONS } from "../certification/local-client-verifier.js";
import {
  isProxyRoute,
  type ProxyRoute,
} from "../core/proxy-routes.js";
import { ALLOWED_PORTS } from "../core/allowlists.js";
import type { CatalogueRefusal } from "../core/skill-catalogue.js";

export type FieldGuard<T extends DiagnosticScalar> = (
  value: unknown,
) => value is T;

export interface EventSpec {
  readonly subsystem: DiagnosticSubsystem;
  readonly level: DiagnosticLevel;
  readonly fields: Readonly<Record<string, FieldGuard<DiagnosticScalar>>>;
}

const finiteNumber: FieldGuard<number> = (value): value is number =>
  typeof value === "number" && Number.isFinite(value);
const boolean: FieldGuard<boolean> = (value): value is boolean =>
  typeof value === "boolean";

function literal<T extends DiagnosticScalar>(
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

function nullable<T extends DiagnosticScalar>(
  guard: FieldGuard<T>,
): FieldGuard<T | null> {
  return (value): value is T | null => value === null || guard(value);
}

/** The renderer supplies only this fixed-width non-text fingerprint. */
export type RendererFingerprint = string & {
  readonly __rendererFingerprint: unique symbol;
};
const RENDERER_FINGERPRINT = /^[a-f0-9]{8}$/;
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
function isAppVersion(value: unknown): value is AppVersion {
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
const appVersion: FieldGuard<AppVersion> = isAppVersion;

const APP_PHASES = ["startup", "quit"] as const;
export type AppPhase = (typeof APP_PHASES)[number];
type ContractRendererCaptureAction = Extract<
  RendererCommand,
  { type: "diagnostics.capture" }
>["action"];
const RENDERER_CAPTURE_ACTIONS = [
  "reset",
  "started",
  "stopped",
  "flush",
  "problem-marked",
] as const satisfies readonly ContractRendererCaptureAction[];
export type RendererCaptureAction =
  (typeof RENDERER_CAPTURE_ACTIONS)[number];
type ContractIncompleteRendererCommandOutcome = Exclude<
  RendererCommandOutcome,
  "completed"
>;
const INCOMPLETE_RENDERER_COMMAND_OUTCOMES = [
  "failed",
  "timed-out",
] as const satisfies readonly ContractIncompleteRendererCommandOutcome[];
export type IncompleteRendererCommandOutcome =
  (typeof INCOMPLETE_RENDERER_COMMAND_OUTCOMES)[number];

const appPhase = literal(APP_PHASES);
const captureAction = literal(RENDERER_CAPTURE_ACTIONS);
const incompleteCommandOutcome = literal(
  INCOMPLETE_RENDERER_COMMAND_OUTCOMES,
);
const appUpdateErrorCode = literal([
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
const appUpdateStage = literal([
  "releases",
  "feed",
] as const satisfies readonly AppUpdateStage[]);
const closeReason = literal([
  "requested",
  "peer",
  "owner",
  "timeout",
  "error",
] as const satisfies readonly SocketCloseReason[]);
const socketFailureCode = literal([
  "timeout",
  "refused",
  "reset",
  "unreachable",
  "dns",
  "other",
] as const satisfies readonly SocketFailureCode[]);
const invokeChannel = literal<InvokeChannel>(
  Object.keys(IPC).filter(
    (key): key is InvokeChannel =>
      !(EVENT_CHANNELS as readonly string[]).includes(key as EventChannel),
  ),
);
const code: FieldGuard<ErrorCode> = isErrorCode;
const digestOrNull = nullable<Digest>(isDigest);
const rendererFingerprintOrNull =
  nullable<RendererFingerprint>(isRendererFingerprint);
const proxyRoute: FieldGuard<ProxyRoute> = (
  value,
): value is ProxyRoute =>
  typeof value === "string" && isProxyRoute(value);
// Steam sign-in reports outcomes and nothing else. There is deliberately no
// field here that could carry a Steam identifier, a token, or an expiry — the
// closed schema is what makes that a build-time guarantee.
const steamTokenOutcome = literal(["vended", "absent", "acquired"] as const);
const steamBlocked = literal([
  "navigation",
  "popup",
  "download",
  "webview",
] as const);
const steamSignInOutcome = literal([
  "success",
  "cancelled",
  "failed",
  "state-mismatch",
  "no-token",
] as const);
const steamStorebackOutcome = literal([
  "refreshed",
  "ignored",
  "failed",
] as const);
const windowMode = literal(["normal", "maximized", "fullscreen"] as const);
const launcherStrategy = literal(["quick", "full", "unselected"] as const);
const snapshotPriority = literal(["demand", "prefetch"] as const);
const proxyMethod = literal(["GET", "POST", "PUT"] as const);
const catalogueRefusal = literal<CatalogueRefusal>([
  "client-unreadable",
  "table-not-found",
  "archive-unreadable",
]);
const proxyEndReason = nullable(
  literal(["bodyTooLarge", "redirectEscape"] as const),
);
const updateStatus = literal([
  "rejectedCandidateSkipped",
  "candidate",
  "ready",
  "cachedFallback",
  "cancelled",
  "error",
] as const);
const captureLevel = literal([1, 2] as const);
const CAPTURE_STOP_REASONS = [
  "manual",
  "automatic",
  "buffer-full",
  "export",
  "shutdown",
] as const;
export type CaptureStopReason = (typeof CAPTURE_STOP_REASONS)[number];
const captureStopReason = literal(CAPTURE_STOP_REASONS);
const socketSendStatus = literal(["sent", "failed"] as const);
const thermalState = literal([
  "unknown",
  "nominal",
  "fair",
  "serious",
  "critical",
] as const);
const localVerificationSource = literal(["cache", "process"] as const);
const localVerificationReason = literal(LOCAL_VERIFICATION_REASONS);
const buildCertification = literal([
  "certified",
  "template-only",
  "uncertified",
] as const);
const certificateFeedOutcome = literal(CERTIFICATE_FEED_OUTCOMES);
const certificateFeedSource = literal(CERTIFICATE_FEED_SOURCES);

const none = {} as const;

export const DIAGNOSTIC_EVENT_SCHEMA = {
  // Application lifecycle and native state.
  "app.uncaughtException": {
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "app.startupFailed": {
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "app.unhandledRejection": {
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "app.beforeQuit": { subsystem: "app", level: "info", fields: none },
  "app.unexpectedUserData": {
    subsystem: "app",
    level: "error",
    fields: none,
  },
  "quit.cleanupStarted": {
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "quit.cleanupCompleted": {
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "quit.cleanupFailed": {
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  // Recorded instead of `quit.cleanupCompleted`, never beside it: the crash
  // heuristic reads the absence of a completion, so a quit that ran out of
  // time must say so rather than leave the next launch to call it a crash.
  "quit.cleanupTimedOut": {
    subsystem: "app",
    level: "error",
    fields: none,
  },
  "quit.rendererSyncIncomplete": {
    subsystem: "app",
    level: "error",
    fields: { outcome: incompleteCommandOutcome },
  },
  "electron.ready": { subsystem: "app", level: "info", fields: none },
  "appUpdate.failed": {
    subsystem: "app",
    level: "error",
    fields: { reason: appUpdateErrorCode },
  },
  // The published state names the reason but not the request it came from, and
  // "offline" against the releases list is a different report from "offline"
  // against one release's own feed.
  "appUpdate.requestFailed": {
    subsystem: "app",
    level: "warn",
    fields: { stage: appUpdateStage, reason: appUpdateErrorCode },
  },
  "orphanTemps.swept": {
    subsystem: "app",
    level: "info",
    fields: { removed: finiteNumber },
  },
  "childProcess.gone": {
    subsystem: "app",
    level: "error",
    fields: { exitCode: finiteNumber },
  },
  "download.appSuspensionPrevented": {
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "download.appSuspensionRestored": {
    subsystem: "app",
    level: "info",
    fields: none,
  },

  // Window lifecycle and security decisions. Blocked URLs deliberately do not
  // become fields: the event proves the boundary held without copying input.
  "window.stateCorruptCleared": {
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "window.stateRestored": {
    subsystem: "app",
    level: "info",
    fields: {
      mode: windowMode,
      width: finiteNumber,
      height: finiteNumber,
    },
  },
  "window.stateSaveFailed": {
    subsystem: "app",
    level: "error",
    fields: none,
  },
  "window.stateReset": {
    subsystem: "app",
    level: "info",
    fields: { width: finiteNumber, height: finiteNumber },
  },
  /**
   * The Tools shortcut reached a launch that has no Toolbox to toggle. Ordinary
   * on a launch that did not ask for the capability, and the only trace a
   * player would otherwise get of a menu item that did nothing.
   */
  "tools.toggleRefused": {
    subsystem: "app",
    level: "warn",
    fields: { outcome: incompleteCommandOutcome },
  },
  "window.stateResetFailed": {
    subsystem: "app",
    level: "error",
    fields: none,
  },
  "window.focused": { subsystem: "app", level: "info", fields: none },
  "window.blurred": { subsystem: "app", level: "info", fields: none },
  "window.minimized": { subsystem: "app", level: "info", fields: none },
  "window.restored": { subsystem: "app", level: "info", fields: none },
  "window.hidden": { subsystem: "app", level: "info", fields: none },
  "window.shown": { subsystem: "app", level: "info", fields: none },
  "window.resized": { subsystem: "app", level: "info", fields: none },
  "window.moved": { subsystem: "app", level: "info", fields: none },
  "window.closeRequested": {
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "window.created": { subsystem: "app", level: "info", fields: none },
  "security.windowOpenBlocked": {
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "security.navigationBlocked": {
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "security.redirectBlocked": {
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "security.webviewBlocked": {
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "webContents.destroyed": {
    subsystem: "app",
    level: "info",
    fields: none,
  },

  // Diagnostics capture, samples, and export.
  "diagnostics.started": {
    subsystem: "app",
    level: "info",
    fields: { appVersion },
  },
  "diagnostics.exported": {
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "diagnostics.exportFailed": {
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "capture.automationStartFailed": {
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "capture.started": {
    subsystem: "app",
    level: "info",
    fields: { level: captureLevel },
  },
  "capture.stopped": {
    subsystem: "app",
    level: "info",
    fields: { level: captureLevel, reason: captureStopReason },
  },
  "chromiumTrace.stopped": {
    subsystem: "app",
    level: "info",
    fields: { bytes: finiteNumber },
  },
  "chromiumTrace.startFailed": {
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "chromiumTrace.stopFailed": {
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "performance.problemMarked": {
    subsystem: "renderer",
    level: "info",
    fields: none,
  },
  "process.main": {
    subsystem: "app",
    level: "debug",
    fields: {
      cpuPercentOneCore: finiteNumber,
      rssBytes: finiteNumber,
      heapUsedBytes: finiteNumber,
      heapTotalBytes: finiteNumber,
      externalBytes: finiteNumber,
      arrayBuffersBytes: finiteNumber,
    },
  },
  "process.chromium": {
    subsystem: "app",
    level: "debug",
    fields: {
      pid: finiteNumber,
      cpuPercentElectron: finiteNumber,
      idleWakeupsPerSecond: finiteNumber,
      rssBytes: finiteNumber,
      privateBytes: finiteNumber,
      sandboxed: boolean,
    },
  },
  "eventLoop.sample": {
    subsystem: "app",
    level: "debug",
    fields: {
      windowMs: finiteNumber,
      resolutionMs: finiteNumber,
      meanUs: finiteNumber,
      p95Us: finiteNumber,
      p99Us: finiteNumber,
      maxUs: finiteNumber,
      utilization: finiteNumber,
    },
  },
  "power.onBattery": { subsystem: "app", level: "warn", fields: none },
  "power.onAc": { subsystem: "app", level: "info", fields: none },
  "power.suspend": { subsystem: "app", level: "warn", fields: none },
  "power.resume": { subsystem: "app", level: "info", fields: none },
  "thermal.changed": {
    subsystem: "app",
    level: "info",
    fields: { state: thermalState },
  },
  "thermal.pressure": {
    subsystem: "app",
    level: "warn",
    fields: { state: thermalState },
  },
  "cpuSpeedLimit.reduced": {
    subsystem: "app",
    level: "warn",
    fields: { limit: finiteNumber },
  },
  "cpuSpeedLimit.restored": {
    subsystem: "app",
    level: "info",
    fields: { limit: finiteNumber },
  },

  // Browser storage and settings.
  "browserCache.cleared": {
    subsystem: "app",
    level: "info",
    fields: { phase: appPhase },
  },
  "browserCache.clearFailed": {
    subsystem: "app",
    level: "warn",
    fields: { phase: appPhase, code },
  },
  "browserCookies.cleared": {
    subsystem: "app",
    level: "info",
    fields: { phase: appPhase },
  },
  "browserCookies.clearFailed": {
    subsystem: "app",
    level: "warn",
    fields: { phase: appPhase, code },
  },
  "legacySecrets.cleanupFailed": {
    subsystem: "app",
    level: "warn",
    fields: { code },
  },
  "launcher.strategyChanged": {
    subsystem: "settings",
    level: "info",
    fields: { strategy: launcherStrategy },
  },
  "settings.reset": {
    subsystem: "settings",
    level: "info",
    fields: none,
  },
  "settings.corruptRecovered": {
    subsystem: "settings",
    level: "error",
    fields: none,
  },
  "settings.loadFailed": {
    subsystem: "settings",
    level: "error",
    fields: { code },
  },
  "settings.saveFailed": {
    subsystem: "settings",
    level: "error",
    fields: { code },
  },
  "settings.resetFailed": {
    subsystem: "settings",
    level: "error",
    fields: { code },
  },
  "credentials.loadFailed": {
    subsystem: "credentials",
    level: "error",
    fields: { code },
  },
  "credentials.saveFailed": {
    subsystem: "credentials",
    level: "error",
    fields: { code },
  },
  "credentials.clearFailed": {
    subsystem: "credentials",
    level: "error",
    fields: { code },
  },
  "steam.tokenRequested": {
    subsystem: "steam",
    level: "info",
    fields: { outcome: steamTokenOutcome, silent: boolean },
  },
  "steam.tokenLoadFailed": {
    subsystem: "steam",
    level: "error",
    fields: { code },
  },
  "steam.tokenExpired": {
    subsystem: "steam",
    level: "warn",
    fields: none,
  },
  "steam.tokenStoreFailed": {
    subsystem: "steam",
    level: "error",
    fields: { code },
  },
  "steam.tokenCleared": {
    subsystem: "steam",
    level: "info",
    fields: none,
  },
  "steam.tokenClearFailed": {
    subsystem: "steam",
    level: "error",
    fields: { code },
  },
  "steam.storeback": {
    subsystem: "steam",
    level: "info",
    fields: { outcome: steamStorebackOutcome },
  },
  "steam.signInOpened": {
    subsystem: "steam",
    level: "info",
    fields: none,
  },
  "steam.signInBlocked": {
    subsystem: "steam",
    level: "warn",
    fields: { what: steamBlocked },
  },
  "steam.signInResult": {
    subsystem: "steam",
    level: "info",
    fields: { outcome: steamSignInOutcome },
  },
  "filesystem.resetRequested": {
    subsystem: "filesystem",
    level: "warn",
    fields: none,
  },
  "filesystem.resetCompleted": {
    subsystem: "filesystem",
    level: "warn",
    fields: none,
  },
  "filesystem.resetFailed": {
    subsystem: "filesystem",
    level: "error",
    fields: { code },
  },
  /**
   * How many build templates an export wrote, and nothing about them. No
   * destination, no filename, no template name, no code: a player's builds and
   * where they keep them are theirs, and the count is the whole of what a bug
   * report needs.
   *
   * There is no matching import event. An import is written entirely by the
   * renderer against its own mount, so the main process never sees one, and
   * inventing a channel to report it would be adding surface to record
   * something no failure path here can act on.
   */
  "templates.exported": {
    subsystem: "filesystem",
    level: "info",
    fields: { count: finiteNumber },
  },
  "templates.exportFailed": {
    subsystem: "filesystem",
    level: "error",
    fields: { code },
  },

  // Chunk cache and full download.
  "cache.infoFailed": {
    subsystem: "cache",
    level: "error",
    fields: { code },
  },
  "cache.clearRequested": {
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "cache.clearRequestFailed": {
    subsystem: "cache",
    level: "error",
    fields: { code },
  },
  "cache.clearedAtStartup": {
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "cache.staleChunksRemoved": {
    subsystem: "cache",
    level: "info",
    fields: { files: finiteNumber, bytes: finiteNumber },
  },
  "cache.staleChunkCleanupSkipped": {
    subsystem: "cache",
    level: "warn",
    fields: { code },
  },
  "prefetch.failed": {
    subsystem: "cache",
    level: "warn",
    fields: { code },
  },
  "fullDownload.started": {
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "fullDownload.progress": {
    subsystem: "cache",
    level: "info",
    fields: {
      received: finiteNumber,
      total: finiteNumber,
      bytesPerSecond: finiteNumber,
      secondsRemaining: nullable(finiteNumber),
    },
  },
  "fullDownload.completed": {
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "fullDownload.stopped": {
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "fullDownload.stopRequested": {
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "fullDownload.stoppedForSleep": {
    subsystem: "cache",
    level: "warn",
    fields: none,
  },
  "fullDownload.failed": {
    subsystem: "cache",
    level: "error",
    fields: { code },
  },

  // Client certification, transformation, and update.
  "wasm.clientHashUnavailable": {
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "wasm.localVerificationCompleted": {
    subsystem: "wasm",
    level: "info",
    fields: {
      source: localVerificationSource,
      certification: buildCertification,
    },
  },
  "wasm.localVerificationUnavailable": {
    subsystem: "wasm",
    level: "warn",
    fields: none,
  },
  // The certificate feed reports under `wasm` rather than `update` or
  // `release`: it decides what a WebAssembly build may become, and nothing
  // else. Where its bytes came from is transport, and transport is not what a
  // reader of these events is looking for.
  "certificateFeed.resolved": {
    subsystem: "wasm",
    level: "info",
    fields: {
      source: certificateFeedSource,
      sequence: finiteNumber,
      outcome: certificateFeedOutcome,
    },
  },
  "certificateFeed.refused": {
    subsystem: "wasm",
    level: "warn",
    fields: { outcome: certificateFeedOutcome },
  },
  "certificateFeed.proved": {
    subsystem: "wasm",
    level: "info",
    fields: { sequence: finiteNumber, certification: buildCertification },
  },
  "certificateFeed.withheld": {
    subsystem: "wasm",
    level: "warn",
    fields: { reason: localVerificationReason },
  },
  "certificateFeed.proofUnavailable": {
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "wasm.templateSavePrepareFailed": {
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "wasm.templateSaveUnsupported": {
    subsystem: "wasm",
    level: "warn",
    fields: none,
  },
  "wasm.templateSavePrepared": {
    subsystem: "wasm",
    level: "info",
    fields: none,
  },
  "enhancement.prepareFailed": {
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "enhancement.clientPrepared": {
    subsystem: "wasm",
    level: "info",
    fields: { buildId: finiteNumber, transformAbi: finiteNumber },
  },
  "enhancement.uncertifiedClientBlocked": {
    subsystem: "wasm",
    level: "info",
    fields: none,
  },
  "enhancement.obsoleteCacheDiscardFailed": {
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "patch.updateFallback": {
    subsystem: "update",
    level: "warn",
    fields: { code },
  },
  "patch.updateFailed": {
    subsystem: "update",
    level: "error",
    fields: { code, fallbackCode: code },
  },
  "client.candidatePromotionFailed": {
    subsystem: "update",
    level: "error",
    fields: { code },
  },
  "client.candidatePromoted": {
    subsystem: "update",
    level: "info",
    fields: { fingerprint: digestOrNull },
  },
  "client.candidateRolledBack": {
    subsystem: "update",
    level: "warn",
    fields: { fingerprint: digestOrNull },
  },
  "client.candidateRolledBackAfterRendererCrash": {
    subsystem: "update",
    level: "warn",
    fields: { fingerprint: digestOrNull },
  },
  "client.integrityMetadataReady": {
    subsystem: "update",
    level: "info",
    fields: { fingerprint: digestOrNull },
  },
  "client.integrityMigrationSkipped": {
    subsystem: "update",
    level: "warn",
    fields: { code },
  },
  "update.clientUpdate.begin": {
    subsystem: "update",
    level: "debug",
    fields: none,
  },
  "update.clientUpdate.end": {
    subsystem: "update",
    level: "debug",
    fields: {
      status: updateStatus,
      code: nullable(code),
      fingerprint: digestOrNull,
    },
  },

  // Protocol requests and their four closed span families.
  "protocol.installed": {
    subsystem: "protocol",
    level: "info",
    fields: none,
  },
  "dns.resolve.begin": {
    subsystem: "dns",
    level: "debug",
    fields: none,
  },
  "dns.resolve.end": {
    subsystem: "dns",
    level: "debug",
    fields: { status: literal(["ok", "error"] as const), code: nullable(code) },
  },
  "snapshot.read.begin": {
    subsystem: "snapshot",
    level: "debug",
    fields: {
      offsetBytes: finiteNumber,
      requestedBytes: finiteNumber,
      priority: snapshotPriority,
    },
  },
  "snapshot.read.end": {
    subsystem: "snapshot",
    level: "debug",
    fields: {
      offsetBytes: finiteNumber,
      requestedBytes: finiteNumber,
      returnedBytes: finiteNumber,
      priority: snapshotPriority,
      status: literal([206, 503] as const),
      code: nullable(code),
    },
  },
  "snapshot.rangeFailed": {
    subsystem: "snapshot",
    level: "error",
    fields: { offsetBytes: finiteNumber, bytes: finiteNumber, code },
  },
  "proxy.request.begin": {
    subsystem: "proxy",
    level: "debug",
    fields: { route: proxyRoute, method: proxyMethod },
  },
  "proxy.request.end": {
    subsystem: "proxy",
    level: "debug",
    fields: {
      route: proxyRoute,
      method: proxyMethod,
      status: finiteNumber,
      reason: proxyEndReason,
      code: nullable(code),
    },
  },
  "proxy.redirectBlocked": {
    subsystem: "proxy",
    level: "warn",
    fields: { route: proxyRoute },
  },
  "proxy.requestFailed": {
    subsystem: "proxy",
    level: "error",
    fields: { route: proxyRoute, code },
  },

  // The build editor asked for the skill catalogue and the client build could
  // not supply one. Warn rather than error: the editor stays usable and both
  // reasons are recoverable on a later request.
  "protocol.skillCatalogueRefused": {
    subsystem: "protocol",
    level: "warn",
    fields: { reason: catalogueRefusal },
  },

  // Managed sockets and IPC rejection.
  "socket.open": {
    subsystem: "socket",
    level: "info",
    // The port is the closed production allowlist, so a reset on the game
    // connection (6112) is distinguishable from patch/web traffic (80/443).
    fields: { socketId: finiteNumber, port: literal([...ALLOWED_PORTS]) },
  },
  "socket.close": {
    subsystem: "socket",
    level: "info",
    fields: { socketId: finiteNumber, reason: closeReason },
  },
  "socket.error": {
    subsystem: "socket",
    level: "warn",
    fields: { socketId: finiteNumber, code: socketFailureCode },
  },
  "socket.rendererSend": {
    subsystem: "socket",
    level: "debug",
    fields: {
      syncUs: finiteNumber,
      settleUs: finiteNumber,
      payloadBytes: finiteNumber,
      sourceBackingBytes: finiteNumber,
      compactBytes: finiteNumber,
      status: socketSendStatus,
    },
  },
  "ipc.rejected": {
    subsystem: "app",
    level: "warn",
    fields: { channel: invokeChannel, code },
  },

  // Renderer recovery and renderer-originated fixed events.
  "renderer.processExitedDuringQuit": {
    subsystem: "renderer",
    level: "info",
    fields: { exitCode: finiteNumber },
  },
  "renderer.processGone": {
    subsystem: "renderer",
    level: "error",
    fields: { exitCode: finiteNumber },
  },
  "renderer.recoveryScheduled": {
    subsystem: "renderer",
    level: "warn",
    fields: none,
  },
  "renderer.recoveryPreparationFailed": {
    subsystem: "renderer",
    level: "error",
    fields: { code },
  },
  "renderer.recovered": {
    subsystem: "renderer",
    level: "info",
    fields: none,
  },
  "renderer.commandIncomplete": {
    subsystem: "renderer",
    level: "warn",
    fields: { action: captureAction, outcome: incompleteCommandOutcome },
  },
  "renderer.windowError": {
    subsystem: "renderer",
    level: "error",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "renderer.unhandledRejection": {
    subsystem: "renderer",
    level: "error",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "graphics.contextLost": {
    subsystem: "graphics",
    level: "error",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "graphics.contextRestored": {
    subsystem: "graphics",
    level: "info",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "graphics.presentationFailed": {
    subsystem: "graphics",
    level: "error",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "client.glueLoadFailed": {
    subsystem: "renderer",
    level: "error",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "filesystem.persistenceFailed": {
    subsystem: "renderer",
    level: "error",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "audio.resumeFailed": {
    subsystem: "renderer",
    level: "warn",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "pointerLock.failed": {
    subsystem: "renderer",
    level: "warn",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  // A demand read the client was awaiting rejected — the failure mode behind
  // black textures. The count and timestamps tie a visual artifact report to
  // the reads that failed under it.
  "snapshot.readFailed": {
    subsystem: "snapshot",
    level: "error",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  // The 1024-program ceiling was reached; later programs degrade to
  // pass-through polling. Its absence in a capture rules the cache out of a
  // rendering-artifact investigation.
  "graphics.programCacheSaturated": {
    subsystem: "graphics",
    level: "warn",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "clipboard.copied": {
    subsystem: "renderer",
    level: "info",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "clipboard.writeFailed": {
    subsystem: "renderer",
    level: "warn",
    fields: { fingerprint: rendererFingerprintOrNull },
  },
  "graphics.detected": {
    subsystem: "graphics",
    level: "info",
    fields: {
      jspi: boolean,
      hardwareAcceleration: boolean,
      canvasWidth: finiteNumber,
      canvasHeight: finiteNumber,
      offscreenWidth: finiteNumber,
      offscreenHeight: finiteNumber,
      drawingBufferWidth: finiteNumber,
      drawingBufferHeight: finiteNumber,
      devicePixelRatio: finiteNumber,
      renderScale: finiteNumber,
      antialias: boolean,
      samples: finiteNumber,
    },
  },
  "renderer.metrics": {
    subsystem: "renderer",
    level: "debug",
    fields: {
      visible: boolean,
      intervalMs: finiteNumber,
      rafCount: finiteNumber,
      rafMaxUs: finiteNumber,
      swapCount: finiteNumber,
      presentationFailures: finiteNumber,
      swapMaxUs: finiteNumber,
      submitIntervalMaxUs: finiteNumber,
      snapshotReads: finiteNumber,
      snapshotBytes: finiteNumber,
      snapshotMaxUs: finiteNumber,
      inputToSubmitCount: finiteNumber,
      inputToSubmitMaxUs: finiteNumber,
      memoryCacheBytes: finiteNumber,
      memoryCacheChunks: finiteNumber,
      pendingChunks: finiteNumber,
      activeDemand: finiteNumber,
      activePrefetch: finiteNumber,
      queuedDemand: finiteNumber,
      queuedPrefetch: finiteNumber,
      socketSendCalls: finiteNumber,
      socketPayloadBytes: finiteNumber,
      socketSourceBackingMaxBytes: finiteNumber,
      socketCompactBytes: finiteNumber,
      socketSyncMaxUs: finiteNumber,
      socketSettles: finiteNumber,
      socketSettleMaxUs: finiteNumber,
      droppedRecords: finiteNumber,
    },
  },
  "clock.synchronized": {
    subsystem: "renderer",
    level: "debug",
    fields: { offsetUs: finiteNumber, rttUs: finiteNumber },
  },

  // Renderer milestones. Build identifiers stay in gauges/environment; the
  // event records only the fixed synchronization fact common to every entry.
  "renderer.loaded": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "wasm.instantiate.begin": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "wasm.instantiate.end": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "wasm.streamingFallback": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "runtime.initialized": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "frame.firstSubmit": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "startup.complete": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "launcher.choiceShown": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "launcher.quickSelected": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "launcher.fullSelected": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "launcher.playNowSelected": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "launcher.bootReleased": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "build.info": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  "snapshot.fatalRead": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean },
  },
  // The two milestones that are also failures. The abort argument collapses
  // in the renderer into a closed reason kind plus a non-text fingerprint, so
  // the export can name the failing native operation class without carrying
  // prose; a non-zero exit carries only the client's own numeric code.
  // `heapBytes` is the WASM linear memory at death: the glue caps it at
  // 2 GiB, so a crash recorded at the cap is memory exhaustion whatever
  // prose the abort carried.
  "wasm.abort": {
    subsystem: "renderer",
    level: "error",
    fields: {
      clockSynchronized: boolean,
      reasonKind: literal(WASM_ABORT_REASON_KINDS),
      fingerprint: isRendererFingerprint,
      heapBytes: finiteNumber,
    },
  },
  "wasm.exit": {
    subsystem: "renderer",
    level: "error",
    fields: { clockSynchronized: boolean, code: finiteNumber, heapBytes: finiteNumber },
  },
  // The heap staircase, sampled: the renderer reports heap size with each
  // metrics flush (~2 s) and every observed rise becomes one event, so
  // near-simultaneous growth steps can coalesce and a run's first event
  // rises from 0. Read with the socket.open map transitions around it, the
  // sequence answers whether a session leaked steadily or stepped up on
  // zone loads — the question every heap-cap abort asks.
  "wasm.heapGrew": {
    subsystem: "renderer",
    level: "info",
    fields: { fromBytes: finiteNumber, toBytes: finiteNumber },
  },
  // The renderer's Enhancement installation lifecycle. `clientPrepared` above
  // says a transformed module was served; only these say whether the hook was
  // actually live in the game's call path — the first fact a wasm.abort
  // triage needs.
  "enhancement.installed": {
    subsystem: "renderer",
    level: "info",
    fields: {
      clockSynchronized: boolean,
      companionAbi: finiteNumber,
      installation: finiteNumber,
      capabilityProfile: literal(
        Object.keys(
          ENHANCEMENT_CAPABILITY_PROFILES,
        ) as EnhancementCapabilityProfile[],
      ),
    },
  },
  "enhancement.installFailed": {
    subsystem: "renderer",
    level: "warn",
    fields: { clockSynchronized: boolean },
  },
  "enhancement.uninstalled": {
    subsystem: "renderer",
    level: "info",
    fields: { clockSynchronized: boolean, installation: finiteNumber },
  },
} as const satisfies Readonly<Record<string, EventSpec>>;

export type DiagnosticEventName = keyof typeof DIAGNOSTIC_EVENT_SCHEMA;

export function diagnosticEventSpec(name: DiagnosticEventName): EventSpec {
  return DIAGNOSTIC_EVENT_SCHEMA[name];
}

type Guarded<G> = G extends FieldGuard<infer T> ? T : never;
type FieldsOf<K extends DiagnosticEventName> = {
  [F in keyof (typeof DIAGNOSTIC_EVENT_SCHEMA)[K]["fields"]]: Guarded<
    (typeof DIAGNOSTIC_EVENT_SCHEMA)[K]["fields"][F]
  >;
};

export type DiagnosticEvent = {
  [K in DiagnosticEventName]: { k: K } & FieldsOf<K>;
}[DiagnosticEventName];

export interface DiagnosticEventRecord {
  subsystem: DiagnosticSubsystem;
  level: DiagnosticLevel;
  name: DiagnosticEventName;
  fields: DiagnosticFields;
}

export function diagnosticEventRecord(
  event: DiagnosticEvent,
): DiagnosticEventRecord {
  const spec: EventSpec = DIAGNOSTIC_EVENT_SCHEMA[event.k];
  const fields: DiagnosticFields = {};
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
 * Compile-time proof that the public event constructor cannot carry prose or
 * nested structures. Literal unions and branded fixed-format strings survive;
 * a plain `string` field does not.
 */
type FreeTextKeys<T> = T extends unknown
  ? { [K in keyof T]-?: string extends T[K] ? K : never }[keyof T]
  : never;

const _noFreeText: [FreeTextKeys<DiagnosticEvent>] extends [never]
  ? true
  : never = true;
const _scalarsOnly: DiagnosticEvent extends Record<
  string,
  DiagnosticScalar | undefined
>
  ? true
  : never = true;
