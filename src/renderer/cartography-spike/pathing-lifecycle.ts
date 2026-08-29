/**
 * Owns fail-closed geometry withdrawal across Guild Wars map transitions.
 * Emits one reset per transition without retaining stale map data.
 */
import type { PathingSpikeController } from "../../shared/cartography-spike.js";
export type PathingMapLifecycle = Readonly<{
  lastReadyMapId: number | null;
  lastReadyCapture: string | null;
  resetForTransition: boolean;
}>;

export const INITIAL_PATHING_MAP_LIFECYCLE: PathingMapLifecycle = Object.freeze({
  lastReadyMapId: null,
  lastReadyCapture: null,
  resetForTransition: false,
});

export type ReadyPathingMap = Readonly<{
  mapId: number;
  capture: string | null;
}>;

/** Reset stale geometry once while preserving a capture already made for the next map. */
export function advancePathingMapLifecycle(
  lifecycle: PathingMapLifecycle,
  readyMap: ReadyPathingMap | null,
): Readonly<{ lifecycle: PathingMapLifecycle; reset: boolean; mapChanged: boolean }> {
  const leavingReadyMap = readyMap === null
    && lifecycle.lastReadyMapId !== null
    && !lifecycle.resetForTransition;
  const changedWithoutLoading = readyMap !== null
    && lifecycle.lastReadyMapId !== null
    && readyMap.mapId !== lifecycle.lastReadyMapId
    && !lifecycle.resetForTransition;
  const freshCaptureAlreadyLoaded = changedWithoutLoading
    && readyMap.capture !== null
    && readyMap.capture !== lifecycle.lastReadyCapture;
  const reset = leavingReadyMap || (changedWithoutLoading && !freshCaptureAlreadyLoaded);
  return Object.freeze({
    reset,
    mapChanged: changedWithoutLoading,
    lifecycle: Object.freeze({
      lastReadyMapId: readyMap?.mapId ?? lifecycle.lastReadyMapId,
      lastReadyCapture: reset
        ? null
        : readyMap?.capture ?? lifecycle.lastReadyCapture,
      resetForTransition: readyMap === null
        ? lifecycle.resetForTransition || reset
        : false,
    }),
  });
}

/** Owns the mutable lifecycle and the one native reset side effect. */
export function createPathingMapSession(
  pathing: Pick<PathingSpikeController, "reset">,
): Readonly<{
  advance(readyMap: ReadyPathingMap | null): Readonly<{
    reset: boolean;
    mapChanged: boolean;
  }>;
}> {
  let lifecycle = INITIAL_PATHING_MAP_LIFECYCLE;
  return Object.freeze({
    advance(readyMap) {
      const transition = advancePathingMapLifecycle(lifecycle, readyMap);
      lifecycle = transition.lifecycle;
      if (transition.reset) pathing.reset();
      return Object.freeze({
        reset: transition.reset,
        mapChanged: transition.mapChanged,
      });
    },
  });
}
