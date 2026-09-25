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
/** Elite marker surfaces draw one world rectangle per marker from a shared atlas. */
export const NATIVE_MAP_QUAD_SURFACES = ["mission_elite", "world_elite"] as const satisfies readonly NativeMapGraphicsSurface[];
export const NATIVE_MAP_QUADS_MAGIC = 0x5150414d;
export const NATIVE_MAP_QUADS_MAX = 1024;
/** x0, y0, x1, y1 in world units, then u0, v0, u1, v1; eight little-endian floats. */
export const NATIVE_MAP_QUAD_BYTES = 32;
