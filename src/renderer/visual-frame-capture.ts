/**
 * One-frame renderer capture lifecycle, kept out of EGL presentation.
 * Framebuffer readback happens before ImageBitmap transfer; PNG encoding may
 * continue afterwards while presentation stays on the submitted frame.
 */
import {
  VISUAL_IMAGE_MAX_BYTES,
  type VisualCaptureFailure,
  type VisualCaptureMetadata,
} from "../shared/visual-capture.js";

const FRAME_WAIT_MS = 5_000;

interface PendingCapture {
  resolve: (lease: VisualCaptureLease) => void;
  reject: (error: Error) => void;
  timer: number;
}

export interface FramebufferReadback {
  pixels: Uint8Array;
  width: number;
  height: number;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function visualCaptureError(
  reason: VisualCaptureFailure,
  message: string,
): VisualCaptureError {
  return Object.assign(new Error(message), { visualCaptureFailure: reason });
}

function pngBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

async function encodePixels(
  readback: FramebufferReadback,
): Promise<Uint8Array> {
  const { pixels, width, height } = readback;
  const rowBytes = width * 4;
  const topDown = new Uint8ClampedArray(pixels.byteLength);
  for (let row = 0; row < height; row++) {
    const source = (height - row - 1) * rowBytes;
    topDown.set(pixels.subarray(source, source + rowBytes), row * rowBytes);
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable for framebuffer capture");
  context.putImageData(new ImageData(topDown, width, height), 0, 0);
  return pngBytes(await canvas.convertToBlob({ type: "image/png" }));
}

async function encodeBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable for frame capture");
  // drawImage is synchronous, so the pixels are copied before presentation
  // transfers ownership of `bitmap` to the visible canvas.
  context.drawImage(bitmap, 0, 0);
  return pngBytes(await canvas.convertToBlob({ type: "image/png" }));
}

export function readDefaultFramebuffer(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): FramebufferReadback {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const byteLength = width * height * 4;
  if (
    width <= 0
    || height <= 0
    || !Number.isSafeInteger(byteLength)
    || byteLength > VISUAL_IMAGE_MAX_BYTES
  ) {
    throw visualCaptureError(
      "oversized",
      "WebGL framebuffer is too large or empty to capture safely",
    );
  }
  const pixels = new Uint8Array(byteLength);
  if (
    typeof globalThis.WebGL2RenderingContext !== "undefined"
    && gl instanceof globalThis.WebGL2RenderingContext
  ) {
    const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as
      | WebGLFramebuffer
      | null;
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
    }
  } else {
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as
      | WebGLFramebuffer
      | null;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    }
  }
  return { pixels, width, height };
}

export function createVisualFrameCapture(
  presentationPath: "offscreen" | "direct",
) {
  let pending: PendingCapture | null = null;
  let activeLease: object | null = null;
  let inFlight: { capture: PendingCapture; lease: object } | null = null;

  const fail = (error: unknown): void => {
    const capture = pending;
    if (capture) {
      pending = null;
      window.clearTimeout(capture.timer);
      capture.reject(asError(error));
      return;
    }
    const encoding = inFlight;
    if (!encoding) return;
    inFlight = null;
    if (activeLease === encoding.lease) activeLease = null;
    encoding.capture.reject(asError(error));
  };

  return Object.freeze({
    capture(): Promise<VisualCaptureLease> {
      if (presentationPath === "direct") {
        return Promise.reject(
          visualCaptureError(
            "unsupported",
            "synchronized capture is unsupported on the direct canvas",
          ),
        );
      }
      if (pending || activeLease) {
        return Promise.reject(new Error("a visual capture is already active"));
      }
      return new Promise<VisualCaptureLease>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          if (pending?.timer !== timer) return;
          pending = null;
          reject(visualCaptureError(
            "timed-out",
            "visual capture timed out waiting for a frame",
          ));
        }, FRAME_WAIT_MS);
        pending = { resolve, reject, timer };
      });
    },
    get requested(): boolean {
      return pending !== null;
    },
    get held(): boolean {
      return activeLease !== null;
    },
    read(gl: WebGLRenderingContext | WebGL2RenderingContext): FramebufferReadback {
      if (!pending) throw new Error("no visual capture is pending");
      return readDefaultFramebuffer(gl);
    },
    complete(
      readback: FramebufferReadback,
      bitmap: ImageBitmap,
      bitmapWidth: number,
      bitmapHeight: number,
      metadata: VisualCaptureMetadata,
    ): void {
      const capture = pending;
      if (!capture) throw new Error("no visual capture is pending");
      pending = null;
      window.clearTimeout(capture.timer);
      const lease = {};
      activeLease = lease;
      const encoding = { capture, lease };
      inFlight = encoding;
      void Promise.all([
        encodePixels(readback),
        encodeBitmap(bitmap, bitmapWidth, bitmapHeight),
      ]).then(
        ([webglPng, offscreenPng]) => {
          if (inFlight !== encoding) return;
          inFlight = null;
          capture.resolve({
            webglPng,
            offscreenPng,
            metadata,
            release() {
              if (activeLease === lease) activeLease = null;
            },
          });
        },
        (error: unknown) => {
          if (inFlight !== encoding) return;
          inFlight = null;
          if (activeLease === lease) activeLease = null;
          capture.reject(asError(error));
        },
      );
    },
    fail,
  });
}
