import {
  readToolboxCursorHeader,
  readToolboxCursorPixels,
} from "./toolbox-snapshot.js";

const EDGE = 32;
const RETINA_EDGE = EDGE * 2;
/* Runtime-composed drag cursors would otherwise grow this without limit. */
const CACHE_LIMIT = 64;

/** @param {number} edge */
function createSurface(edge) {
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Toolbox cursor canvas is unavailable");
  return { canvas, context };
}

const source = createSurface(EDGE);
const retina = createSurface(RETINA_EDGE);
/** @type {Map<string, string>} */
const cssCache = new Map();

/**
 * Chromium drops a custom cursor above 32 CSS px, so the authoring grid is
 * fixed at 32 and Retina crispness comes from the 2x image-set candidate.
 * Hotspots stay in authoring-grid pixels; Blink scales them per candidate.
 * @param {Uint8ClampedArray} pixels canonical RGBA8, row-major 32x32
 * @param {number} hotspotX
 * @param {number} hotspotY
 */
export function buildCursorCss(pixels, hotspotX, hotspotY) {
  const image = source.context.createImageData(EDGE, EDGE);
  image.data.set(pixels);
  source.context.putImageData(image, 0, 0);
  retina.context.clearRect(0, 0, RETINA_EDGE, RETINA_EDGE);
  // Nearest neighbour: smoothing would blur the doubled bitmap.
  retina.context.imageSmoothingEnabled = false;
  retina.context.drawImage(source.canvas, 0, 0, RETINA_EDGE, RETINA_EDGE);
  // Data URLs: the CSP governs cursor images through img-src, which bars blob:.
  // The trailing keyword is mandatory; without it the declaration is dropped.
  return `image-set(url("${source.canvas.toDataURL("image/png")}") 1x, url("${
    retina.canvas.toDataURL("image/png")
  }") 2x) ${hotspotX} ${hotspotY}, default`;
}

/**
 * @param {number} pixelHash
 * @param {number} hotspotX
 * @param {number} hotspotY
 */
function cacheKey(pixelHash, hotspotX, hotspotY) {
  return `${pixelHash}:${hotspotX}:${hotspotY}`;
}

/** @param {string} key */
function cacheGet(key) {
  const css = cssCache.get(key);
  if (css === undefined) return undefined;
  cssCache.delete(key);
  cssCache.set(key, css);
  return css;
}

/**
 * @param {string} key
 * @param {string} css
 */
function cacheSet(key, css) {
  cssCache.set(key, css);
  while (cssCache.size > CACHE_LIMIT) {
    const oldest = cssCache.keys().next().value;
    if (oldest === undefined) break;
    cssCache.delete(oldest);
  }
}

/**
 * Owns cursor presentation and nothing else.
 * @param {{
 *   element: HTMLElement,
 *   memory: WebAssembly.Memory,
 *   cursorPointer: number,
 *   fallback?: string,
 * }} options
 */
export function createCursorConsumer({
  element,
  memory,
  cursorPointer,
  fallback = "",
}) {
  let applied = fallback;
  let generation = -1;
  let flags = -1;
  let pixelHash = 0;
  let hidden = false;
  let valid = false;

  // Blink coalesces cursor pushes on a timer, so a changed cursor reaches the
  // OS in 1-31 ms on its own. A real layout invalidation triggers the
  // post-layout hover recompute and shortens that to 1-5 ms; a read-only
  // reflow does not. Out of flow, unpainted and untouchable, so invalidating
  // it cannot reach the game surface, and it is only ever dirtied on a change.
  const beacon = document.createElement("div");
  beacon.style.cssText =
    "position:fixed;top:0;left:0;height:1px;pointer-events:none;opacity:0";
  document.body.append(beacon);

  /** @param {string} css */
  const apply = (css) => {
    applied = css;
    // Inline style beats the stylesheet theme; the empty string hands it back.
    element.style.cursor = css;
    beacon.style.width = beacon.style.width === "1px" ? "2px" : "1px";
    void beacon.offsetWidth;
  };

  // macOS implements `cursor: none` as a transparent 1x1 NSCursor, so native
  // chrome can restore the system arrow behind our back. An identical inline
  // value does not invalidate style, hence the clear first.
  const reassert = () => {
    element.style.cursor = "";
    element.style.cursor = applied;
  };

  const poll = () => {
    const header = readToolboxCursorHeader(memory.buffer, cursorPointer);
    if (header.status === "waiting") return;
    // The kernel bumps the generation only when pixels are republished, so a
    // header-only invalidation shows up as a flags change alone.
    if (header.generation === generation && header.flags === flags) return;
    if (header.status !== "ready") {
      generation = header.generation;
      flags = header.flags;
      pixelHash = 0;
      hidden = false;
      valid = false;
      apply(fallback);
      return;
    }
    let css = "none";
    if (!header.hidden) {
      const key = cacheKey(header.pixelHash, header.hotspotX, header.hotspotY);
      const cached = cacheGet(key);
      if (cached === undefined) {
        const full = readToolboxCursorPixels(memory.buffer, cursorPointer);
        if (full === null || full.generation !== header.generation) return;
        css = buildCursorCss(full.pixels, full.hotspotX, full.hotspotY);
        cacheSet(key, css);
      } else {
        css = cached;
      }
    }
    generation = header.generation;
    flags = header.flags;
    pixelHash = header.pixelHash;
    hidden = header.hidden;
    valid = true;
    apply(css);
  };

  document.addEventListener("pointerlockchange", reassert);
  window.addEventListener("focus", reassert);

  return {
    poll,
    get state() {
      return Object.freeze({
        generation: Math.max(generation, 0),
        pixelHash,
        hidden,
        valid,
        cssLength: applied.length,
      });
    },
    dispose() {
      document.removeEventListener("pointerlockchange", reassert);
      window.removeEventListener("focus", reassert);
      beacon.remove();
      element.style.cursor = "";
    },
  };
}
