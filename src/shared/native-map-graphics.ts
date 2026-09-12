/**
 * Bounds the copied Cartography bitmap accepted by each native map owner.
 * The private loader and certified native publisher share this one contract.
 */
export const NATIVE_MAP_GRAPHICS_MAGIC = 0x4d415047;
export const NATIVE_MAP_GRAPHICS_HEADER_BYTES = 64;
export const NATIVE_MAP_GRAPHICS_MAX_SIZE = 2048;
export const NATIVE_MAP_GRAPHICS_SURFACES = ["mission", "world", "mission_hover", "world_hover"] as const;
export type NativeMapGraphicsSurface = typeof NATIVE_MAP_GRAPHICS_SURFACES[number];
