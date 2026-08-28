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
  /** Darkens or tints terrain that the pathing mask does not expose. */
  veilColor: string;
  /** Separates the certified walkable shape from the veil. */
  outlineColor: string;
  outlineWidth: number;
  /** Fixed cartography-cell lattice. */
  gridColor: string;
  /** Cells the game has not yet reported as explored. */
  missingColor: string;
  /** Cell currently occupied by the player. */
  currentColor: string;
  /** Cell under the pointer on the Mission Map. */
  hoverColor: string;
  /** Normal Compass 3x3 reveal footprint. */
  normalRangeColor: string;
  /** Bird's Eye Compass 7x7 reveal footprint. */
  birdsEyeRangeColor: string;
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
    outlineColor: "#D9E1DD",
    outlineWidth: 1,
    gridColor: "#D8E1DE",
    missingColor: "#E2B85C",
    currentColor: "#8ED8F8",
    hoverColor: "#F4F1E7",
    normalRangeColor: "#8ED8F8",
    birdsEyeRangeColor: "#C2B8FF",
  });

export const CARTOGRAPHY_OVERLAY_BUILTIN_STYLES = Object.freeze({
  black: Object.freeze({
    veilColor: "#171A1C",
    outlineColor: "#D9E1DD",
    outlineWidth: 1,
    gridColor: "#D8E1DE",
    missingColor: "#E2B85C",
    currentColor: "#8ED8F8",
    hoverColor: "#F4F1E7",
    normalRangeColor: "#8ED8F8",
    birdsEyeRangeColor: "#C2B8FF",
  }),
  white: Object.freeze({
    veilColor: "#F1F0E9",
    outlineColor: "#313532",
    outlineWidth: 1,
    gridColor: "#343A37",
    missingColor: "#8A5A00",
    currentColor: "#006F84",
    hoverColor: "#6A3E8E",
    normalRangeColor: "#007E94",
    birdsEyeRangeColor: "#6750A4",
  }),
  green: Object.freeze({
    veilColor: "#163A2B",
    outlineColor: "#9CE2B1",
    outlineWidth: 1,
    gridColor: "#B8D8C2",
    missingColor: "#F2C45E",
    currentColor: "#79DCE8",
    hoverColor: "#F3F0D7",
    normalRangeColor: "#83E3C2",
    birdsEyeRangeColor: "#B9A7F7",
  }),
  pink: Object.freeze({
    veilColor: "#582044",
    outlineColor: "#FF9DDB",
    outlineWidth: 1,
    gridColor: "#E9D7E4",
    missingColor: "#FFD166",
    currentColor: "#63E6FF",
    hoverColor: "#FFFFFF",
    normalRangeColor: "#63E6FF",
    birdsEyeRangeColor: "#FF8AD8",
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
  // Development builds before semantic grid colors stored only the three
  // walkability fields. Fill those new roles once when that exact shape loads.
  const gridColor = source.gridColor ?? DEFAULT_CARTOGRAPHY_OVERLAY_CUSTOM_STYLE.gridColor;
  const missingColor = source.missingColor ?? DEFAULT_CARTOGRAPHY_OVERLAY_CUSTOM_STYLE.missingColor;
  const currentColor = source.currentColor ?? DEFAULT_CARTOGRAPHY_OVERLAY_CUSTOM_STYLE.currentColor;
  const hoverColor = source.hoverColor ?? DEFAULT_CARTOGRAPHY_OVERLAY_CUSTOM_STYLE.hoverColor;
  const normalRangeColor = source.normalRangeColor
    ?? DEFAULT_CARTOGRAPHY_OVERLAY_CUSTOM_STYLE.normalRangeColor;
  const birdsEyeRangeColor = source.birdsEyeRangeColor
    ?? DEFAULT_CARTOGRAPHY_OVERLAY_CUSTOM_STYLE.birdsEyeRangeColor;
  if (
    !isCartographyOverlayHex(source.veilColor)
    || !isCartographyOverlayHex(source.outlineColor)
    || !isCartographyOverlayHex(gridColor)
    || !isCartographyOverlayHex(missingColor)
    || !isCartographyOverlayHex(currentColor)
    || !isCartographyOverlayHex(hoverColor)
    || !isCartographyOverlayHex(normalRangeColor)
    || !isCartographyOverlayHex(birdsEyeRangeColor)
    || typeof source.outlineWidth !== "number"
    || !Number.isSafeInteger(source.outlineWidth)
    || source.outlineWidth < CARTOGRAPHY_OVERLAY_OUTLINE_MIN
    || source.outlineWidth > CARTOGRAPHY_OVERLAY_OUTLINE_MAX
  ) return null;
  return Object.freeze({
    veilColor: source.veilColor,
    outlineColor: source.outlineColor,
    outlineWidth: source.outlineWidth,
    gridColor,
    missingColor,
    currentColor,
    hoverColor,
    normalRangeColor,
    birdsEyeRangeColor,
  });
}

export function cartographyOverlayStyle(
  style: CartographyOverlayStyleId,
  custom: CartographyOverlayStyle,
): CartographyOverlayStyle {
  return style === "custom" ? custom : CARTOGRAPHY_OVERLAY_BUILTIN_STYLES[style];
}
