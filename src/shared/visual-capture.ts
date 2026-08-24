/**
 * Closed, size-bounded evidence exchanged by the visual capture pipeline.
 * Main, preload, renderer, exporter, and offline tools share this vocabulary.
 */
export const VISUAL_CAPTURE_STAGES = [
  "webgl",
  "offscreen",
  "canvas",
  "window",
] as const;
export const VISUAL_IMAGE_MAX_BYTES = 256 * 1024 * 1024;
export const VISUAL_ARCHIVE_IMAGE_MAX_BYTES = 1024 * 1024 * 1024;
export type VisualCaptureStage = (typeof VISUAL_CAPTURE_STAGES)[number];

export const VISUAL_CAPTURE_FAILURES = [
  "no-context",
  "context-lost",
  "unsupported",
  "oversized",
  "capture-failed",
  "timed-out",
] as const;
export type VisualCaptureFailure = (typeof VISUAL_CAPTURE_FAILURES)[number];

export interface VisualCaptureMetadata {
  frameSequence: number;
  capturedAtRendererMs: number;
  canvasBounds: { x: number; y: number; width: number; height: number };
  canvasWidth: number;
  canvasHeight: number;
  offscreenWidth: number;
  offscreenHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  devicePixelRatio: number;
}

export type VisualCaptureSubmission =
  | Readonly<{
      token: string;
      status: "captured";
      webglPng: Uint8Array;
      offscreenPng: Uint8Array;
      metadata: VisualCaptureMetadata;
    }>
  | Readonly<{
      token: string;
      status: "failed";
      reason: VisualCaptureFailure;
    }>;
