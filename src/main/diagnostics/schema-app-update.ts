/**
 * Owns application, profile, filesystem, and client-update diagnostic events.
 * It keeps that half of the closed schema reviewable as one bounded table.
 */
import type { EventSpec } from "./schema-fields.js";
import {
  isExtendedMemoryProfile,
  type ExtendedMemoryProfile,
} from "../certification/extended-memory.js";
import {
  appPhase,
  appUpdateErrorCode,
  appVersion,
  boolean,
  captureLevel,
  captureStopReason,
  code,
  digestOrNull,
  finiteNumber,
  incompleteCommandOutcome,
  launcherStrategy,
  literal,
  none,
  nullable,
  steamBlocked,
  steamSignInOutcome,
  steamStorebackOutcome,
  steamTokenOutcome,
  thermalState,
  updateStatus,
  windowMode,
  type FieldGuard,
} from "./schema-fields.js";

const extendedMemoryProfile: FieldGuard<"none" | ExtendedMemoryProfile> = (
  value,
): value is "none" | ExtendedMemoryProfile =>
  value === "none" || isExtendedMemoryProfile(value);

export const APP_AND_UPDATE_EVENT_SCHEMA = {
  "app.uncaughtException": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "app.startupFailed": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "app.unhandledRejection": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "app.relaunchFailed": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: {
      action: literal([
        "capabilityEnable",
        "cacheClear",
        "gameStorageReset",
      ] as const),
      code,
    },
  },
  "app.beforeQuit": { scope: "app", subsystem: "app", level: "info", fields: none },
  "app.unexpectedUserData": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: none,
  },
  "quit.cleanupStarted": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "quit.cleanupCompleted": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "quit.cleanupFailed": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  // Recorded instead of `quit.cleanupCompleted`, never beside it: the crash
  // heuristic reads the absence of a completion, so a quit that ran out of
  // time must say so rather than leave the next launch to call it a crash.
  "quit.cleanupTimedOut": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: none,
  },
  "quit.rendererSyncIncomplete": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: { outcome: incompleteCommandOutcome },
  },
  "electron.ready": { scope: "app", subsystem: "app", level: "info", fields: none },
  "appUpdate.failed": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: { reason: appUpdateErrorCode },
  },
  "appUpdate.requestFailed": {
    scope: "app",
    subsystem: "app",
    level: "warn",
    fields: { reason: appUpdateErrorCode },
  },
  "orphanTemps.swept": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: { removed: finiteNumber },
  },
  "childProcess.gone": {
    scope: "app",
    subsystem: "app",
    level: "error",
    fields: { exitCode: finiteNumber },
  },
  "download.appSuspensionPrevented": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "download.appSuspensionRestored": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: none,
  },

  // Window lifecycle and security decisions. Blocked URLs deliberately do not
  // become fields: the event proves the boundary held without copying input.
  "window.stateCorruptCleared": {
    scope: "owner",
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "window.stateRestored": {
    scope: "owner",
    subsystem: "app",
    level: "info",
    fields: {
      mode: windowMode,
      width: finiteNumber,
      height: finiteNumber,
    },
  },
  "window.stateSaveFailed": {
    scope: "owner",
    subsystem: "app",
    level: "error",
    fields: none,
  },
  "window.stateReset": {
    scope: "owner",
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
    scope: "owner",
    subsystem: "app",
    level: "warn",
    fields: { outcome: incompleteCommandOutcome },
  },
  "window.stateResetFailed": {
    scope: "owner",
    subsystem: "app",
    level: "error",
    fields: none,
  },
  "window.focused": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "window.blurred": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "window.minimized": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "window.restored": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "window.hidden": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "window.shown": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "window.resized": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "window.moved": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "window.closeRequested": {
    scope: "owner",
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "window.created": { scope: "owner", subsystem: "app", level: "info", fields: none },
  "security.windowOpenBlocked": {
    scope: "owner",
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "security.navigationBlocked": {
    scope: "owner",
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "security.redirectBlocked": {
    scope: "owner",
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "security.webviewBlocked": {
    scope: "owner",
    subsystem: "app",
    level: "warn",
    fields: none,
  },
  "webContents.destroyed": {
    scope: "owner",
    subsystem: "app",
    level: "info",
    fields: none,
  },

  // Diagnostics capture, samples, and export.
  "diagnostics.started": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: { appVersion },
  },
  "diagnostics.exported": {
    scope: "owner",
    subsystem: "app",
    level: "info",
    fields: none,
  },
  "diagnostics.exportFailed": {
    scope: "owner",
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "capture.automationStartFailed": {
    scope: "owner",
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "capture.started": {
    scope: "owner",
    subsystem: "app",
    level: "info",
    fields: { level: captureLevel },
  },
  "capture.stopped": {
    scope: "owner",
    subsystem: "app",
    level: "info",
    fields: { level: captureLevel, reason: captureStopReason },
  },
  "chromiumTrace.stopped": {
    scope: "owner",
    subsystem: "app",
    level: "info",
    fields: { bytes: finiteNumber },
  },
  "chromiumTrace.startFailed": {
    scope: "owner",
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "chromiumTrace.stopFailed": {
    scope: "owner",
    subsystem: "app",
    level: "error",
    fields: { code },
  },
  "performance.problemMarked": {
    scope: "owner",
    subsystem: "renderer",
    level: "info",
    fields: none,
  },
  "process.main": {
    scope: "app",
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
    scope: "owner",
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
    scope: "app",
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
  "power.onBattery": { scope: "app", subsystem: "app", level: "warn", fields: none },
  "power.onAc": { scope: "app", subsystem: "app", level: "info", fields: none },
  "power.suspend": { scope: "app", subsystem: "app", level: "warn", fields: none },
  "power.resume": { scope: "app", subsystem: "app", level: "info", fields: none },
  "thermal.changed": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: { state: thermalState },
  },
  "thermal.pressure": {
    scope: "app",
    subsystem: "app",
    level: "warn",
    fields: { state: thermalState },
  },
  "cpuSpeedLimit.reduced": {
    scope: "app",
    subsystem: "app",
    level: "warn",
    fields: { limit: finiteNumber },
  },
  "cpuSpeedLimit.restored": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: { limit: finiteNumber },
  },

  // Browser storage and settings.
  "browserCache.cleared": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: { phase: appPhase },
  },
  "browserCache.clearFailed": {
    scope: "app",
    subsystem: "app",
    level: "warn",
    fields: { phase: appPhase, code },
  },
  "browserCookies.cleared": {
    scope: "app",
    subsystem: "app",
    level: "info",
    fields: { phase: appPhase },
  },
  "browserCookies.clearFailed": {
    scope: "app",
    subsystem: "app",
    level: "warn",
    fields: { phase: appPhase, code },
  },
  "legacySecrets.cleanupFailed": {
    scope: "app",
    subsystem: "app",
    level: "warn",
    fields: { code },
  },
  "launcher.strategyChanged": {
    scope: "app",
    subsystem: "settings",
    level: "info",
    fields: { strategy: launcherStrategy },
  },
  "settings.reset": {
    scope: "app",
    subsystem: "settings",
    level: "info",
    fields: none,
  },
  "settings.corruptRecovered": {
    scope: "app",
    subsystem: "settings",
    level: "error",
    fields: none,
  },
  "travelPreferences.corruptRecovered": {
    scope: "app",
    subsystem: "settings",
    level: "error",
    fields: none,
  },
  "settings.loadFailed": {
    scope: "app",
    subsystem: "settings",
    level: "error",
    fields: { code },
  },
  "settings.saveFailed": {
    scope: "app",
    subsystem: "settings",
    level: "error",
    fields: { code },
  },
  "settings.resetFailed": {
    scope: "app",
    subsystem: "settings",
    level: "error",
    fields: { code },
  },
  "credentials.loadFailed": {
    scope: "owner",
    subsystem: "credentials",
    level: "error",
    fields: { code },
  },
  "credentials.saveFailed": {
    scope: "owner",
    subsystem: "credentials",
    level: "error",
    fields: { code },
  },
  "credentials.clearFailed": {
    scope: "owner",
    subsystem: "credentials",
    level: "error",
    fields: { code },
  },
  "steam.tokenRequested": {
    scope: "owner",
    subsystem: "steam",
    level: "info",
    fields: { outcome: steamTokenOutcome, silent: boolean },
  },
  "steam.tokenLoadFailed": {
    scope: "owner",
    subsystem: "steam",
    level: "error",
    fields: { code },
  },
  "steam.tokenExpired": {
    scope: "owner",
    subsystem: "steam",
    level: "warn",
    fields: none,
  },
  "steam.tokenStoreFailed": {
    scope: "owner",
    subsystem: "steam",
    level: "error",
    fields: { code },
  },
  "steam.tokenCleared": {
    scope: "owner",
    subsystem: "steam",
    level: "info",
    fields: none,
  },
  "steam.tokenClearFailed": {
    scope: "owner",
    subsystem: "steam",
    level: "error",
    fields: { code },
  },
  "steam.storeback": {
    scope: "owner",
    subsystem: "steam",
    level: "info",
    fields: { outcome: steamStorebackOutcome },
  },
  "steam.signInOpened": {
    scope: "owner",
    subsystem: "steam",
    level: "info",
    fields: none,
  },
  "steam.signInBlocked": {
    scope: "owner",
    subsystem: "steam",
    level: "warn",
    fields: { what: steamBlocked },
  },
  "steam.signInResult": {
    scope: "owner",
    subsystem: "steam",
    level: "info",
    fields: { outcome: steamSignInOutcome },
  },
  "filesystem.resetRequested": {
    scope: "owner",
    subsystem: "filesystem",
    level: "warn",
    fields: none,
  },
  "filesystem.resetCompleted": {
    scope: "owner",
    subsystem: "filesystem",
    level: "warn",
    fields: none,
  },
  "filesystem.resetFailed": {
    scope: "owner",
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
    scope: "owner",
    subsystem: "filesystem",
    level: "info",
    fields: { count: finiteNumber },
  },
  "templates.exportFailed": {
    scope: "owner",
    subsystem: "filesystem",
    level: "error",
    fields: { code },
  },

  // Chunk cache and full download.
  "cache.infoFailed": {
    scope: "app",
    subsystem: "cache",
    level: "error",
    fields: { code },
  },
  "cache.clearRequested": {
    scope: "app",
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "cache.clearRequestFailed": {
    scope: "app",
    subsystem: "cache",
    level: "error",
    fields: { code },
  },
  "cache.clearedAtStartup": {
    scope: "app",
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "cache.staleChunksRemoved": {
    scope: "app",
    subsystem: "cache",
    level: "info",
    fields: { files: finiteNumber, bytes: finiteNumber },
  },
  "cache.staleChunkCleanupSkipped": {
    scope: "app",
    subsystem: "cache",
    level: "warn",
    fields: { code },
  },
  "prefetch.failed": {
    scope: "app",
    subsystem: "cache",
    level: "warn",
    fields: { code },
  },
  "fullDownload.started": {
    scope: "app",
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "fullDownload.progress": {
    scope: "app",
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
    scope: "app",
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "fullDownload.stopped": {
    scope: "app",
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "fullDownload.stopRequested": {
    scope: "app",
    subsystem: "cache",
    level: "info",
    fields: none,
  },
  "fullDownload.stoppedForSleep": {
    scope: "app",
    subsystem: "cache",
    level: "warn",
    fields: none,
  },
  "fullDownload.failed": {
    scope: "app",
    subsystem: "cache",
    level: "error",
    fields: { code },
  },

  // Client certification, transformation, and update.
  "wasm.clientHashUnavailable": {
    scope: "app",
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "wasm.localVerificationCompleted": {
    scope: "app",
    subsystem: "wasm",
    level: "info",
    fields: none,
  },
  "wasm.localVerificationUnavailable": {
    scope: "app",
    subsystem: "wasm",
    level: "warn",
    fields: none,
  },
  "wasm.templateSavePrepareFailed": {
    scope: "app",
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "wasm.templateSaveUnsupported": {
    scope: "app",
    subsystem: "wasm",
    level: "warn",
    fields: none,
  },
  "wasm.templateSavePrepared": {
    scope: "app",
    subsystem: "wasm",
    level: "info",
    fields: none,
  },
  "wasm.nativeDoubleClickPrepareFailed": {
    scope: "app",
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "wasm.extendedMemory": {
    scope: "app",
    subsystem: "wasm",
    level: "info",
    fields: {
      mode: literal(["disabled", "unavailable", "active"] as const),
      requested: boolean,
      profile: extendedMemoryProfile,
      capBytes: finiteNumber,
      fallbackReason: literal([
        "none",
        "unsupported-client",
        "preparation-failed",
      ] as const),
    },
  },
  "wasm.extendedMemoryPrepareFailed": {
    scope: "app",
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "enhancement.prepareFailed": {
    scope: "app",
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "enhancement.clientPrepared": {
    scope: "app",
    subsystem: "wasm",
    level: "info",
    fields: { buildId: finiteNumber, transformAbi: finiteNumber },
  },
  "enhancement.uncertifiedClientBlocked": {
    scope: "app",
    subsystem: "wasm",
    level: "info",
    fields: none,
  },
  "patch.updateFallback": {
    scope: "app",
    subsystem: "update",
    level: "warn",
    fields: { code },
  },
  "patch.updateFailed": {
    scope: "app",
    subsystem: "update",
    level: "error",
    fields: { code, fallbackCode: code },
  },
  "client.candidatePromotionFailed": {
    scope: "app",
    subsystem: "update",
    level: "error",
    fields: { code },
  },
  "client.candidatePromoted": {
    scope: "app",
    subsystem: "update",
    level: "info",
    fields: { fingerprint: digestOrNull },
  },
  "client.candidateRolledBack": {
    scope: "app",
    subsystem: "update",
    level: "warn",
    fields: { fingerprint: digestOrNull },
  },
  "client.candidateRolledBackAfterRendererCrash": {
    scope: "app",
    subsystem: "update",
    level: "warn",
    fields: { fingerprint: digestOrNull },
  },
  "client.integrityMetadataReady": {
    scope: "app",
    subsystem: "update",
    level: "info",
    fields: { fingerprint: digestOrNull },
  },
  "client.integrityMigrationSkipped": {
    scope: "app",
    subsystem: "update",
    level: "warn",
    fields: { code },
  },
  "update.clientUpdate.begin": {
    scope: "app",
    subsystem: "update",
    level: "debug",
    fields: none,
  },
  "update.clientUpdate.end": {
    scope: "app",
    subsystem: "update",
    level: "debug",
    fields: {
      status: updateStatus,
      code: nullable(code),
      fingerprint: digestOrNull,
    },
  },
} as const satisfies Readonly<Record<string, EventSpec>>;
