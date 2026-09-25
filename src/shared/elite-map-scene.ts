/**
 * Owns the Elite Skills marker scene shared by the planner, the native map
 * painter, and the offline fixture. Positions stay in map units until one map
 * surface places them, so pan and zoom never change what the planner chose.
 */
import type { EliteMapSurface } from "./elite-map.js";

export type EliteMapSurfaceName = "world" | "mission";
export type EliteMarkerEmphasis = "target" | "saved" | "match";
export type EliteSceneMarker = Readonly<{
  key: string; locationId: string; skillId: number; mapId: number;
  mapX: number; mapY: number; iconUrl: string | null;
  emphasis: EliteMarkerEmphasis; hovered: boolean;
}>;
export type EliteMarkerScene = Readonly<Record<EliteMapSurfaceName, readonly EliteSceneMarker[]>>;
export const EMPTY_ELITE_SCENE: EliteMarkerScene = Object.freeze({ world: Object.freeze([]), mission: Object.freeze([]) });

/** One drawn marker in surface-box pixels. Touching copies of one skill share it. */
export type PlacedEliteMarker = Readonly<{
  x: number; y: number; size: number; marker: EliteSceneMarker;
  locationIds: readonly string[]; outside: boolean;
}>;
/** A pointer or keyboard inspection of one placed marker, in viewport pixels. */
export type EliteMapHit = Readonly<{
  surface: EliteMapSurfaceName; locationIds: readonly string[];
  nearbyIds: readonly string[]; x: number; y: number;
}>;

/** Screen sizes in CSS pixels. Emphasis stays readable without covering the map. */
export const ELITE_MARKER_SIZE: Readonly<Record<EliteMarkerEmphasis, number>> = Object.freeze({ target: 26, saved: 20, match: 16 });
export const ELITE_MARKER_HOVER_GROWTH = 4;
const INSET = 16;
const TOUCHING = 24;
const NEARBY = 28;
const ORDER: Readonly<Record<EliteMarkerEmphasis, number>> = { match: 0, saved: 1, target: 2 };

const rank = (placed: PlacedEliteMarker) => ORDER[placed.marker.emphasis] * 2 + Number(placed.marker.hovered);

/**
 * Projects markers onto one surface. Only the target stays when it leaves the
 * view; it is clamped to the edge. Later entries draw above earlier ones.
 */
export function placeEliteMarkers(markers: readonly EliteSceneMarker[], surface: EliteMapSurface): readonly PlacedEliteMarker[] {
  const { a, b, c, d, e, f } = surface.transform;
  const { width, height } = surface.box;
  if (width < INSET * 2 || height < INSET * 2) return [];
  const single: PlacedEliteMarker[] = [];
  for (const marker of markers) {
    const px = a * marker.mapX + c * marker.mapY + e;
    const py = b * marker.mapX + d * marker.mapY + f;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const outside = px < INSET || py < INSET || px > width - INSET || py > height - INSET;
    if (outside && marker.emphasis !== "target") continue;
    const size = ELITE_MARKER_SIZE[marker.emphasis] + (marker.hovered ? ELITE_MARKER_HOVER_GROWTH : 0);
    single.push({ x: Math.max(INSET, Math.min(width - INSET, px)), y: Math.max(INSET, Math.min(height - INSET, py)),
      size, marker, locationIds: [marker.locationId], outside });
  }
  // Deduplicate artwork only where same-skill markers touch in the same map area.
  // Source locations stay intact for boss choices and capture targets.
  const groups: PlacedEliteMarker[][] = [];
  for (const placed of single) {
    const touching = groups.filter(group => group.some(other =>
      other.marker.skillId === placed.marker.skillId && other.marker.mapId === placed.marker.mapId
      && other.outside === placed.outside && Math.abs(other.x - placed.x) <= TOUCHING && Math.abs(other.y - placed.y) <= TOUCHING));
    for (const group of touching) groups.splice(groups.indexOf(group), 1);
    groups.push([...touching.flat(), placed]);
  }
  return groups.map(group => {
    const representative = group.reduce((best, next) => rank(next) > rank(best) ? next : best);
    return { ...representative, locationIds: [...new Set(group.flatMap(placed => placed.locationIds))] };
  }).sort((left, right) => rank(left) - rank(right));
}

/** The topmost marker under a surface-box point, with every distinct location nearby. */
export function eliteMarkerAt(placed: readonly PlacedEliteMarker[], x: number, y: number): Readonly<{
  marker: PlacedEliteMarker; nearbyIds: readonly string[];
}> | null {
  for (let index = placed.length - 1; index >= 0; index -= 1) {
    const marker = placed[index]!;
    const reach = marker.size / 2 + 3;
    if (Math.abs(marker.x - x) > reach || Math.abs(marker.y - y) > reach) continue;
    const nearbyIds = [...new Set(placed.filter(other => Math.abs(other.x - marker.x) < NEARBY && Math.abs(other.y - marker.y) < NEARBY)
      .flatMap(other => other.locationIds))];
    return { marker, nearbyIds };
  }
  return null;
}
