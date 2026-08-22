/**
 * Pure bounded-value validation and wire normalization for the IPC boundary.
 * No Electron capability or domain policy belongs in this module.
 */
import type { GraphicsDiagnostics, SocketEvent } from "../shared/contracts.js";
import type {
  RendererMilestone,
  RendererMilestoneFields,
  WasmAbortReasonKind,
} from "../shared/diagnostics.js";
import {
  RENDERER_MILESTONES,
  WASM_ABORT_REASON_KINDS,
  WASM_GROWTH_OUTCOMES,
  WASM_MEMORY_PROBE_STATUSES,
} from "../shared/diagnostics.js";
import { ValidationError } from "../shared/errors.js";
import { isRendererFingerprint } from "./diagnostics/schema-fields.js";

export function toWireSocketEvent(event: SocketEvent): SocketEvent {
  if (event.type !== "data") return event;
  return { type: "data", socketId: event.socketId, data: Uint8Array.from(event.data) };
}

export function isGraphicsDiagnostics(value: unknown): value is GraphicsDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userAgent === "string"
    && typeof record.jspi === "boolean"
    && typeof record.webglVersion === "string"
    && typeof record.renderer === "string"
    && typeof record.vendor === "string"
    && typeof record.hardwareAcceleration === "boolean"
    && [
      "canvasWidth", "canvasHeight", "offscreenWidth", "offscreenHeight",
      "drawingBufferWidth", "drawingBufferHeight", "devicePixelRatio",
      "renderScale", "samples",
    ].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]))
    && typeof record.antialias === "boolean"
    && record.userAgent.length <= 2_048
    && record.webglVersion.length <= 1_024
    && record.renderer.length <= 1_024
    && record.vendor.length <= 1_024
    && (record.canvasWidth as number) >= 0
    && (record.canvasWidth as number) <= 32_768
    && (record.canvasHeight as number) >= 0
    && (record.canvasHeight as number) <= 32_768
    && (record.offscreenWidth as number) >= 0
    && (record.offscreenWidth as number) <= 32_768
    && (record.offscreenHeight as number) >= 0
    && (record.offscreenHeight as number) <= 32_768
    && (record.drawingBufferWidth as number) >= 0
    && (record.drawingBufferWidth as number) <= 32_768
    && (record.drawingBufferHeight as number) >= 0
    && (record.drawingBufferHeight as number) <= 32_768
    && Number.isInteger(record.samples)
    && (record.samples as number) >= 0
    && (record.samples as number) <= 64
    && (record.devicePixelRatio as number) > 0
    && (record.devicePixelRatio as number) <= 16
    && (record.renderScale === 1 || record.renderScale === 1.5 || record.renderScale === 2)
  );
}

export interface ParsedMilestone {
  readonly name: RendererMilestone;
  readonly rendererTimestampUs: number;
  readonly fields: RendererMilestoneFields | undefined;
}

const isByteCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Validates the complete renderer milestone tuple before diagnostics sees it. */
export function parseRendererMilestoneArgs(args: readonly unknown[]): ParsedMilestone {
  if (args.length !== 3) throw new ValidationError("expected 3 IPC argument(s)");
  const [name, rendererTimestampUs, fields] = args;
  if (
    typeof name !== "string"
    || !RENDERER_MILESTONES.includes(name as RendererMilestone)
    || typeof rendererTimestampUs !== "number"
    || !Number.isFinite(rendererTimestampUs)
    || rendererTimestampUs < 0
    || rendererTimestampUs > Number.MAX_SAFE_INTEGER
  ) throw new ValidationError("invalid renderer milestone");

  const record = fields as Record<string, unknown> | undefined;
  const recordIsObject = record !== undefined && record !== null
    && typeof record === "object" && !Array.isArray(record);
  let milestoneFields: RendererMilestoneFields | undefined;
  if (name === "build.info") {
    const valid = recordIsObject && Object.keys(record).length === 2
      && (typeof record.programId === "string" || typeof record.programId === "number")
      && (typeof record.buildId === "string" || typeof record.buildId === "number")
      && [record.programId, record.buildId].every((value) =>
        (typeof value === "string" && value.length <= 128)
        || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0));
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      programId: record.programId as string | number,
      buildId: record.buildId as string | number,
    };
  } else if (name === "wasm.abort") {
    const valid = recordIsObject && Object.keys(record).length === 3
      && typeof record.reasonKind === "string"
      && (WASM_ABORT_REASON_KINDS as readonly string[]).includes(record.reasonKind)
      && isRendererFingerprint(record.fingerprint) && isByteCount(record.heapBytes);
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      reasonKind: record.reasonKind as WasmAbortReasonKind,
      fingerprint: record.fingerprint as string,
      heapBytes: record.heapBytes as number,
    };
  } else if (name === "wasm.exit") {
    const valid = recordIsObject && Object.keys(record).length === 2
      && typeof record.code === "number" && Number.isSafeInteger(record.code)
      && isByteCount(record.heapBytes);
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = { code: record.code as number, heapBytes: record.heapBytes as number };
  } else if (name === "wasm.memoryProbe") {
    const valid = recordIsObject && Object.keys(record).length === 1
      && typeof record.status === "string"
      && (WASM_MEMORY_PROBE_STATUSES as readonly string[]).includes(record.status);
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = { status: record.status as (typeof WASM_MEMORY_PROBE_STATUSES)[number] };
  } else if (name === "wasm.growthRequested") {
    const numericFields = [
      "requestedBytes", "beforeBytes", "afterBytes", "stackDepth",
      "frame0Function", "frame0Offset", "frame1Function", "frame1Offset",
      "frame2Function", "frame2Offset", "frame3Function", "frame3Offset",
      "generatedTextures", "deletedTextures", "liveTextures", "trackedTextures",
      "knownTextureBytes", "textureUploadBytes", "unknownTextureAllocations",
    ] as const;
    const valid = recordIsObject && Object.keys(record).length === numericFields.length + 3
      && numericFields.every((field) => isByteCount(record[field]))
      && (record.stackDepth as number) <= 4 && (record.trackedTextures as number) <= 4_096
      && typeof record.outcome === "string"
      && (WASM_GROWTH_OUTCOMES as readonly string[]).includes(record.outcome)
      && isRendererFingerprint(record.stackFingerprint)
      && typeof record.textureTrackingSaturated === "boolean";
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      requestedBytes: record.requestedBytes as number, beforeBytes: record.beforeBytes as number,
      afterBytes: record.afterBytes as number,
      outcome: record.outcome as (typeof WASM_GROWTH_OUTCOMES)[number],
      stackFingerprint: record.stackFingerprint as string, stackDepth: record.stackDepth as number,
      frame0Function: record.frame0Function as number, frame0Offset: record.frame0Offset as number,
      frame1Function: record.frame1Function as number, frame1Offset: record.frame1Offset as number,
      frame2Function: record.frame2Function as number, frame2Offset: record.frame2Offset as number,
      frame3Function: record.frame3Function as number, frame3Offset: record.frame3Offset as number,
      generatedTextures: record.generatedTextures as number, deletedTextures: record.deletedTextures as number,
      liveTextures: record.liveTextures as number, trackedTextures: record.trackedTextures as number,
      knownTextureBytes: record.knownTextureBytes as number, textureUploadBytes: record.textureUploadBytes as number,
      unknownTextureAllocations: record.unknownTextureAllocations as number,
      textureTrackingSaturated: record.textureTrackingSaturated as boolean,
    };
  } else if (name === "graphics.visualProblem") {
    const numericFields = [
      "wasmHeapBytes", "canvasWidth", "canvasHeight", "offscreenWidth",
      "offscreenHeight", "drawingBufferWidth", "drawingBufferHeight",
      "generatedTextures", "deletedTextures", "liveTextures",
      "trackedTextures", "knownTextureBytes", "textureUploadBytes",
      "unknownTextureAllocations", "livePrograms", "programPassThroughQueries",
    ] as const;
    const valid = recordIsObject
      && Object.keys(record).length === numericFields.length + 3
      && numericFields.every((field) => isByteCount(record[field]))
      && (record.trackedTextures as number) <= 4_096
      && typeof record.textureProbeInstalled === "boolean"
      && typeof record.textureTrackingSaturated === "boolean"
      && typeof record.contextLost === "boolean";
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      textureProbeInstalled: record.textureProbeInstalled as boolean,
      wasmHeapBytes: record.wasmHeapBytes as number,
      contextLost: record.contextLost as boolean,
      canvasWidth: record.canvasWidth as number,
      canvasHeight: record.canvasHeight as number,
      offscreenWidth: record.offscreenWidth as number,
      offscreenHeight: record.offscreenHeight as number,
      drawingBufferWidth: record.drawingBufferWidth as number,
      drawingBufferHeight: record.drawingBufferHeight as number,
      generatedTextures: record.generatedTextures as number,
      deletedTextures: record.deletedTextures as number,
      liveTextures: record.liveTextures as number,
      trackedTextures: record.trackedTextures as number,
      knownTextureBytes: record.knownTextureBytes as number,
      textureUploadBytes: record.textureUploadBytes as number,
      unknownTextureAllocations: record.unknownTextureAllocations as number,
      textureTrackingSaturated: record.textureTrackingSaturated as boolean,
      livePrograms: record.livePrograms as number,
      programPassThroughQueries: record.programPassThroughQueries as number,
    };
  } else if (name === "enhancement.installed") {
    const valid = recordIsObject && Object.keys(record).length === 3
      && typeof record.companionAbi === "number" && Number.isSafeInteger(record.companionAbi) && record.companionAbi >= 0
      && typeof record.installation === "number" && Number.isSafeInteger(record.installation) && record.installation >= 1
      && typeof record.capabilityProfile === "string" && record.capabilityProfile.length <= 32;
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      companionAbi: record.companionAbi as number,
      installation: record.installation as number,
      capabilityProfile: record.capabilityProfile as string,
    };
  } else if (name === "enhancement.uninstalled") {
    const valid = recordIsObject && Object.keys(record).length === 1
      && typeof record.installation === "number" && Number.isSafeInteger(record.installation)
      && record.installation >= 1;
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = { installation: record.installation as number };
  } else if (fields !== undefined) {
    throw new ValidationError("invalid renderer milestone");
  }
  return { name: name as RendererMilestone, rendererTimestampUs, fields: milestoneFields };
}
