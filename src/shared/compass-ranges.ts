/**
 * Owns the standard Compass ranges and their durable setting keys.
 * Launcher settings and the in-game control share this one definition.
 */
export const COMPASS_RANGE_OPACITY_MIN = 0;
export const COMPASS_RANGE_OPACITY_MAX = 100;
export const DEFAULT_COMPASS_RANGE_OPACITY = 95;
export const COMPASS_RANGE_THEMES = ["color", "monochrome"] as const;
export type CompassRangeTheme = (typeof COMPASS_RANGE_THEMES)[number];

export const COMPASS_RANGE_INDICATORS = Object.freeze([
  Object.freeze({
    id: "earshot",
    label: "Shout",
    units: 1_012,
    color: "#E69F00",
    enabledSetting: "compassRangeEarshotEnabled",
    opacitySetting: "compassRangeEarshotOpacity",
  }),
  Object.freeze({
    id: "cast",
    label: "Cast",
    units: 1_248,
    color: "#56B4E9",
    enabledSetting: "compassRangeCastEnabled",
    opacitySetting: "compassRangeCastOpacity",
  }),
  Object.freeze({
    id: "spirit",
    label: "Spirit",
    units: 2_512,
    color: "#009E73",
    enabledSetting: "compassRangeSpiritEnabled",
    opacitySetting: "compassRangeSpiritOpacity",
  }),
  Object.freeze({
    id: "spirit-extended",
    label: "Ext. Spirit",
    units: 3_500,
    color: "#CC79A7",
    enabledSetting: "compassRangeSpiritExtendedEnabled",
    opacitySetting: "compassRangeSpiritExtendedOpacity",
  }),
] as const);

export type CompassRange = (typeof COMPASS_RANGE_INDICATORS)[number];
export type CompassRangeId = CompassRange["id"];

export function compassRangeColor(range: CompassRange, theme: CompassRangeTheme): string {
  return theme === "monochrome" ? "#F2F2F0" : range.color;
}
