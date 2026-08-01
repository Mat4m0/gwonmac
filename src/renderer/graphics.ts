/**
 * ArenaNet's EGL adapter. The generated client owns context creation and canvas
 * sizing; this module only supplies the OffscreenCanvas presentation path and
 * the selected render density.
 */

let diagnosticsFrame = 0;

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

function forgetContextFacts(canvas: OffscreenCanvas) {
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
  offscreen: OffscreenCanvas,
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
        offscreenWidth: offscreen.width,
        offscreenHeight: offscreen.height,
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
  firstFrame: () => void;
  log: (...values: unknown[]) => void;
}) => {
  const { env, module, renderScale, firstFrame, log } = options;
  if (!env || typeof env.eglCreateContext !== 'function') {
    log('[warn] no eglCreateContext import — nothing will be presented');
    return;
  }

  const createContext = env.eglCreateContext;
  let visibleCanvas: PresentationCanvas | null = null;
  let presentationFailureReported = false;
  env.eglCreateContext = (...args) => {
    const candidate = module.canvas;
    if (!(candidate instanceof globalThis.HTMLCanvasElement)) {
      throw new Error('EGL context requires the visible canvas');
    }
    const visible: PresentationCanvas = candidate;
    visibleCanvas = visible;
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
    if (ok && visibleCanvas?.offscreen && visibleCanvas.context) {
      let bitmap: ImageBitmap | null = null;
      try {
        const outStarted = performance.now();
        bitmap = visibleCanvas.offscreen.transferToImageBitmap();
        const outEnded = performance.now();
        visibleCanvas.context.transferFromImageBitmap(bitmap);
        bitmapOutUs = (outEnded - outStarted) * 1000;
        bitmapPresentUs = (performance.now() - outEnded) * 1000;
        presented = true;
      } catch (error) {
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
      presented,
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
