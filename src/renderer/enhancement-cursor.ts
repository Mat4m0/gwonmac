/**
 * Turns the cursor bitmap the kernel publishes into a CSS cursor.
 *
 * The authoring grid is fixed at 32x32 because Chromium silently drops a custom
 * cursor larger than that; Retina crispness comes from the 2x candidate of the
 * same `image-set`, never from a bigger grid. The images are data URLs because
 * the CSP governs cursor images through `img-src`, which bars `blob:`.
 *
 * The cache is bounded on purpose. Drag cursors are composed at runtime, so an
 * unbounded map would grow with every distinct pointer the game ever draws.
 */
import {
  readCompanionCursorHeader,
  readCompanionCursorPixels,
} from "./companion-cursor-snapshot.js";

const EDGE = 32;
const RETINA_EDGE = EDGE * 2;
/* Runtime-composed drag cursors would otherwise grow this without limit. */
const CACHE_LIMIT = 64;

function createSurface(edge: number) {
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Enhancement cursor canvas is unavailable");
  return { canvas, context };
}

const source = createSurface(EDGE);
const retina = createSurface(RETINA_EDGE);
const cssCache = new Map<string, string>();

/**
 * Chromium drops a custom cursor above 32 CSS px, so the authoring grid is
 * fixed at 32 and Retina crispness comes from the 2x image-set candidate.
 * Hotspots stay in authoring-grid pixels; Blink scales them per candidate.
 * `pixels` is canonical RGBA8, row-major 32x32.
 */
export function buildCursorCss(
  pixels: Uint8ClampedArray,
  hotspotX: number,
  hotspotY: number,
) {
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

function cacheKey(pixelHash: number, hotspotX: number, hotspotY: number) {
  return `${pixelHash}:${hotspotX}:${hotspotY}`;
}

function cacheGet(key: string) {
  const css = cssCache.get(key);
  if (css === undefined) return undefined;
  cssCache.delete(key);
  cssCache.set(key, css);
  return css;
}

function cacheSet(key: string, css: string) {
  cssCache.set(key, css);
  while (cssCache.size > CACHE_LIMIT) {
    const oldest = cssCache.keys().next().value;
    if (oldest === undefined) break;
    cssCache.delete(oldest);
  }
}

/** Owns cursor presentation and nothing else. */
export function createCursorConsumer({
  element,
  memory,
  cursorPointer,
  fallback = "",
  transitionHold = () => false,
}: {
  element: HTMLElement;
  memory: WebAssembly.Memory;
  cursorPointer: number;
  fallback?: string;
  /**
   * While true, a published hide keeps the last visible art on screen instead
   * of `cursor: none`. The caller scopes it to a click-armed mode transition,
   * where the hide is a wait for the server rather than an instruction — the
   * eye sees one swap to the new art instead of an invisible gap. A hold that
   * ends is settled on the next poll, republish or not.
   */
  transitionHold?: () => boolean;
}) {
  let applied = fallback;
  let generation = -1;
  let flags = -1;
  let pixelHash = 0;
  let hidden = false;
  let valid = false;
  let withheld = false;

  // Blink coalesces cursor pushes on a timer, so a changed cursor reaches the
  // OS in 1-31 ms on its own. A real layout invalidation triggers the
  // post-layout hover recompute and shortens that to 1-5 ms; a read-only
  // reflow does not. Out of flow, unpainted and untouchable, so invalidating
  // it cannot reach the game surface, and it is only ever dirtied on a change.
  const beacon = document.createElement("div");
  beacon.style.cssText =
    "position:fixed;top:0;left:0;height:1px;pointer-events:none;opacity:0";
  document.body.append(beacon);

  const apply = (css: string) => {
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
    const header = readCompanionCursorHeader(memory.buffer, cursorPointer);
    if (header.status === "waiting") return;
    // The kernel bumps the generation only when pixels are republished, so a
    // header-only invalidation shows up as a flags change alone.
    if (header.generation === generation && header.flags === flags) {
      // A hold that ended without a republish still owes the hide it withheld.
      if (withheld && !transitionHold()) {
        withheld = false;
        apply("none");
      }
      return;
    }
    if (header.status !== "ready") {
      generation = header.generation;
      flags = header.flags;
      pixelHash = 0;
      hidden = false;
      valid = false;
      withheld = false;
      apply(fallback);
      return;
    }
    let css = "none";
    if (!header.hidden) {
      const key = cacheKey(header.pixelHash, header.hotspotX, header.hotspotY);
      const cached = cacheGet(key);
      if (cached === undefined) {
        const full = readCompanionCursorPixels(memory.buffer, cursorPointer);
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
    if (header.hidden && transitionHold()) {
      withheld = true;
      return;
    }
    withheld = false;
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
