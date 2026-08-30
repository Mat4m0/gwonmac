/**
 * Owns the renderer decoder for the certified, pointer-free current-map identity.
 * Its seqlock snapshot is the outer transaction boundary for Cartography.
 */
import {
  CARTOGRAPHY_CONTEXT_GLOBALS,
  CARTOGRAPHY_CONTEXT_SCALARS,
  type CartographyContextController,
  type CartographyContextSnapshot,
} from "../../shared/cartography-spike.js";

function integerGlobal(exports: WebAssembly.Exports, name: string): number | null {
  const candidate = exports[name];
  if (!(candidate instanceof WebAssembly.Global) || typeof candidate.value !== "number") {
    return null;
  }
  return Number.isSafeInteger(candidate.value) ? candidate.value : null;
}

export function createCartographyContextReader(
  exports: WebAssembly.Exports,
): CartographyContextController | null {
  const observe = exports[CARTOGRAPHY_CONTEXT_GLOBALS.observe];
  if (
    typeof observe !== "function"
    || !CARTOGRAPHY_CONTEXT_SCALARS.every(
      (name) => exports[name] instanceof WebAssembly.Global,
    )
  ) return null;

  const snapshot = (): CartographyContextSnapshot | null => {
    const first = integerGlobal(exports, CARTOGRAPHY_CONTEXT_GLOBALS.sequence);
    if (first === null || (first & 1) !== 0) return null;
    const status = integerGlobal(exports, CARTOGRAPHY_CONTEXT_GLOBALS.status);
    const areaEpoch = integerGlobal(exports, CARTOGRAPHY_CONTEXT_GLOBALS.areaEpoch);
    const mapId = integerGlobal(exports, CARTOGRAPHY_CONTEXT_GLOBALS.mapId);
    const layoutId = integerGlobal(exports, CARTOGRAPHY_CONTEXT_GLOBALS.layoutId);
    const second = integerGlobal(exports, CARTOGRAPHY_CONTEXT_GLOBALS.sequence);
    if (
      first !== second || second === null || (second & 1) !== 0
      || status === null || areaEpoch === null || mapId === null || layoutId === null
      || status < 1 || status > 5
      || areaEpoch < 0
      || (layoutId !== 1 && layoutId !== 2 && status === 1)
      || (status === 1 && (areaEpoch === 0 || mapId <= 0 || mapId > 2_000))
    ) return null;
    return Object.freeze({
      status, sequence: second, areaEpoch, mapId, layoutId,
    }) as CartographyContextSnapshot;
  };
  return Object.freeze({
    refresh() {
      try {
        observe();
        return true;
      } catch {
        return false;
      }
    },
    snapshot,
  });
}
