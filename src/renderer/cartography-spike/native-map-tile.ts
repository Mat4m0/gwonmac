/**
 * Anchors cached map artwork to world units with a margin around the viewport.
 * Native map matrices move that artwork every frame; only tile changes repaint.
 */
import { CARTOGRAPHY_CELL_MAP_UNITS, type CartographyGridProjection, type CartographyCell,
  type CartographyRevealRadius } from "./cartography-grid-projection.js";

function tileAxis(scale: number, translation: number, pixels: number, paintScale: number) {
  const visibleStart = -translation / scale;
  const span = pixels / scale;
  // About 128–256 screen pixels per tile step keep panning away from texture
  // edges without allocating a second full-screen drawing surface every frame.
  const step = 2 ** Math.ceil(Math.log2(128 / paintScale));
  const start = (Math.floor(visibleStart / step) - 1) * step;
  const end = start + (Math.ceil(span / step) + 3) * step;
  return {start, end};
}

function worldRectangle(projection: CartographyGridProjection, left: number, top: number, right: number, bottom: number): CartographyGridProjection {
  const {a, d} = projection.transform;
  return {...projection, box: {left: 0, top: 0, width: (right - left) * a, height: (bottom - top) * d},
    transform: {a, b: 0, c: 0, d, e: -left * a, f: -top * d}, clip: {kind: "rectangle"},
    firstCellX: Math.floor(left / CARTOGRAPHY_CELL_MAP_UNITS), lastCellX: Math.ceil(right / CARTOGRAPHY_CELL_MAP_UNITS) - 1,
    firstCellY: Math.floor(top / CARTOGRAPHY_CELL_MAP_UNITS), lastCellY: Math.ceil(bottom / CARTOGRAPHY_CELL_MAP_UNITS) - 1,
  };
}

export function nativeMapTileProjection(projection: CartographyGridProjection): CartographyGridProjection {
  const {a, b, c, d, e, f} = projection.transform;
  if (b !== 0 || c !== 0 || a <= 0 || d <= 0) throw new Error("native map tile requires an axis-aligned map");
  // Native projection remains continuous during zoom. Raster detail changes
  // only at eighth-octave steps instead of uploading on every animation frame.
  const detail = (scale: number) => 2 ** (Math.round(Math.log2(scale) * 8) / 8);
  const paintA = detail(a); const paintD = detail(d);
  const x = tileAxis(a, e, projection.box.width, paintA); const y = tileAxis(d, f, projection.box.height, paintD);
  const tile = worldRectangle({...projection, transform: {...projection.transform, a: paintA, d: paintD}}, x.start, y.start, x.end, y.end);
  // Player motion cannot invalidate a viewport tile: current-cell inspection
  // is a separate small texture. The grid's diagnostics use this fixed origin.
  return {...tile, currentCell: {x: tile.firstCellX, y: tile.firstCellY}};
}

export function nativeMapHoverProjection(projection: CartographyGridProjection, cell: CartographyCell, radius: CartographyRevealRadius): CartographyGridProjection {
  const size = CARTOGRAPHY_CELL_MAP_UNITS;
  const marginX = 6 / projection.transform.a; const marginY = 6 / projection.transform.d;
  return worldRectangle({...projection, currentCell: cell}, (cell.x - radius) * size - marginX, (cell.y - radius) * size - marginY,
    (cell.x + radius + 1) * size + marginX, (cell.y + radius + 1) * size + marginY);
}
