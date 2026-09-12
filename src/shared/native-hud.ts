/**
 * Bounded bitmap and icon-label layout shared by the HUD writer and transform.
 * Native frame ownership remains private to the transformed client.
 */
export const NATIVE_HUD_MAGIC = 0x48445747;
export const NATIVE_HUD_ATLAS_SIZE = 1024;
export const NATIVE_HUD_LABELS = 72;
export const NATIVE_HUD_KEYCAP = 1;
export const NATIVE_HUD_SKILLS = 8;
export const NATIVE_HUD_QUADS = 8;
export const NATIVE_HUD_HEADER = 28;
export type NativeHudQuad = Readonly<{ x: number; y: number; width: number; height: number; u: number; v: number; right: number; bottom: number }>;
