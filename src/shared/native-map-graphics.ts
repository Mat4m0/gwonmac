/**
 * Bounds the copied map bitmap accepted by each native map owner.
 * The private loader and certified native publisher share this one contract.
 */
export const NATIVE_MAP_GRAPHICS_MAGIC = 0x4d415047;
export const NATIVE_MAP_GRAPHICS_HEADER_BYTES = 64;
export const NATIVE_MAP_GRAPHICS_MAX_SIZE = 2048;
/** Draw order on each map follows this order: Cartography, its hover, Elite markers, the Elite edge arrow. */
export const NATIVE_MAP_GRAPHICS_SURFACES = ["mission", "world", "mission_hover", "world_hover",
  "mission_elite", "world_elite", "mission_elite_edge", "world_elite_edge"] as const;
export type NativeMapGraphicsSurface = typeof NATIVE_MAP_GRAPHICS_SURFACES[number];
/** Each consumer owns and withdraws only its own surfaces. */
export const CARTOGRAPHY_MAP_GRAPHICS_SURFACES = ["mission", "world", "mission_hover", "world_hover"] as const satisfies readonly NativeMapGraphicsSurface[];
export const ELITE_MAP_GRAPHICS_SURFACES = ["mission_elite", "world_elite", "mission_elite_edge", "world_elite_edge"] as const satisfies readonly NativeMapGraphicsSurface[];
