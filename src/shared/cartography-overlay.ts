/**
 * Defines the player-owned appearance shared by the Compass and Mission Map.
 * Normalises presets and custom values before either renderer consumes them.
 */

export const CARTOGRAPHY_OVERLAY_STYLE_IDS = [
  "black",
  "white",
  "green",
  "pink",
  "custom",
] as const;

export type CartographyOverlayStyleId =
  (typeof CARTOGRAPHY_OVERLAY_STYLE_IDS)[number];

export type CartographyOverlayStyle = Readonly<{
  veilColor: string;
  outlineColor: string;
  outlineWidth: number;
}>;

export const CARTOGRAPHY_OVERLAY_OPACITY_MIN = 0;
export const CARTOGRAPHY_OVERLAY_OPACITY_MAX = 100;
export const CARTOGRAPHY_CONTROL_IDLE_OPACITY_MIN = 15;
export const CARTOGRAPHY_CONTROL_IDLE_OPACITY_MAX = 100;
export const CARTOGRAPHY_OVERLAY_OUTLINE_MIN = 0;
export const CARTOGRAPHY_OVERLAY_OUTLINE_MAX = 4;

export const DEFAULT_CARTOGRAPHY_OVERLAY_CUSTOM_STYLE: CartographyOverlayStyle =
  Object.freeze({
    veilColor: "#171A1C",
    outlineColor: "#E9EEE9",
    outlineWidth: 1,
  });

export const CARTOGRAPHY_OVERLAY_BUILTIN_STYLES = Object.freeze({
  black: Object.freeze({
    veilColor: "#171A1C",
    outlineColor: "#D9E1DD",
    outlineWidth: 1,
  }),
  white: Object.freeze({
    veilColor: "#F1F0E9",
    outlineColor: "#313532",
    outlineWidth: 1,
  }),
  green: Object.freeze({
    veilColor: "#163A2B",
    outlineColor: "#9CE2B1",
    outlineWidth: 1,
  }),
  pink: Object.freeze({
    veilColor: "#582044",
    outlineColor: "#FF9DDB",
    outlineWidth: 1,
  }),
});

const HEX_COLOR = /^#[0-9A-F]{6}$/;

export function isCartographyOverlayHex(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function isCartographyOverlayStyleId(
  value: unknown,
): value is CartographyOverlayStyleId {
  return CARTOGRAPHY_OVERLAY_STYLE_IDS.some((style) => style === value);
}

export function normaliseCartographyOverlayStyle(
  value: unknown,
): CartographyOverlayStyle | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (
    !isCartographyOverlayHex(source.veilColor)
    || !isCartographyOverlayHex(source.outlineColor)
    || typeof source.outlineWidth !== "number"
    || !Number.isSafeInteger(source.outlineWidth)
    || source.outlineWidth < CARTOGRAPHY_OVERLAY_OUTLINE_MIN
    || source.outlineWidth > CARTOGRAPHY_OVERLAY_OUTLINE_MAX
  ) return null;
  return Object.freeze({
    veilColor: source.veilColor,
    outlineColor: source.outlineColor,
    outlineWidth: source.outlineWidth,
  });
}

export function cartographyOverlayStyle(
  style: CartographyOverlayStyleId,
  custom: CartographyOverlayStyle,
): CartographyOverlayStyle {
  return style === "custom" ? custom : CARTOGRAPHY_OVERLAY_BUILTIN_STYLES[style];
}
