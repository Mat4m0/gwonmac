/**
 * Owns protocol, socket, renderer, graphics, and Enhancement diagnostic events.
 * It is the renderer-facing half of the closed diagnostic vocabulary.
 */
import type { EventSpec } from "./schema-fields.js";
import { ALLOWED_PORTS } from "../core/allowlists.js";
import {
  WASM_ABORT_REASON_KINDS,
  WASM_GROWTH_OUTCOMES,
  WASM_MEMORY_PROBE_STATUSES,
} from "../../shared/diagnostics.js";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  type EnhancementCapabilityProfile,
} from "../../shared/enhancement-contracts.js";
import {
  boolean,
  captureAction,
  catalogueRefusal,
  closeReason,
  code,
  finiteNumber,
  incompleteCommandOutcome,
  invokeChannel,
  isRendererFingerprint,
  literal,
  none,
  nullable,
  proxyEndReason,
  proxyMethod,
  proxyRoute,
  rendererFingerprintOrNull,
  snapshotPriority,
  socketFailureCode,
  socketSendStatus,
} from "./schema-fields.js";

export const PROTOCOL_AND_RENDERER_EVENT_SCHEMA = {
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
  "wasm.memoryProbe": {
    subsystem: "wasm",
    level: "info",
    fields: {
      clockSynchronized: boolean,
      status: literal(WASM_MEMORY_PROBE_STATUSES),
    },
  },
  // Exact heap-growth-boundary observation. Unlike `heapGrew`, this records
  // refused requests and preserves the numeric WASM call chain which caused
  // the request. Texture figures are bounded aggregates, never object names
  // or pixel data.
  "wasm.growthRequested": {
    subsystem: "wasm",
    level: "info",
    fields: {
      clockSynchronized: boolean,
      requestedBytes: finiteNumber,
      beforeBytes: finiteNumber,
      afterBytes: finiteNumber,
      outcome: literal(WASM_GROWTH_OUTCOMES),
      stackFingerprint: isRendererFingerprint,
      stackDepth: finiteNumber,
      frame0Function: finiteNumber,
      frame0Offset: finiteNumber,
      frame1Function: finiteNumber,
      frame1Offset: finiteNumber,
      frame2Function: finiteNumber,
      frame2Offset: finiteNumber,
      frame3Function: finiteNumber,
      frame3Offset: finiteNumber,
      generatedTextures: finiteNumber,
      deletedTextures: finiteNumber,
      liveTextures: finiteNumber,
      trackedTextures: finiteNumber,
      knownTextureBytes: finiteNumber,
      textureUploadBytes: finiteNumber,
      unknownTextureAllocations: finiteNumber,
      textureTrackingSaturated: boolean,
    },
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
