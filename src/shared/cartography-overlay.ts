/**
 * Defines the player-owned appearance shared by the Compass and Mission Map.
 * Normalises presets and custom values before either renderer consumes them.
 */

export const CARTOGRAPHY_OVERLAY_STYLE_IDS = [
  "contrast",
  "soft",
  "monochrome",
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
    veilColor: "#080C10",
    outlineColor: "#E69F00",
    outlineWidth: 2,
    gridColor: "#56B4E9",
    missingColor: "#D55E00",
    currentColor: "#FFFFFF",
    hoverColor: "#F0E442",
    normalRangeColor: "#00CFFF",
    birdsEyeRangeColor: "#CC79A7",
  });

export const CARTOGRAPHY_OVERLAY_BUILTIN_STYLES = Object.freeze({
  contrast: Object.freeze({
    veilColor: "#080C10",
    outlineColor: "#E69F00",
    outlineWidth: 2,
    gridColor: "#56B4E9",
    missingColor: "#D55E00",
    currentColor: "#FFFFFF",
    hoverColor: "#F0E442",
    normalRangeColor: "#00CFFF",
    birdsEyeRangeColor: "#CC79A7",
  }),
  soft: Object.freeze({
    veilColor: "#10161A",
    outlineColor: "#FFB86B",
    outlineWidth: 1,
    gridColor: "#79C7E3",
    missingColor: "#FF6B6B",
    currentColor: "#FFFFFF",
    hoverColor: "#FFE082",
    normalRangeColor: "#65D9E8",
    birdsEyeRangeColor: "#C4A7E7",
  }),
  monochrome: Object.freeze({
    veilColor: "#080808",
    outlineColor: "#FFFFFF",
    outlineWidth: 1,
    gridColor: "#A8B0B8",
    missingColor: "#FFFFFF",
    currentColor: "#FFFFFF",
    hoverColor: "#FFFFFF",
    normalRangeColor: "#D8DDE2",
    birdsEyeRangeColor: "#8F99A3",
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
    || !isCartographyOverlayHex(source.gridColor)
    || !isCartographyOverlayHex(source.missingColor)
    || !isCartographyOverlayHex(source.currentColor)
    || !isCartographyOverlayHex(source.hoverColor)
    || !isCartographyOverlayHex(source.normalRangeColor)
    || !isCartographyOverlayHex(source.birdsEyeRangeColor)
    || typeof source.outlineWidth !== "number"
    || !Number.isSafeInteger(source.outlineWidth)
    || source.outlineWidth < CARTOGRAPHY_OVERLAY_OUTLINE_MIN
    || source.outlineWidth > CARTOGRAPHY_OVERLAY_OUTLINE_MAX
  ) return null;
  return Object.freeze({
    veilColor: source.veilColor,
    outlineColor: source.outlineColor,
    outlineWidth: source.outlineWidth,
    gridColor: source.gridColor,
    missingColor: source.missingColor,
    currentColor: source.currentColor,
    hoverColor: source.hoverColor,
    normalRangeColor: source.normalRangeColor,
    birdsEyeRangeColor: source.birdsEyeRangeColor,
  });
}

export function cartographyOverlayStyle(
  style: CartographyOverlayStyleId,
  custom: CartographyOverlayStyle,
): CartographyOverlayStyle {
  return style === "custom" ? custom : CARTOGRAPHY_OVERLAY_BUILTIN_STYLES[style];
}
