/**
 * Owns application, profile, filesystem, and client-update diagnostic events.
 * It keeps that half of the closed schema reviewable as one bounded table.
 */
import type { EventSpec } from "./schema-fields.js";
import { EXTENDED_MEMORY_PROFILES } from "../certification/extended-memory.js";
import {
  appPhase,
  appUpdateErrorCode,
  appUpdateStage,
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
} from "./schema-fields.js";

export const APP_AND_UPDATE_EVENT_SCHEMA = {
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
  "app.relaunchFailed": {
    subsystem: "app",
    level: "error",
    fields: {
      action: literal([
        "toolsEnable",
        "cacheClear",
        "gameStorageReset",
      ] as const),
      code,
    },
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
    fields: none,
  },
  "wasm.localVerificationUnavailable": {
    subsystem: "wasm",
    level: "warn",
    fields: none,
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
  "wasm.nativeDoubleClickPrepareFailed": {
    subsystem: "wasm",
    level: "warn",
    fields: { code },
  },
  "wasm.extendedMemory": {
    subsystem: "wasm",
    level: "info",
    fields: {
      mode: literal(["disabled", "unavailable", "active"] as const),
      requested: boolean,
      profile: literal(["none", ...EXTENDED_MEMORY_PROFILES] as const),
      capBytes: finiteNumber,
      fallbackReason: literal([
        "none",
        "unsupported-client",
        "preparation-failed",
      ] as const),
    },
  },
  "wasm.extendedMemoryPrepareFailed": {
    subsystem: "wasm",
    level: "warn",
    fields: { code },
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
} as const satisfies Readonly<Record<string, EventSpec>>;
