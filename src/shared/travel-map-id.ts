/**
 * Owns the corrected Piken Square map ID and its released storage projection.
 * Stable v2026.8.10 wrote 778, so rollback-safe files retain that value while
 * the current runtime and certified command use the official map ID 779.
 */

export const PIKEN_SQUARE_PRE_SEARING_MAP_ID = 779;
const RELEASED_PIKEN_SQUARE_PRE_SEARING_MAP_ID = 778;

export function travelMapIdFromReleasedStorage(mapId: number): number {
  return mapId === RELEASED_PIKEN_SQUARE_PRE_SEARING_MAP_ID
    ? PIKEN_SQUARE_PRE_SEARING_MAP_ID
    : mapId;
}

export function travelMapIdForStableStorage(mapId: number): number {
  return mapId === PIKEN_SQUARE_PRE_SEARING_MAP_ID
    ? RELEASED_PIKEN_SQUARE_PRE_SEARING_MAP_ID
    : mapId;
}
