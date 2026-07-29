import assert from "node:assert/strict";
import test from "node:test";
import { installGraphics } from "../../src/renderer/graphics.js";

test("graphics diagnostics read immutable context facts only once", async () => {
  const animationFrames: FrameRequestCallback[] = [];
  const reports: unknown[] = [];
  const parameterCalls: number[] = [];
  let attributeCalls = 0;
  const contextListeners = new Map<string, (event: { preventDefault(): void }) => void>();

  const gl = {
    SAMPLES: 3,
    drawingBufferWidth: 1280,
    drawingBufferHeight: 720,
    getExtension: () => ({
      UNMASKED_RENDERER_WEBGL: 1,
      UNMASKED_VENDOR_WEBGL: 2,
    }),
    getParameter: (parameter: number) => {
      parameterCalls.push(parameter);
      if (parameter === 1) return "renderer";
      if (parameter === 2) return "vendor";
      return 0;
    },
    getContextAttributes: () => {
      attributeCalls++;
      return { antialias: false };
    },
  };

  class FakeOffscreenCanvas {
    readonly width: number;
    readonly height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    addEventListener(
      name: string,
      listener: (event: { preventDefault(): void }) => void,
    ) {
      contextListeners.set(name, listener);
    }
    getContext(kind: string) {
      return kind === "webgl2" ? gl : null;
    }
  }

  class FakeCanvas {
    width = 1280;
    height = 720;
    offscreen?: FakeOffscreenCanvas;
    context?: { transferFromImageBitmap(): void } | null;
    getContext(kind: string) {
      if (kind !== "bitmaprenderer") return null;
      return { transferFromImageBitmap() {} };
    }
  }

  Object.assign(globalThis, {
    HTMLCanvasElement: FakeCanvas,
    OffscreenCanvas: FakeOffscreenCanvas,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    cancelAnimationFrame: () => {},
    window: {
      gwNative: {
        diagnostics: {
          recordGraphics: async (report: unknown) => {
            reports.push(report);
          },
        },
      },
      dispatchEvent: () => true,
    },
  });

  const canvas = new FakeCanvas();
  const env = {
    eglCreateContext: () => 1,
    eglSwapBuffers: () => 1,
  };
  const module = { canvas };
  installGraphics({
    env: env as unknown as Parameters<typeof installGraphics>[0]["env"],
    module: module as unknown as Parameters<typeof installGraphics>[0]["module"],
    renderScale: () => 1,
    firstFrame: () => {},
    log: () => {},
  });

  env.eglCreateContext();
  await animationFrames.shift()!(0);
  env.eglCreateContext();
  await animationFrames.shift()!(0);

  assert.equal(reports.length, 2, "resize diagnostics still publish twice");
  assert.deepEqual(
    parameterCalls,
    [1, 2, 3],
    "renderer, vendor, and sample count are context-lifetime facts",
  );
  assert.equal(attributeCalls, 1, "context creation attributes are fixed too");

  contextListeners.get("webglcontextlost")!({ preventDefault() {} });
  env.eglCreateContext();
  await animationFrames.shift()!(0);
  assert.deepEqual(parameterCalls, [1, 2, 3, 1, 2, 3]);
  assert.equal(attributeCalls, 2, "a restored context is measured afresh");
});
