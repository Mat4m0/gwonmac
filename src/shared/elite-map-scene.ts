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
  /** This character already learned the skill; the marker stays as progress. */
  captured: boolean;
  /** "2/4" when a boss spawns at one of several positions. */
  position: string | null;
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
export const ELITE_MARKER_SIZE: Readonly<Record<EliteMarkerEmphasis, number>> = Object.freeze({ target: 28, saved: 22, match: 18 });
export const ELITE_MARKER_HOVER_GROWTH = 4;
/** Markers grow with the game's own map zoom, up to this factor fully zoomed in. */
export const ELITE_MARKER_MAX_ZOOM_GROWTH = 1.8;
/**
 * Converts the game's normalized zoom (0 fully out, 1 fully in) to a marker
 * size factor in tenths, so a zoom animation repaints only a few times.
 */
export function eliteZoomGrowth(zoom: number): number {
  const t = Number.isFinite(zoom) ? Math.max(0, Math.min(1, zoom)) : 0;
  return Math.round((1 + (ELITE_MARKER_MAX_ZOOM_GROWTH - 1) * t) * 10) / 10;
}
const INSET = 16;
const TOUCHING = 24;
const NEARBY = 28;
const ORDER: Readonly<Record<EliteMarkerEmphasis, number>> = { match: 0, saved: 1, target: 2 };

const rank = (placed: PlacedEliteMarker) => ORDER[placed.marker.emphasis] * 2 + Number(placed.marker.hovered);

/**
 * Projects markers onto one surface. Other markers leave with the box; only the
 * target stays near the edge, clamped inside it, and only its nearest point.
 * Later entries draw above earlier ones.
 */
export function placeEliteMarkers(markers: readonly EliteSceneMarker[], surface: EliteMapSurface, growth = 1): readonly PlacedEliteMarker[] {
  const { a, b, c, d, e, f } = surface.transform;
  const { width, height } = surface.box;
  if (width < INSET * 2 || height < INSET * 2) return [];
  const single: PlacedEliteMarker[] = [];
  let edge: Readonly<{ placed: PlacedEliteMarker; distance: number }> | null = null;
  for (const marker of markers) {
    const px = a * marker.mapX + c * marker.mapY + e;
    const py = b * marker.mapX + d * marker.mapY + f;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const target = marker.emphasis === "target";
    const outside = target ? px < INSET || py < INSET || px > width - INSET || py > height - INSET
      : px < 0 || py < 0 || px > width || py > height;
    if (outside && !target) continue;
    const size = Math.round((ELITE_MARKER_SIZE[marker.emphasis] + (marker.hovered ? ELITE_MARKER_HOVER_GROWTH : 0)) * growth);
    const placed = { x: outside ? Math.max(INSET, Math.min(width - INSET, px)) : px, y: outside ? Math.max(INSET, Math.min(height - INSET, py)) : py,
      size, marker, locationIds: [marker.locationId], outside };
    if (!outside) { single.push(placed); continue; }
    // One edge arrow per target: several spawn points would stack invisible hit targets.
    const distance = Math.hypot(px - placed.x, py - placed.y);
    if (!edge || distance < edge.distance) edge = { placed, distance };
  }
  if (edge) single.push(edge.placed);
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

/** A connection between two possible spawn positions of one boss, in map units. */
export type EliteSpawnLink = Readonly<{ locationId: string; from: readonly [number, number]; to: readonly [number, number]; hovered: boolean }>;

/**
 * Joins the possible spawn positions of each hovered or targeted boss into one
 * tree of the shortest links, so they read as one hunt without zig-zags.
 */
export function eliteSpawnLinks(markers: readonly EliteSceneMarker[]): readonly EliteSpawnLink[] {
  const byLocation = new Map<string, EliteSceneMarker[]>();
  for (const marker of markers) {
    if (!marker.hovered && marker.emphasis !== "target") continue;
    byLocation.set(marker.locationId, [...byLocation.get(marker.locationId) ?? [], marker]);
  }
  const links: EliteSpawnLink[] = [];
  for (const [locationId, points] of byLocation) {
    if (points.length < 2) continue;
    // Prim's minimum spanning tree over a handful of points.
    const joined = [points[0]!]; const rest = points.slice(1);
    while (rest.length) {
      let best = { from: joined[0]!, index: 0, distance: Infinity };
      for (const from of joined) rest.forEach((to, index) => {
        const distance = Math.hypot(to.mapX - from.mapX, to.mapY - from.mapY);
        if (distance < best.distance) best = { from, index, distance };
      });
      const [to] = rest.splice(best.index, 1);
      links.push({ locationId, from: [best.from.mapX, best.from.mapY], to: [to!.mapX, to!.mapY], hovered: points.some(point => point.hovered) });
      joined.push(to!);
    }
  }
  return links;
}
