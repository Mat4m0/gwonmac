/**
 * Draws Elite Skills markers inside the native Mission and World Map, so game
 * panels, tooltips, fades, and clipping treat them like the map's own icons.
 * Each distinct marker look is painted once into an atlas at the game's own
 * framebuffer resolution; every marker is one native world rectangle that
 * samples its cell. A pan moves nothing; a zoom step moves only rectangles.
 */
import { ELITE_MAP_GRAPHICS_SURFACES, NATIVE_MAP_GRAPHICS_MAX_SIZE, NATIVE_MAP_QUADS_MAX } from "../shared/native-map-graphics.js";
import type { EliteMapSurface } from "../shared/elite-map.js";
import { ELITE_MARKER_HOVER_GROWTH, ELITE_MARKER_SIZE, eliteSpawnLinks, eliteZoomGrowth, placeEliteMarkers, type EliteMapSurfaceName,
  type EliteSceneMarker, type PlacedEliteMarker } from "../shared/elite-map-scene.js";
import { createEliteArtwork, paintEliteDot, paintEliteMarker } from "../shared/ui/elite-marker-paint.js";
import { createNativeMapGraphicsLayer } from "./cartography-spike/native-map-graphics-layer.js";

export type EliteMapGraphicsInput = Readonly<{
  area: number; continent: number; surface: EliteMapSurface;
  markers: readonly EliteSceneMarker[];
  /** Game framebuffer pixels per CSS pixel; texture detail never exceeds it. */
  pixelRatio: number;
  /** The game's own map zoom, normalized: 0 fully out, 1 fully in. */
  zoom: number;
}>;
export type EliteMapGraphics = Readonly<{
  available(name: EliteMapSurfaceName): boolean;
  /** Publishes one map and returns the markers placed in its visible box. */
  update(name: EliteMapSurfaceName, input: EliteMapGraphicsInput | null): readonly PlacedEliteMarker[];
  dispose(): void;
}>;

/** Room around the largest marker for its shadow, hover outline, position badge, and filtering. */
const CELL_MARGIN = 20;
const EDGE_PIXELS = 64;
/** Spawn links: one dot every few screen pixels, clear of the icons they join. */
const DOT_SPACING = 9;
const DOT_RADIUS = 2.5;
const power = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(64, value)));
/** Rectangles follow the zoom in sixteenth-octave steps: marker size stays within 2.2%. */
const step = (scale: number) => 2 ** (Math.round(Math.log2(scale) * 16) / 16);
const look = (item: PlacedEliteMarker) =>
  `${item.marker.iconUrl}|${item.marker.emphasis}|${Number(item.marker.hovered)}|${Number(item.marker.captured)}|${item.marker.position}|${item.size}`;

export function createEliteMapGraphics(exports: WebAssembly.Exports, document: Document, changed: () => void = () => {}): EliteMapGraphics {
  const layer = createNativeMapGraphicsLayer(exports, document, ELITE_MAP_GRAPHICS_SURFACES);
  const artwork = createEliteArtwork(document, changed);
  const canvases = new Map<string, { canvas: HTMLCanvasElement; version: string }>();
  const target = (surface: string) => {
    let entry = canvases.get(surface);
    if (!entry) { entry = { canvas: document.createElement("canvas"), version: "" }; canvases.set(surface, entry); }
    return entry;
  };
  const hide = (surface: `${EliteMapSurfaceName}_elite${"" | "_edge"}`) => { layer.hide(surface); target(surface).version = ""; };
  /** Paints into an exact power-of-two canvas so the native upload never resamples it. */
  const publish = (surface: `${EliteMapSurfaceName}_elite${"" | "_edge"}`, input: EliteMapGraphicsInput,
    frame: Readonly<{ x0: number; y0: number; scaleX: number; scaleY: number; width: number; height: number }>,
    key: string, paint: (context: CanvasRenderingContext2D) => void) => {
    const entry = target(surface);
    if (entry.version !== key) {
      if (entry.canvas.width !== frame.width) entry.canvas.width = frame.width;
      if (entry.canvas.height !== frame.height) entry.canvas.height = frame.height;
      const context = entry.canvas.getContext("2d");
      if (!context) { hide(surface); return; }
      context.clearRect(0, 0, frame.width, frame.height); paint(context);
      entry.version = key;
    }
    layer.update(surface, { area: input.area, continent: input.continent, images: [{ canvas: entry.canvas, version: key }],
      projection: { box: { left: 0, top: 0, width: frame.width, height: frame.height }, clip: { kind: "rectangle" },
        transform: { a: frame.scaleX, b: 0, c: 0, d: frame.scaleY, e: -frame.x0 * frame.scaleX, f: -frame.y0 * frame.scaleY } } });
  };

  const updateMarkers = (name: EliteMapSurfaceName, input: EliteMapGraphicsInput, edge: string | null) => {
    const surface = `${name}_elite` as const;
    const markers = input.markers.filter(marker => marker.key !== edge);
    if (!markers.length) { hide(surface); return; }
    const qa = step(input.surface.transform.a); const qd = step(input.surface.transform.d);
    const ratio = Math.max(1, Math.min(3, input.pixelRatio));
    // Place against a box that holds every marker: grouping follows the zoom,
    // and markers outside the view are ready before a pan reveals them.
    const xs = markers.map(marker => marker.mapX * qa); const ys = markers.map(marker => marker.mapY * qd);
    const left = Math.min(...xs) - 32; const top = Math.min(...ys) - 32;
    const growth = eliteZoomGrowth(input.zoom);
    const placed = placeEliteMarkers(markers, { box: { left: 0, top: 0, width: Math.max(...xs) - left + 32, height: Math.max(...ys) - top + 32 },
      transform: { a: qa, b: 0, c: 0, d: qd, e: -left, f: -top } }, growth).filter(item => !item.outside).slice(-NATIVE_MAP_QUADS_MAX);
    // Dots between possible positions of the hovered boss and the target draw
    // beneath the icons; icons keep the quad budget first.
    const clear = (ELITE_MARKER_SIZE.target * growth) / 2 + 4;
    const dots = eliteSpawnLinks(markers).flatMap(link => {
      const dx = (link.to[0] - link.from[0]) * qa; const dy = (link.to[1] - link.from[1]) * qd; const length = Math.hypot(dx, dy);
      const count = Math.floor((length - clear * 2) / DOT_SPACING);
      return Array.from({ length: Math.max(0, count) }, (_, index) => {
        const t = (clear + (index + 0.5) * ((length - clear * 2) / count)) / length;
        return { x: link.from[0] + (link.to[0] - link.from[0]) * t, y: link.from[1] + (link.to[1] - link.from[1]) * t, hovered: link.hovered };
      });
    }).slice(0, NATIVE_MAP_QUADS_MAX - placed.length);
    const cell = Math.ceil((ELITE_MARKER_SIZE.target + ELITE_MARKER_HOVER_GROWTH) * growth * ratio + CELL_MARGIN * ratio);
    const columns = Math.floor(NATIVE_MAP_GRAPHICS_MAX_SIZE / cell);
    const dotLooks = [...new Set(dots.map(dot => dot.hovered ? "dot|1" : "dot|0"))];
    const looks = [...new Map(placed.map(item => [look(item), item])).values()].slice(0, columns * columns - dotLooks.length);
    const index = new Map([...looks.map(look), ...dotLooks].map((key, position) => [key, position]));
    const cells = index.size;
    const width = power(Math.min(cells, columns) * cell); const height = power(Math.ceil(cells / columns) * cell);
    const atlasKey = [cell, width, height, growth, artwork.version, ...index.keys()].join("~");
    const atlas = target(surface);
    if (atlas.version !== atlasKey) {
      if (atlas.canvas.width !== width) atlas.canvas.width = width;
      if (atlas.canvas.height !== height) atlas.canvas.height = height;
      const context = atlas.canvas.getContext("2d");
      if (!context) { hide(surface); return; }
      context.clearRect(0, 0, width, height);
      const centre = (position: number) => ({ x: (position % columns + 0.5) * cell, y: (Math.floor(position / columns) + 0.5) * cell });
      looks.forEach((item, position) => paintEliteMarker(context, { ...centre(position),
        size: item.size * ratio, marker: item.marker, direction: null }, ratio, artwork));
      for (const key of dotLooks) { const { x, y } = centre(index.get(key)!); paintEliteDot(context, x, y, DOT_RADIUS * growth * ratio, key === "dot|1"); }
      atlas.version = atlasKey;
    }
    const drawn = placed.filter(item => index.has(look(item)));
    const quads = new Float32Array((dots.length + drawn.length) * 8);
    // A quad samples `span` texels around its cell centre and covers the same
    // span on screen, so atlas texels map one-to-one to framebuffer pixels.
    const quad = (position: number, key: string, x: number, y: number, span: number) => {
      const at = index.get(key)!; const cu = (at % columns + 0.5) * cell; const cv = (Math.floor(at / columns) + 0.5) * cell;
      const halfX = span / ratio / 2 / qa; const halfY = span / ratio / 2 / qd;
      quads.set([x - halfX, y - halfY, x + halfX, y + halfY,
        (cu - span / 2) / width, (cv - span / 2) / height, (cu + span / 2) / width, (cv + span / 2) / height], position * 8);
    };
    const dotSpan = Math.ceil((DOT_RADIUS * growth + 2) * 2 * ratio);
    dots.forEach((dot, position) => quad(position, dot.hovered ? "dot|1" : "dot|0", dot.x, dot.y, dotSpan));
    drawn.forEach((item, position) => quad(dots.length + position, look(item), item.marker.mapX, item.marker.mapY, cell));
    layer.updateQuads(surface, { area: input.area, continent: input.continent, quads,
      atlas: { canvas: atlas.canvas, version: atlasKey },
      version: [qa, qd, growth, dots.length, ...dots.slice(0, 1).map(dot => `${dot.x},${dot.y}`),
        ...drawn.map(item => `${item.marker.key}:${look(item)}`)].join("|") });
  };

  const updateEdge = (name: EliteMapSurfaceName, input: EliteMapGraphicsInput, placed: readonly PlacedEliteMarker[]) => {
    const surface = `${name}_elite_edge` as const;
    const item = placed.find(entry => entry.outside);
    if (!item) { hide(surface); return; }
    const { a, d, e, f } = input.surface.transform;
    const ratio = Math.max(0.5, input.pixelRatio);
    const size = power(EDGE_PIXELS * ratio);
    const mapX = (item.x - e) / a; const mapY = (item.y - f) / d;
    const direction = Math.atan2(d * item.marker.mapY + f - item.y, a * item.marker.mapX + e - item.x);
    const frame = { x0: mapX - size / 2 / (a * ratio), y0: mapY - size / 2 / (d * ratio), scaleX: a * ratio, scaleY: d * ratio, width: size, height: size };
    const key = [item.marker.key, item.marker.iconUrl, Number(item.marker.hovered), Number(item.marker.captured), Math.round(direction * 32), size, artwork.version].join(":");
    publish(surface, input, frame, key, context => paintEliteMarker(context,
      { x: size / 2, y: size / 2, size: item.size * ratio, marker: item.marker, direction }, ratio, artwork));
  };

  return Object.freeze({
    available: (name) => layer.available(`${name}_elite`),
    update(name, input) {
      const { a, b, c, d } = input?.surface.transform ?? { a: 0, b: 0, c: 0, d: 0 };
      if (!input || !input.markers.length || b !== 0 || c !== 0 || !(a > 0) || !(d > 0) || !layer.available(`${name}_elite`)) {
        hide(`${name}_elite`); hide(`${name}_elite_edge`); return [];
      }
      const placed = placeEliteMarkers(input.markers, input.surface, eliteZoomGrowth(input.zoom));
      updateMarkers(name, input, placed.find(item => item.outside)?.marker.key ?? null);
      if (layer.available(`${name}_elite_edge`)) updateEdge(name, input, placed);
      return placed;
    },
    dispose() {
      artwork.dispose();
      try { layer.dispose(); } finally {
        for (const { canvas } of canvases.values()) { canvas.width = 0; canvas.height = 0; }
        canvases.clear();
      }
    },
  });
}
