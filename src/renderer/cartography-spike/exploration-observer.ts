/**
 * Reads the bounded, pointer-free exploration bitmap spike contract.
 * Invalid or partial native snapshots stay unavailable to renderer consumers.
 */
import {
  EXPLORATION_SPIKE_GLOBALS,
  EXPLORATION_SPIKE_SCALARS,
  type ExplorationSpikeController,
  type ExplorationSpikeSnapshot,
} from "../../shared/cartography-spike.js";

const MAX_GRID_AXIS = 8_192;
const MAX_DWORDS = 262_144;

function numberGlobal(exports: WebAssembly.Exports, name: string): number | null {
  const candidate = exports[name];
  if (!(candidate instanceof WebAssembly.Global) || typeof candidate.value !== "number") {
    return null;
  }
  return Number.isFinite(candidate.value) ? candidate.value : null;
}

export function createExplorationSpikeReader(
  exports: WebAssembly.Exports,
): ExplorationSpikeController | null {
  const observe = exports[EXPLORATION_SPIKE_GLOBALS.observe];
  const readWord = exports[EXPLORATION_SPIKE_GLOBALS.readWord];
  if (
    typeof observe !== "function"
    || typeof readWord !== "function"
    || !EXPLORATION_SPIKE_SCALARS.every(
      (name) => exports[name] instanceof WebAssembly.Global,
    )
  ) return null;

  let latest: ExplorationSpikeSnapshot | null = null;
  const snapshot = (): ExplorationSpikeSnapshot | null => {
    try {
      observe();
    } catch {
      latest = null;
      return null;
    }
    const status = numberGlobal(exports, EXPLORATION_SPIKE_GLOBALS.status);
    const sequence = numberGlobal(exports, EXPLORATION_SPIKE_GLOBALS.sequence);
    const generation = numberGlobal(exports, EXPLORATION_SPIKE_GLOBALS.generation);
    const width = numberGlobal(exports, EXPLORATION_SPIKE_GLOBALS.width);
    const height = numberGlobal(exports, EXPLORATION_SPIKE_GLOBALS.height);
    const dwordCount = numberGlobal(exports, EXPLORATION_SPIKE_GLOBALS.dwordCount);
    const values = [status, sequence, generation, width, height, dwordCount];
    if (values.some((value) => value === null || !Number.isSafeInteger(value))) {
      latest = null;
      return null;
    }
    if (
      status === null || sequence === null || generation === null
      || width === null || height === null || dwordCount === null
    ) return null;
    const observed = Object.freeze({
      status, sequence, generation, width, height, dwordCount,
    });
    if (status !== 1) {
      latest = observed;
      return latest;
    }
    if (
      generation <= 0
      || width <= 0 || width > MAX_GRID_AXIS
      || height <= 0 || height > MAX_GRID_AXIS
      || dwordCount <= 0 || dwordCount > MAX_DWORDS
      || Math.ceil(width * height / 32) > dwordCount
    ) {
      latest = null;
      return null;
    }
    latest = observed;
    return latest;
  };

  return Object.freeze({
    snapshot,
    readBitmap() {
      const state = snapshot();
      if (state === null || state.status !== 1) return null;
      const words = new Uint32Array(state.dwordCount);
      try {
        for (let index = 0; index < words.length; index += 1) {
          words[index] = Number(readWord(index)) >>> 0;
        }
      } catch {
        return null;
      }
      return Object.freeze({ snapshot: state, words });
    },
    isExplored(cellX, cellY) {
      const state = latest ?? snapshot();
      if (
        state === null || state.status !== 1
        || !Number.isSafeInteger(cellX) || !Number.isSafeInteger(cellY)
        || cellX < 0 || cellX >= state.width
        || cellY < 0 || cellY >= state.height
      ) return null;
      const bit = cellY * state.width + cellX;
      const word = Number(readWord(bit >>> 5)) >>> 0;
      return ((word >>> (bit & 31)) & 1) === 1;
    },
  });
}
