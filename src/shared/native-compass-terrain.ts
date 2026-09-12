/**
 * Defines the bounded bitmap contract between Cartography and its native Canvas.
 * Coordinates are game-world units; native pointers stay inside the private loader.
 */
export const NATIVE_COMPASS_TERRAIN_MAGIC = 0x43544d50;
export const NATIVE_COMPASS_TERRAIN_HEADER_BYTES = 32;
export const NATIVE_COMPASS_TERRAIN_MAX_SIZE = 2048;
export const NATIVE_COMPASS_TERRAIN_WORLD_SPAN = 16384;
export const NATIVE_COMPASS_WORLD_SCALE = 0.40625 / 4500;
export const NATIVE_COMPASS_CLIP_RADIUS = 96 / 245;
