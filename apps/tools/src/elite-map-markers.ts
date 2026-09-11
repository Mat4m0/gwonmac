/** Projects and groups known spawn markers without inventing live boss positions. */
import type { EliteLocation } from "../../../src/shared/elite-skills";
import type { EliteMapSurface } from "../../../src/shared/elite-map";
export type EliteMarker = Readonly<{
  key: string; x: number; y: number; locations: readonly EliteLocation[];
  active: boolean; outside: boolean;
}>;
export function eliteMarkers(
  locations: readonly EliteLocation[], surface: EliteMapSurface, activeLocation: string | null,
): readonly EliteMarker[] {
  const markers = new Map<string, EliteMarker>();
  const { a, b, c, d, e, f } = surface.transform;
  const inset = 16;
  if (surface.box.width < inset * 2 || surface.box.height < inset * 2) return [];
  for (const location of [...locations].sort((left, right) => Number(right.id === activeLocation) - Number(left.id === activeLocation))) {
    location.points.forEach(([mapX, mapY]) => {
      const px = a * mapX + c * mapY + e;
      const py = b * mapX + d * mapY + f;
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      const outside = px < inset || py < inset
        || px > surface.box.width - inset || py > surface.box.height - inset;
      const active = location.id === activeLocation;
      if (outside && !active) return;
      const x = Math.max(inset, Math.min(surface.box.width - inset, px));
      const y = Math.max(inset, Math.min(surface.box.height - inset, py));
      const cellX = Math.floor(x / 36), cellY = Math.floor(y / 36);
      let collision: EliteMarker | undefined;
      // Check neighboring cells as well: a cell boundary is not visual spacing.
      for (let dx = -1; dx <= 1 && !collision; dx++) {
        for (let dy = -1; dy <= 1 && !collision; dy++) {
          const candidate = markers.get(`${cellX + dx}:${cellY + dy}`);
          if (candidate && Math.abs(candidate.x - x) < 36 && Math.abs(candidate.y - y) < 36) collision = candidate;
        }
      }
      if (collision) {
        if (!collision.locations.some((entry) => entry.id === location.id)) {
          markers.set(collision.key, { ...collision, locations: [...collision.locations, location] });
        }
      } else {
        const key = `${cellX}:${cellY}`;
        markers.set(key, { key, x, y, locations: [location], active, outside });
      }
    });
  }
  return [...markers.values()];
}
