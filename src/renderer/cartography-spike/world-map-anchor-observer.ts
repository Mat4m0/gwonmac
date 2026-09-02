/**
 * Reads the pointer-free world-map anchor published by the certified transform.
 * It exposes no client memory address to renderer consumers.
 */
import {
  WORLD_MAP_ANCHOR_SPIKE_GLOBALS,
  WORLD_MAP_ANCHOR_SPIKE_SCALARS,
  type WorldMapAnchorSpikeController,
} from "../../shared/cartography-spike.js";

function numberGlobal(exports: WebAssembly.Exports, name: string): number | null {
  const candidate = exports[name];
  if (!(candidate instanceof WebAssembly.Global) || typeof candidate.value !== "number") {
    return null;
  }
  return Number.isFinite(candidate.value) ? candidate.value : null;
}

export function createWorldMapAnchorSpikeReader(
  exports: WebAssembly.Exports,
): WorldMapAnchorSpikeController | null {
  const observe = exports[WORLD_MAP_ANCHOR_SPIKE_GLOBALS.observe];
  if (
    typeof observe !== "function"
    || !WORLD_MAP_ANCHOR_SPIKE_SCALARS.every(
      (name) => exports[name] instanceof WebAssembly.Global,
    )
  ) return null;

  return Object.freeze({
    snapshot() {
      try {
        observe();
      } catch {
        return null;
      }
      const status = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.status);
      const generation = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.generation);
      const continent = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.continent);
      const worldAnchorX = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.worldAnchorX);
      const worldAnchorY = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.worldAnchorY);
      const mapMinX = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.mapMinX);
      const mapMinY = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.mapMinY);
      const mapMaxX = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.mapMaxX);
      const mapMaxY = numberGlobal(exports, WORLD_MAP_ANCHOR_SPIKE_GLOBALS.mapMaxY);
      if (
        status === null || generation === null
        || continent === null || worldAnchorX === null || worldAnchorY === null
        || mapMinX === null || mapMinY === null || mapMaxX === null || mapMaxY === null
        || !Number.isSafeInteger(status) || !Number.isSafeInteger(generation)
        || !Number.isSafeInteger(continent)
      ) return null;
      const snapshot = Object.freeze({
        status, generation, continent, worldAnchorX, worldAnchorY,
        mapMinX, mapMinY, mapMaxX, mapMaxY,
      });
      return status !== 1 || (
        continent >= 0 && continent <= 5
        && Math.abs(worldAnchorX) <= 1_000_000
        && Math.abs(worldAnchorY) <= 1_000_000
        && mapMinX >= 0 && mapMinY >= 0
        && mapMaxX > mapMinX && mapMaxY > mapMinY
        && mapMaxX <= 1_000_000 && mapMaxY <= 1_000_000
      )
        ? snapshot
        : null;
    },
  });
}
