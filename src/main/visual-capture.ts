/**
 * Owner-bound, one-shot visual evidence capture.
 *
 * Renderer pixels are accepted only from the window for which main minted the
 * token. While that invoke is pending the renderer keeps the submitted frame
 * on screen, which lets main capture the presented canvas and the complete
 * window from the same frame.
 */
import { randomUUID } from "node:crypto";
import { nativeImage, type BrowserWindow, type Rectangle } from "electron";
import {
  VISUAL_ARCHIVE_IMAGE_MAX_BYTES,
  VISUAL_CAPTURE_FAILURES,
  VISUAL_CAPTURE_STAGES,
  VISUAL_IMAGE_MAX_BYTES,
  type VisualCaptureFailure,
  type VisualCaptureMetadata,
  type VisualCaptureStage,
  type VisualCaptureSubmission,
} from "../shared/visual-capture.js";
import { ValidationError } from "../shared/errors.js";

// Longer than the visual renderer-command deadline: high-resolution lossless
// PNG encoding can take materially longer than an ordinary UI command.
const CAPTURE_LIFETIME_MS = 75_000;
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

export interface VisualCaptureEvidence {
  metadata: VisualCaptureMetadata | null;
  images: Readonly<Partial<Record<VisualCaptureStage, Uint8Array>>>;
  missing: Readonly<Partial<Record<VisualCaptureStage, VisualCaptureFailure>>>;
  dimensions: Readonly<Partial<Record<VisualCaptureStage, {
    width: number;
    height: number;
  }>>>;
}

interface CaptureSession {
  readonly token: string;
  readonly webContentsId: number;
  readonly timer: ReturnType<typeof setTimeout>;
  claimed: boolean;
  evidence: VisualCaptureEvidence | null;
}

const sessions = new Map<string, CaptureSession>();
const tokenByWebContents = new Map<number, string>();

export function parseVisualCaptureSubmission(
  value: unknown,
): VisualCaptureSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("invalid visual capture submission");
  }
  const token = Reflect.get(value, "token");
  const status = Reflect.get(value, "status");
  if (typeof token !== "string") {
    throw new ValidationError("invalid visual capture submission");
  }
  if (status === "failed") {
    const reason = Reflect.get(value, "reason");
    if (!VISUAL_CAPTURE_FAILURES.includes(reason as VisualCaptureFailure)) {
      throw new ValidationError("invalid visual capture failure");
    }
    return { token, status, reason: reason as VisualCaptureFailure };
  }
  if (status !== "captured") {
    throw new ValidationError("invalid visual capture submission");
  }
  const webglPng = Reflect.get(value, "webglPng");
  const offscreenPng = Reflect.get(value, "offscreenPng");
  const metadata = Reflect.get(value, "metadata");
  if (
    !(webglPng instanceof Uint8Array)
    || !(offscreenPng instanceof Uint8Array)
    || !metadata
    || typeof metadata !== "object"
    || Array.isArray(metadata)
  ) {
    throw new ValidationError("invalid visual capture submission");
  }
  return {
    token,
    status,
    webglPng,
    offscreenPng,
    metadata: validateMetadata(metadata),
  };
}

function finish(session: CaptureSession): void {
  clearTimeout(session.timer);
  sessions.delete(session.token);
  if (tokenByWebContents.get(session.webContentsId) === session.token) {
    tokenByWebContents.delete(session.webContentsId);
  }
}

export function beginVisualCapture(win: BrowserWindow): string {
  const webContentsId = win.webContents.id;
  if (tokenByWebContents.has(webContentsId)) {
    throw new ValidationError("a visual capture is already active");
  }
  const token = randomUUID();
  const session: CaptureSession = {
    token,
    webContentsId,
    claimed: false,
    evidence: null,
    timer: setTimeout(() => {
      const current = sessions.get(token);
      if (current) finish(current);
    }, CAPTURE_LIFETIME_MS),
  };
  sessions.set(token, session);
  tokenByWebContents.set(webContentsId, token);
  return token;
}

export function cancelVisualCapture(token: string): void {
  const session = sessions.get(token);
  if (session) finish(session);
}

function boundedNumber(value: number, field: string, maximum = 100_000): number {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new ValidationError(`invalid visual capture ${field}`);
  }
  return value;
}

function numericField(
  owner: object,
  key: string,
  field: string,
  maximum?: number,
): number {
  const value = Reflect.get(owner, key);
  if (typeof value !== "number") {
    throw new ValidationError(`invalid visual capture ${field}`);
  }
  return boundedNumber(value, field, maximum);
}

function validateMetadata(value: unknown): VisualCaptureMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("invalid visual capture metadata");
  }
  const bounds = Reflect.get(value, "canvasBounds");
  if (!bounds || typeof bounds !== "object") {
    throw new ValidationError("invalid visual capture bounds");
  }
  return {
    frameSequence: numericField(
      value,
      "frameSequence",
      "frame sequence",
      Number.MAX_SAFE_INTEGER,
    ),
    capturedAtRendererMs: numericField(
      value,
      "capturedAtRendererMs",
      "timestamp",
      Number.MAX_SAFE_INTEGER,
    ),
    canvasBounds: {
      x: numericField(bounds, "x", "bounds x"),
      y: numericField(bounds, "y", "bounds y"),
      width: numericField(bounds, "width", "bounds width"),
      height: numericField(bounds, "height", "bounds height"),
    },
    canvasWidth: numericField(value, "canvasWidth", "canvas width"),
    canvasHeight: numericField(value, "canvasHeight", "canvas height"),
    offscreenWidth: numericField(value, "offscreenWidth", "offscreen width"),
    offscreenHeight: numericField(value, "offscreenHeight", "offscreen height"),
    drawingBufferWidth: numericField(value, "drawingBufferWidth", "drawing buffer width"),
    drawingBufferHeight: numericField(value, "drawingBufferHeight", "drawing buffer height"),
    devicePixelRatio: numericField(
      value,
      "devicePixelRatio",
      "device pixel ratio",
      16,
    ),
  };
}

function validatePng(bytes: Uint8Array, stage: VisualCaptureStage): {
  bytes: Uint8Array;
  width: number;
  height: number;
} {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new ValidationError(`visual ${stage} image is empty`);
  }
  if (bytes.byteLength > VISUAL_IMAGE_MAX_BYTES) {
    throw new ValidationError(`visual ${stage} image is oversized`);
  }
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new ValidationError(`visual ${stage} image is not PNG`);
  }
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) throw new ValidationError(`visual ${stage} PNG is invalid`);
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0 || width > 100_000 || height > 100_000) {
    throw new ValidationError(`visual ${stage} dimensions are invalid`);
  }
  return { bytes, width, height };
}

function captureRect(metadata: VisualCaptureMetadata): Rectangle {
  const bounds = metadata.canvasBounds;
  return {
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.max(1, Math.ceil(bounds.width)),
    height: Math.max(1, Math.ceil(bounds.height)),
  };
}

export async function submitVisualCapture(
  win: BrowserWindow,
  submission: VisualCaptureSubmission,
): Promise<void> {
  const session = sessions.get(submission.token);
  if (!session || session.webContentsId !== win.webContents.id || session.claimed) {
    throw new ValidationError("visual capture token is invalid or already used");
  }
  session.claimed = true;
  if (submission.status === "failed") {
    session.evidence = {
      metadata: null,
      images: {},
      missing: Object.fromEntries(
        VISUAL_CAPTURE_STAGES.map((stage) => [stage, submission.reason]),
      ),
      dimensions: {},
    };
    return;
  }
  const metadata = submission.metadata;
  const webgl = validatePng(submission.webglPng, "webgl");
  const offscreen = validatePng(submission.offscreenPng, "offscreen");
  const images: Partial<Record<VisualCaptureStage, Uint8Array>> = {
    webgl: webgl.bytes,
    offscreen: offscreen.bytes,
  };
  const missing: Partial<Record<VisualCaptureStage, VisualCaptureFailure>> = {};
  const dimensions: Partial<Record<VisualCaptureStage, { width: number; height: number }>> = {
    webgl: { width: webgl.width, height: webgl.height },
    offscreen: { width: offscreen.width, height: offscreen.height },
  };

  const capture = async (stage: "canvas" | "window", rect?: Rectangle) => {
    try {
      const image = await win.capturePage(rect);
      if (image.isEmpty()) {
        missing[stage] = "capture-failed";
        return;
      }
      const png = validatePng(image.toPNG(), stage);
      images[stage] = png.bytes;
      dimensions[stage] = { width: png.width, height: png.height };
    } catch {
      missing[stage] = "capture-failed";
    }
  };
  await capture("canvas", captureRect(metadata));
  await capture("window");

  const total = Object.values(images).reduce(
    (sum, image) => sum + (image?.byteLength ?? 0),
    0,
  );
  if (total > VISUAL_ARCHIVE_IMAGE_MAX_BYTES) {
    throw new ValidationError("visual capture image set is oversized");
  }
  session.evidence = { metadata, images, missing, dimensions };
}

export function takeVisualCapture(token: string): VisualCaptureEvidence | null {
  const session = sessions.get(token);
  if (!session) return null;
  const evidence = session.evidence;
  finish(session);
  return evidence;
}
