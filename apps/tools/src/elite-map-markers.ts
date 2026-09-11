/** Projects individual known spawn markers without inventing live boss positions. */
import type { EliteLocation } from "../../../src/shared/elite-skills";
import type { EliteMapSurface } from "../../../src/shared/elite-map";
export type EliteMarker = Readonly<{
  key: string; x: number; y: number; location: EliteLocation;
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
      markers.push({ key: `${location.id}:${index}`, x, y, location, active, outside });
    });
  }
  return markers;
}
