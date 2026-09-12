/** Projects individual known spawn markers without inventing live boss positions. */
import type { EliteLocation } from "../../../src/shared/elite-skills";
import type { EliteMapSurface } from "../../../src/shared/elite-map";
export type EliteMarker = Readonly<{
  key: string; x: number; y: number; location: EliteLocation;
  locations: readonly EliteLocation[];
  active: boolean; outside: boolean;
}>;
export function eliteMarkers(
  locations: readonly EliteLocation[], surface: EliteMapSurface, activeLocation: string | null,
): readonly EliteMarker[] {
  const markers: EliteMarker[] = [];
  const { a, b, c, d, e, f } = surface.transform;
  const inset = 16;
  if (surface.box.width < inset * 2 || surface.box.height < inset * 2) return [];
  for (const location of locations) {
    location.points.forEach(([mapX, mapY], index) => {
      const px = a * mapX + c * mapY + e;
      const py = b * mapX + d * mapY + f;
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      const outside = px < inset || py < inset
        || px > surface.box.width - inset || py > surface.box.height - inset;
      const active = location.id === activeLocation;
      if (outside && !active) return;
      const x = Math.max(inset, Math.min(surface.box.width - inset, px));
      const y = Math.max(inset, Math.min(surface.box.height - inset, py));
      markers.push({ key: `${location.id}:${index}`, x, y, location, locations: [location], active, outside });
    });
  }
  // Deduplicate artwork only where same-skill markers touch in the same map area.
  // Keep source locations and positions intact for boss choices and capture targets.
  const groups: EliteMarker[][] = [];
  for (const marker of markers) {
    const touching = groups.filter(group => group.some(other =>
      other.location.skillId === marker.location.skillId && other.location.mapId === marker.location.mapId
      && other.outside === marker.outside && Math.abs(other.x - marker.x) <= 24 && Math.abs(other.y - marker.y) <= 24));
    const combined = [...touching.flat(), marker];
    for (const group of touching) groups.splice(groups.indexOf(group), 1);
    groups.push(combined);
  }
  return groups.map(group => {
    const representative = group.find(marker => marker.active) ?? group[0]!;
    return { ...representative, locations: [...new Map(group.map(marker => [marker.location.id, marker.location])).values()] };
  });
}
