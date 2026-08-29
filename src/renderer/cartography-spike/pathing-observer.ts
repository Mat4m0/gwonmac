/**
 * Reads bounded pathing scalars and complete certified geometry without exporting pointers.
 * Refuses incomplete, excessive, non-finite, or structurally invalid snapshots.
 */
import {
  PATHING_SPIKE_COORDINATES,
  PATHING_SPIKE_GLOBALS,
  type PathingSpikeController,
  type PathingSpikeSnapshot,
  type PathingSpikeTrapezoid,
} from "../../shared/cartography-spike.js";

function readNumber(exports: WebAssembly.Exports, name: string): number | null {
  const value = exports[name];
  if (!(value instanceof WebAssembly.Global) || typeof value.value !== "number") {
    return null;
  }
  return Number.isFinite(value.value) ? value.value : null;
}

function readCounter(exports: WebAssembly.Exports, name: string): number | null {
  const value = readNumber(exports, name);
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Build a scalar-only reader only when the complete spike surface exists. */
export function createPathingSpikeReader(
  exports: WebAssembly.Exports,
): PathingSpikeController | null {
  const scalarNames = [
    PATHING_SPIKE_GLOBALS.status,
    PATHING_SPIKE_GLOBALS.sequence,
    PATHING_SPIKE_GLOBALS.callCount,
    PATHING_SPIKE_GLOBALS.totalTrapezoids,
    PATHING_SPIKE_GLOBALS.sampledMapTrapezoids,
    PATHING_SPIKE_GLOBALS.sampledMapZplane,
    PATHING_SPIKE_GLOBALS.generation,
    ...PATHING_SPIKE_GLOBALS.samples.flat(),
  ];
  const reset = exports[PATHING_SPIKE_GLOBALS.reset];
  const readCoordinate = exports[PATHING_SPIKE_GLOBALS.readCoordinate];
  if (
    scalarNames.some((name) => !(exports[name] instanceof WebAssembly.Global))
    || typeof reset !== "function"
    || typeof readCoordinate !== "function"
  ) return null;

  const snapshot = (): PathingSpikeSnapshot | null => {
    const status = readCounter(exports, PATHING_SPIKE_GLOBALS.status);
    const sequence = readCounter(exports, PATHING_SPIKE_GLOBALS.sequence);
    const callCount = readCounter(exports, PATHING_SPIKE_GLOBALS.callCount);
    const totalTrapezoids = readCounter(exports, PATHING_SPIKE_GLOBALS.totalTrapezoids);
    const sampledMapTrapezoids = readCounter(exports, PATHING_SPIKE_GLOBALS.sampledMapTrapezoids);
    const sampledMapZplane = readNumber(exports, PATHING_SPIKE_GLOBALS.sampledMapZplane);
    const generation = readCounter(exports, PATHING_SPIKE_GLOBALS.generation);
    const samples = PATHING_SPIKE_GLOBALS.samples.map((row) =>
      row.map((name) => readNumber(exports, name)),
    );
    if (
      status === null || sequence === null || callCount === null
      || totalTrapezoids === null || sampledMapTrapezoids === null
      || sampledMapZplane === null || !Number.isSafeInteger(sampledMapZplane)
      || sampledMapZplane < -1 || generation === null
      || samples.some((row) => row.some((value) => value === null))
    ) return null;
    return Object.freeze({
      status,
      sequence,
      callCount,
      totalTrapezoids,
      sampledMapTrapezoids,
      sampledMapZplane,
      generation,
      samples: Object.freeze(samples.map((row) => Object.freeze(row.map((value) => value!)))),
    });
  };

  const coordinateReader = readCoordinate as (index: number) => unknown;
  return Object.freeze({
    snapshot,
    reset: () => { reset(); },
    readLargestGeometry() {
      const state = snapshot();
      if (
        state?.status !== 1
        || state.generation <= 0
        || state.totalTrapezoids <= 0
        || state.totalTrapezoids > 65_536
      ) return null;
      const coordinates: number[] = [];
      try {
        for (let index = 0; index < state.totalTrapezoids * PATHING_SPIKE_COORDINATES; index += 1) {
          const value = coordinateReader(index);
          if (typeof value !== "number" || !Number.isFinite(value)) return null;
          coordinates.push(value);
        }
      } catch {
        return null;
      }
      const geometry = Array.from(
        { length: state.totalTrapezoids },
        (_, index): PathingSpikeTrapezoid => {
          const at = index * PATHING_SPIKE_COORDINATES;
          return Object.freeze({
            topLeftX: coordinates[at]!,
            topRightX: coordinates[at + 1]!,
            topY: coordinates[at + 2]!,
            bottomLeftX: coordinates[at + 3]!,
            bottomRightX: coordinates[at + 4]!,
            bottomY: coordinates[at + 5]!,
          });
        },
      );
      const valid = geometry.every((trapezoid) => {
        const coordinates = Object.values(trapezoid);
        return coordinates.every((coordinate) => Math.abs(coordinate) <= 1_000_000)
          && trapezoid.topY >= trapezoid.bottomY
          && trapezoid.topLeftX <= trapezoid.topRightX
          && trapezoid.bottomLeftX <= trapezoid.bottomRightX;
      });
      return valid ? Object.freeze(geometry) : null;
    },
  });
}
