/**
 * Pure bounded-value validation and wire normalization for the IPC boundary.
 * No Electron capability or domain policy belongs in this module.
 */
import type { GraphicsDiagnostics, SocketEvent } from "../shared/contracts.js";

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
