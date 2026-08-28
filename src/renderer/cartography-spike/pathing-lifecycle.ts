/**
 * Owns fail-closed geometry withdrawal across Guild Wars map transitions.
 * Emits one reset per transition without retaining stale map data.
 */
export type PathingMapLifecycle = Readonly<{
  lastReadyMapId: number | null;
  resetForTransition: boolean;
}>;

export const INITIAL_PATHING_MAP_LIFECYCLE: PathingMapLifecycle = Object.freeze({
  lastReadyMapId: null,
  resetForTransition: false,
});

/** Reset once while leaving a ready map, with a map-id-change fallback. */
export function advancePathingMapLifecycle(
  lifecycle: PathingMapLifecycle,
  readyMapId: number | null,
): Readonly<{ lifecycle: PathingMapLifecycle; reset: boolean }> {
  const leavingReadyMap = readyMapId === null
    && lifecycle.lastReadyMapId !== null
    && !lifecycle.resetForTransition;
  const changedWithoutLoading = readyMapId !== null
    && lifecycle.lastReadyMapId !== null
    && readyMapId !== lifecycle.lastReadyMapId
    && !lifecycle.resetForTransition;
  const reset = leavingReadyMap || changedWithoutLoading;
  return Object.freeze({
    reset,
    lifecycle: Object.freeze({
      lastReadyMapId: readyMapId ?? lifecycle.lastReadyMapId,
      resetForTransition: readyMapId === null
        ? lifecycle.resetForTransition || reset
        : false,
    }),
  });
}
