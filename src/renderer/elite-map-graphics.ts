/**
 * Draws Elite Skills markers inside the native Mission and World Map, so game
 * panels, tooltips, fades, and clipping treat them like the map's own icons.
 * Artwork is anchored in world-map units: the game's camera moves it during a
 * pan, and only a changed marker set, icon, or zoom step repaints the texture.
 */
import { ELITE_MAP_GRAPHICS_SURFACES, NATIVE_MAP_GRAPHICS_MAX_SIZE } from "../shared/native-map-graphics.js";
import type { EliteMapSurface } from "../shared/elite-map.js";
import { ELITE_MARKER_HOVER_GROWTH, ELITE_MARKER_SIZE, placeEliteMarkers, type EliteMapSurfaceName,
  type EliteSceneMarker, type PlacedEliteMarker } from "../shared/elite-map-scene.js";
import { createEliteArtwork, paintEliteMarker } from "../shared/ui/elite-marker-paint.js";
import { createNativeMapGraphicsLayer } from "./cartography-spike/native-map-graphics-layer.js";

export type EliteMapGraphicsInput = Readonly<{
  area: number; continent: number; surface: EliteMapSurface;
  markers: readonly EliteSceneMarker[];
  /** Game framebuffer pixels per CSS pixel; texture detail never exceeds it. */
  pixelRatio: number;
}>;
export type EliteMapGraphics = Readonly<{
  available(name: EliteMapSurfaceName): boolean;
  /** Publishes one map and returns the markers placed in its visible box. */
  update(name: EliteMapSurfaceName, input: EliteMapGraphicsInput | null): readonly PlacedEliteMarker[];
  dispose(): void;
}>;

/** About 256 screen pixels per snap step keep small pans on one cached tile. */
const SNAP_PIXELS = 256;
const REACH = (ELITE_MARKER_SIZE.target + ELITE_MARKER_HOVER_GROWTH) / 2 + 12;
const EDGE_PIXELS = 64;
const power = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(64, value)));
const signature = (placed: readonly PlacedEliteMarker[]) =>
  placed.map(item => `${item.marker.key}:${item.marker.emphasis}:${Number(item.marker.hovered)}:${item.locationIds.length}`).join("|");

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

  const updateTile = (name: EliteMapSurfaceName, input: EliteMapGraphicsInput) => {
    const surface = `${name}_elite` as const;
    const { a, d, e, f } = input.surface.transform; const { width, height } = input.surface.box;
    // Raster detail changes in sixteenth-octave steps: icon size stays within 2.2%.
    const qa = 2 ** (Math.round(Math.log2(a) * 16) / 16); const qd = 2 ** (Math.round(Math.log2(d) * 16) / 16);
    const stepX = SNAP_PIXELS / qa; const stepY = SNAP_PIXELS / qd;
    const view = { x0: Math.floor((-e / a) / stepX - 1) * stepX, y0: Math.floor((-f / d) / stepY - 1) * stepY,
      x1: Math.ceil(((width - e) / a) / stepX + 1) * stepX, y1: Math.ceil(((height - f) / d) / stepY + 1) * stepY };
    const points = input.markers.filter(marker => marker.mapX >= view.x0 && marker.mapX <= view.x1 && marker.mapY >= view.y0 && marker.mapY <= view.y1);
    if (!points.length) { hide(surface); return; }
    const x0 = Math.max(view.x0, Math.min(...points.map(marker => marker.mapX)) - REACH / qa);
    const y0 = Math.max(view.y0, Math.min(...points.map(marker => marker.mapY)) - REACH / qd);
    const spanX = Math.min(view.x1, Math.max(...points.map(marker => marker.mapX)) + REACH / qa) - x0;
    const spanY = Math.min(view.y1, Math.max(...points.map(marker => marker.mapY)) + REACH / qd) - y0;
    let ratio = Math.max(0.5, input.pixelRatio);
    ratio = Math.min(ratio, NATIVE_MAP_GRAPHICS_MAX_SIZE / (spanX * qa), NATIVE_MAP_GRAPHICS_MAX_SIZE / (spanY * qd));
    const frame = { x0, y0, scaleX: qa * ratio, scaleY: qd * ratio,
      width: Math.min(NATIVE_MAP_GRAPHICS_MAX_SIZE, power(spanX * qa * ratio)), height: Math.min(NATIVE_MAP_GRAPHICS_MAX_SIZE, power(spanY * qd * ratio)) };
    // Place against the whole tile: markers just outside the view are ready before a pan reveals them.
    const placed = placeEliteMarkers(points, { box: { left: 0, top: 0, width: frame.width / ratio, height: frame.height / ratio },
      transform: { a: qa, b: 0, c: 0, d: qd, e: -x0 * qa, f: -y0 * qd } }).filter(item => !item.outside);
    const key = [x0, y0, frame.scaleX, frame.scaleY, frame.width, frame.height, artwork.version, signature(placed)].join(":");
    publish(surface, input, frame, key, context => {
      for (const item of placed) paintEliteMarker(context, { x: item.x * ratio, y: item.y * ratio, size: item.size * ratio,
        marker: item.marker, direction: null }, ratio, artwork);
    });
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
    const key = [item.marker.key, Number(item.marker.hovered), Math.round(direction * 32), size, artwork.version].join(":");
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
      const placed = placeEliteMarkers(input.markers, input.surface);
      updateTile(name, input);
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
