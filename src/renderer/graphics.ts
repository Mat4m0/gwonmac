/**
 * ArenaNet's EGL adapter. The generated client owns context creation and canvas
 * sizing; this module supplies the selected presentation path and render
 * density. The capture lifecycle lives in visual-frame-capture.ts.
 */
import {
  createVisualFrameCapture,
  visualCaptureError,
} from './visual-frame-capture.js';

let diagnosticsFrame = 0;
let visualFrameSequence = 0;

interface StaticContextFacts {
  renderer: string;
  vendor: string;
  samples: number;
  antialias: boolean;
}

// These values are fixed for a WebGL context. Re-reading them after every
// client-owned resize can flush the command buffer and synchronously wait on
// the GPU process, so retain them only for that context's lifetime.
const staticContextFacts = new WeakMap<
  WebGLRenderingContext | WebGL2RenderingContext,
  StaticContextFacts
>();
const directContextListeners = new WeakSet<HTMLCanvasElement>();

function contextFacts(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): StaticContextFacts {
  const cached = staticContextFacts.get(gl);
  if (cached) return cached;
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer: unknown = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : 'unknown';
  const vendor: unknown = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    : 'unknown';
  const facts = {
    renderer: String(renderer),
    vendor: String(vendor),
    samples: Number(gl.getParameter(gl.SAMPLES) || 0),
    antialias: !!gl.getContextAttributes()?.antialias,
  };
  staticContextFacts.set(gl, facts);
  return facts;
}

function forgetContextFacts(canvas: OffscreenCanvas | HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (gl) staticContextFacts.delete(gl);
}

/**
 * The visible canvas, carrying the two things this module attaches to it: the
 * OffscreenCanvas the client renders into and the bitmaprenderer context that
 * presents it. An interface rather than an intersection so an ordinary
 * `HTMLCanvasElement` is assignable to it without an assertion.
 */
interface PresentationCanvas extends HTMLCanvasElement {
  offscreen?: OffscreenCanvas;
  context?: ImageBitmapRenderingContext | null;
}

function scheduleDiagnostics(
  visible: HTMLCanvasElement,
  offscreen: OffscreenCanvas | HTMLCanvasElement,
  renderScale: 1 | 1.5 | 2,
  log: (...values: unknown[]) => void,
) {
  cancelAnimationFrame(diagnosticsFrame);
  diagnosticsFrame = requestAnimationFrame(async () => {
    try {
      const gl = offscreen.getContext('webgl2') || offscreen.getContext('webgl');
      const { renderer, vendor, samples, antialias } = gl
        ? contextFacts(gl)
        : { renderer: 'none', vendor: 'none', samples: 0, antialias: false };
      await window.gwNative.diagnostics.recordGraphics({
        userAgent: navigator.userAgent,
        jspi: 'Suspending' in WebAssembly,
        webglVersion: gl
          ? (gl.constructor?.name === 'WebGL2RenderingContext'
              ? 'WebGL2'
              : 'WebGL')
          : 'none',
        renderer,
        vendor,
        hardwareAcceleration:
          renderer !== 'unknown' &&
          renderer !== 'none' &&
          !/swiftshader|llvmpipe|software/i.test(renderer),
        canvasWidth: visible.width,
        canvasHeight: visible.height,
        offscreenWidth: offscreen instanceof OffscreenCanvas ? offscreen.width : 0,
        offscreenHeight: offscreen instanceof OffscreenCanvas ? offscreen.height : 0,
        drawingBufferWidth: gl?.drawingBufferWidth || 0,
        drawingBufferHeight: gl?.drawingBufferHeight || 0,
        devicePixelRatio: window.devicePixelRatio || 1,
        renderScale,
        antialias,
        samples,
      });
      window.dispatchEvent(new globalThis.Event('gw:graphics-resized'));
    } catch (error) {
      log(
        '[warn] graphics diagnostics failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}

export const installGraphics = (options: {
  env: ArenaNetEglImports;
  module: ArenaNetGraphicsModule;
  renderScale: () => 1 | 1.5 | 2;
  presentationPath?: 'offscreen' | 'direct';
  firstFrame: () => void;
  log: (...values: unknown[]) => void;
}) => {
  const {
    env,
    module,
    renderScale,
    presentationPath = 'offscreen',
    firstFrame,
    log,
  } = options;
  if (!env || typeof env.eglCreateContext !== 'function') {
    log('[warn] no eglCreateContext import — nothing will be presented');
    return;
  }

  const createContext = env.eglCreateContext;
  let visibleCanvas: PresentationCanvas | null = null;
  let presentationFailureReported = false;
  const visualCapture = createVisualFrameCapture(presentationPath);
  window.gwVisualCapture = visualCapture;
  env.eglCreateContext = (...args) => {
    const candidate = module.canvas;
    if (!(candidate instanceof globalThis.HTMLCanvasElement)) {
      throw new Error('EGL context requires the visible canvas');
    }
    const visible: PresentationCanvas = candidate;
    visibleCanvas = visible;
    if (presentationPath === 'direct') {
      if (!directContextListeners.has(visible)) {
        directContextListeners.add(visible);
        visible.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          forgetContextFacts(visible);
          window.dispatchEvent(new globalThis.Event('gw:graphics-context-reset'));
          window.gwDiagnostics?.event('graphics.contextLost');
          void window.gwDiagnostics?.flush();
        });
        visible.addEventListener('webglcontextrestored', () => {
          forgetContextFacts(visible);
          window.dispatchEvent(new globalThis.Event('gw:graphics-context-reset'));
          window.gwDiagnostics?.event('graphics.contextRestored');
          void window.gwDiagnostics?.flush();
        });
      }
      const context = createContext(...args);
      if (!context) throw new Error('EGL could not create a WebGL context');
      log(`egl context on direct canvas ${visible.width}x${visible.height}`);
      scheduleDiagnostics(visible, visible, renderScale(), log);
      return context;
    }
    if (!visible.offscreen) {
      visible.offscreen = new OffscreenCanvas(visible.width, visible.height);
      visible.offscreen.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        forgetContextFacts(visible.offscreen!);
        performance.mark('gw.graphics.context-lost');
        // Program objects do not survive the context; anything memoized
        // about them has to go with it.
        window.dispatchEvent(new globalThis.Event('gw:graphics-context-reset'));
        window.gwDiagnostics?.event('graphics.contextLost');
        void window.gwDiagnostics?.flush();
      });
      visible.offscreen.addEventListener('webglcontextrestored', () => {
        forgetContextFacts(visible.offscreen!);
        performance.mark('gw.graphics.context-restored');
        window.dispatchEvent(new globalThis.Event('gw:graphics-context-reset'));
        window.gwDiagnostics?.event('graphics.contextRestored');
        void window.gwDiagnostics?.flush();
      });
    }
    const offscreen = visible.offscreen;
    module.canvas = offscreen;
    let context: unknown;
    try {
      context = createContext(...args);
    } finally {
      module.canvas = visible;
    }
    if (!context) throw new Error('EGL could not create a WebGL context');
    visible.context ??= visible.getContext('bitmaprenderer');
    if (!visible.context) {
      throw new Error('ImageBitmap presentation is unavailable');
    }
    log(`egl context on offscreen ${visible.width}x${visible.height}`);
    scheduleDiagnostics(visible, offscreen, renderScale(), log);
    return context;
  };

  // The client owns canvas sizing. Render scale is the density it sees, not
  // a second host-side resize competing with emscripten's canvas owner.
  if (typeof env.emscripten_get_device_pixel_ratio === 'function') {
    env.emscripten_get_device_pixel_ratio = renderScale;
  }

  const swap = env.eglSwapBuffers;
  let waitingForFirstFrame = true;
  env.eglSwapBuffers = (...args) => {
    const swapStarted = performance.now();
    const ok = swap(...args);
    const swapEnded = performance.now();
    let bitmapOutUs = 0;
    let bitmapPresentUs = 0;
    let presented = false;
    if (ok && presentationPath === 'direct') presented = true;
    if (
      ok
      && !visualCapture.held
      && visibleCanvas?.offscreen
      && visibleCanvas.context
    ) {
      let bitmap: ImageBitmap | null = null;
      try {
        const captureRequested = visualCapture.requested;
        const gl = captureRequested
          ? visibleCanvas.offscreen.getContext('webgl2')
            ?? visibleCanvas.offscreen.getContext('webgl')
          : null;
        let framebuffer = null;
        if (captureRequested) {
          if (!gl) throw visualCaptureError('no-context', 'WebGL context is unavailable');
          if (gl.isContextLost()) {
            throw visualCaptureError('context-lost', 'WebGL context is lost');
          }
          framebuffer = visualCapture.read(gl);
        }
        const outStarted = performance.now();
        bitmap = visibleCanvas.offscreen.transferToImageBitmap();
        const outEnded = performance.now();
        if (captureRequested && gl && framebuffer) {
          const bounds = visibleCanvas.getBoundingClientRect();
          visualCapture.complete(
            framebuffer,
            bitmap,
            visibleCanvas.offscreen.width,
            visibleCanvas.offscreen.height,
            {
              frameSequence: ++visualFrameSequence,
              capturedAtRendererMs: performance.now(),
              canvasBounds: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              },
              canvasWidth: visibleCanvas.width,
              canvasHeight: visibleCanvas.height,
              offscreenWidth: visibleCanvas.offscreen.width,
              offscreenHeight: visibleCanvas.offscreen.height,
              drawingBufferWidth: gl.drawingBufferWidth,
              drawingBufferHeight: gl.drawingBufferHeight,
              devicePixelRatio: window.devicePixelRatio || 1,
            },
          );
        }
        visibleCanvas.context.transferFromImageBitmap(bitmap);
        bitmapOutUs = (outEnded - outStarted) * 1000;
        bitmapPresentUs = (performance.now() - outEnded) * 1000;
        presented = true;
      } catch (error) {
        visualCapture.fail(error);
        if (!presentationFailureReported) {
          presentationFailureReported = true;
          window.gwDiagnostics?.event('graphics.presentationFailed', error);
          log(
            '[err] frame presentation failed:',
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        bitmap?.close();
      }
    }
    window.gwDiagnostics?.swap(
      (swapEnded - swapStarted) * 1000,
      bitmapOutUs,
      bitmapPresentUs,
      presented || visualCapture.held,
    );
    if (waitingForFirstFrame && presented) {
      waitingForFirstFrame = false;
      firstFrame();
    }
    return ok;
  };

  const setSize = env.emscripten_set_canvas_element_size;
  if (typeof setSize === 'function') {
    env.emscripten_set_canvas_element_size = (target, width, height) => {
      const result = setSize(target, width, height);
      if (result === 0 && visibleCanvas?.offscreen) {
        const changed =
          visibleCanvas.offscreen.width !== width ||
          visibleCanvas.offscreen.height !== height;
        if (changed) {
          visibleCanvas.offscreen.width = width;
          visibleCanvas.offscreen.height = height;
          scheduleDiagnostics(
            visibleCanvas,
            visibleCanvas.offscreen,
            renderScale(),
            log,
          );
        }
      }
      return result;
    };
  }
};
