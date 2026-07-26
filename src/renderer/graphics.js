// ArenaNet's EGL adapter. The generated client owns context creation and canvas
// sizing; this module only supplies the OffscreenCanvas presentation path and
// the selected render density.

let diagnosticsFrame = 0;

/**
 * @param {HTMLCanvasElement} visible
 * @param {OffscreenCanvas} offscreen
 * @param {1 | 1.5 | 2} renderScale
 * @param {(...values: unknown[]) => void} log
 */
function scheduleDiagnostics(visible, offscreen, renderScale, log) {
  cancelAnimationFrame(diagnosticsFrame);
  diagnosticsFrame = requestAnimationFrame(async () => {
    try {
      const gl = offscreen.getContext('webgl2') || offscreen.getContext('webgl');
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : (gl ? 'unknown' : 'none');
      const vendor = dbg
        ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
        : (gl ? 'unknown' : 'none');
      const attributes = gl?.getContextAttributes();
      await window.gwNative.diagnostics.recordGraphics({
        userAgent: navigator.userAgent,
        jspi: 'Suspending' in WebAssembly,
        webglVersion: gl
          ? (gl.constructor?.name === 'WebGL2RenderingContext'
              ? 'WebGL2'
              : 'WebGL')
          : 'none',
        renderer: String(renderer),
        vendor: String(vendor),
        hardwareAcceleration:
          renderer !== 'unknown' &&
          renderer !== 'none' &&
          !/swiftshader|llvmpipe|software/i.test(String(renderer)),
        canvasWidth: visible.width,
        canvasHeight: visible.height,
        offscreenWidth: offscreen.width,
        offscreenHeight: offscreen.height,
        drawingBufferWidth: gl?.drawingBufferWidth || 0,
        drawingBufferHeight: gl?.drawingBufferHeight || 0,
        devicePixelRatio: window.devicePixelRatio || 1,
        renderScale,
        antialias: !!attributes?.antialias,
        samples: gl ? Number(gl.getParameter(gl.SAMPLES) || 0) : 0,
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

/**
 * @param {{
 *   env: ArenaNetEglImports,
 *   module: ArenaNetGraphicsModule,
 *   renderScale(): 1 | 1.5 | 2,
 *   firstFrame(): void,
 *   log(...values: unknown[]): void,
 * }} options
 */
export const installGraphics = (options) => {
  const { env, module, renderScale, firstFrame, log } = options;
  if (!env || typeof env.eglCreateContext !== 'function') {
    log('[warn] no eglCreateContext import — nothing will be presented');
    return;
  }

  const createContext = env.eglCreateContext;
  /** @type {(HTMLCanvasElement & {
   *   offscreen?: OffscreenCanvas,
   *   context?: ImageBitmapRenderingContext | null
   * }) | null} */
  let visibleCanvas = null;
  let presentationFailureReported = false;
  env.eglCreateContext = (...args) => {
    const candidate = module.canvas;
    if (!(candidate instanceof globalThis.HTMLCanvasElement)) {
      throw new Error('EGL context requires the visible canvas');
    }
    const visible =
      /** @type {HTMLCanvasElement & {
       *   offscreen?: OffscreenCanvas,
       *   context?: ImageBitmapRenderingContext | null
       * }} */ (candidate);
    visibleCanvas = visible;
    if (!visible.offscreen) {
      visible.offscreen = new OffscreenCanvas(visible.width, visible.height);
      visible.offscreen.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        performance.mark('gw.graphics.context-lost');
        // Program objects do not survive the context; anything memoized
        // about them has to go with it.
        window.dispatchEvent(new globalThis.Event('gw:graphics-context-reset'));
        window.gwDiagnostics?.event('graphics.contextLost');
        void window.gwDiagnostics?.flush();
      });
      visible.offscreen.addEventListener('webglcontextrestored', () => {
        performance.mark('gw.graphics.context-restored');
        window.dispatchEvent(new globalThis.Event('gw:graphics-context-reset'));
        window.gwDiagnostics?.event('graphics.contextRestored');
        void window.gwDiagnostics?.flush();
      });
    }
    const offscreen = visible.offscreen;
    module.canvas = offscreen;
    let context;
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
      /** @type {ImageBitmap | null} */
      let bitmap = null;
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
    /**
     * @param {unknown} target
     * @param {number} width
     * @param {number} height
     */
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
