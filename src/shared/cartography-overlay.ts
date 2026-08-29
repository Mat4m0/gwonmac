/**
 * Owns the durable Cartography appearance vocabulary shared by both native maps.
 * Strict normalizers and versioned clipboard JSON protect the persistence boundary.
 */

export const CARTOGRAPHY_BUILTIN_PRESET_IDS = [
  "cartographer", "synthwave", "monochrome",
] as const;
export type CartographyBuiltinPresetId = (typeof CARTOGRAPHY_BUILTIN_PRESET_IDS)[number];

export const CARTOGRAPHY_LINE_PATTERNS = [
  "solid", "dashed", "dotted", "dash-dot",
] as const;
export type CartographyLinePattern = (typeof CARTOGRAPHY_LINE_PATTERNS)[number];

export const CARTOGRAPHY_UNSEEN_MARKERS = [
  "corners", "cross", "diamond", "stipple", "hatch",
] as const;
export type CartographyUnseenMarker = (typeof CARTOGRAPHY_UNSEEN_MARKERS)[number];
export type CartographyColor = `#${string}`;

export type CartographyLineStyle = Readonly<{
  color: CartographyColor;
  width: number;
  pattern: CartographyLinePattern;
}>;
export type CartographyWalkabilityStyle = Readonly<{
  veilColor: CartographyColor;
  boundaryColor: CartographyColor;
  boundaryWidth: number;
  boundaryCasingColor: CartographyColor;
}>;
export type CartographyGridStyle = Readonly<{
  casingColor: CartographyColor;
  lattice: CartographyLineStyle;
  unseen: Readonly<{ color: CartographyColor; marker: CartographyUnseenMarker }>;
  current: CartographyLineStyle;
  hover: CartographyLineStyle;
  normalRange: CartographyLineStyle;
  birdsEyeRange: CartographyLineStyle;
}>;
export type CartographyPresetStyle = Readonly<{
  walkability: CartographyWalkabilityStyle;
  grid: CartographyGridStyle;
}>;
export type CartographyCustomPreset = Readonly<{
  id: string;
  name: string;
  style: CartographyPresetStyle;
}>;
export type CartographyPresetRef =
  | Readonly<{ kind: "builtin"; id: CartographyBuiltinPresetId }>
  | Readonly<{ kind: "custom"; id: string }>;
export type CartographyPresetLibrary = Readonly<{
  activePreset: CartographyPresetRef;
  customPresets: readonly CartographyCustomPreset[];
}>;
export type SharedCartographyPreset = Readonly<{
  name: string;
  style: CartographyPresetStyle;
}>;

export const CARTOGRAPHY_OPACITY_MIN = 0;
export const CARTOGRAPHY_OPACITY_MAX = 100;
export const CARTOGRAPHY_CONTROL_IDLE_OPACITY_MIN = 15;
export const CARTOGRAPHY_CONTROL_IDLE_OPACITY_MAX = 100;
export const CARTOGRAPHY_LINE_WIDTH_MIN = 0;
export const CARTOGRAPHY_LINE_WIDTH_MAX = 4;
export const CARTOGRAPHY_CUSTOM_PRESET_NAME_MAX = 40;
export const CARTOGRAPHY_CUSTOM_PRESET_ID_MAX = 64;
export const CARTOGRAPHY_CUSTOM_PRESETS_MAX = 64;
export const CARTOGRAPHY_PRESET_SHARE_MAX_BYTES = 32 * 1024;

const COLOR = /^#[0-9a-f]{6}$/iu;
const CUSTOM_PRESET_ID = /^[a-z0-9][a-z0-9_-]*$/iu;
const LINE_FIELDS = new Set(["color", "width", "pattern"]);
const WALKABILITY_FIELDS = new Set([
  "veilColor", "boundaryColor", "boundaryWidth", "boundaryCasingColor",
]);
const GRID_FIELDS = new Set([
  "casingColor", "lattice", "unseen", "current", "hover", "normalRange",
  "birdsEyeRange",
]);
const UNSEEN_FIELDS = new Set(["color", "marker"]);
const STYLE_FIELDS = new Set(["walkability", "grid"]);
const CUSTOM_FIELDS = new Set(["id", "name", "style"]);
const REF_FIELDS = new Set(["kind", "id"]);
const LIBRARY_FIELDS = new Set(["activePreset", "customPresets"]);
const SHARED_FIELDS = new Set(["format", "version", "name", "style"]);
const SHARE_FORMAT = "gwonmac-cartography-preset";
const SHARE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasOnly(source: Record<string, unknown>, fields: ReadonlySet<string>): boolean {
  return Object.keys(source).every((key) => fields.has(key));
}
function normaliseColor(value: unknown): CartographyColor | null {
  return typeof value === "string" && COLOR.test(value)
    ? value.toUpperCase() as CartographyColor
    : null;
}
function normaliseWidth(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
      && value >= CARTOGRAPHY_LINE_WIDTH_MIN && value <= CARTOGRAPHY_LINE_WIDTH_MAX
    ? value
    : null;
}
function normalisePresetName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= CARTOGRAPHY_CUSTOM_PRESET_NAME_MAX ? name : null;
}
function normalisePresetId(value: unknown): string | null {
  return typeof value === "string" && value.length <= CARTOGRAPHY_CUSTOM_PRESET_ID_MAX
      && CUSTOM_PRESET_ID.test(value)
    ? value
    : null;
}

export function isCartographyBuiltinPresetId(
  value: unknown,
): value is CartographyBuiltinPresetId {
  return CARTOGRAPHY_BUILTIN_PRESET_IDS.includes(value as CartographyBuiltinPresetId);
}

export function normaliseCartographyPresetRef(value: unknown): CartographyPresetRef | null {
  if (!isRecord(value) || !hasOnly(value, REF_FIELDS)) return null;
  const { kind, id } = value;
  if (kind === "builtin" && isCartographyBuiltinPresetId(id)) {
    return Object.freeze({ kind, id });
  }
  const customId = kind === "custom" ? normalisePresetId(id) : null;
  return customId === null ? null : Object.freeze({ kind: "custom", id: customId });
}

export function normaliseCartographyLineStyle(value: unknown): CartographyLineStyle | null {
  if (!isRecord(value) || !hasOnly(value, LINE_FIELDS)) return null;
  const color = normaliseColor(value.color);
  const width = normaliseWidth(value.width);
  if (color === null || width === null
    || !CARTOGRAPHY_LINE_PATTERNS.includes(value.pattern as CartographyLinePattern)) return null;
  return Object.freeze({ color, width, pattern: value.pattern as CartographyLinePattern });
}

export function normaliseCartographyPresetStyle(value: unknown): CartographyPresetStyle | null {
  if (!isRecord(value) || !hasOnly(value, STYLE_FIELDS)
    || !isRecord(value.walkability) || !hasOnly(value.walkability, WALKABILITY_FIELDS)
    || !isRecord(value.grid) || !hasOnly(value.grid, GRID_FIELDS)
    || !isRecord(value.grid.unseen) || !hasOnly(value.grid.unseen, UNSEEN_FIELDS)) return null;
  const veilColor = normaliseColor(value.walkability.veilColor);
  const boundaryColor = normaliseColor(value.walkability.boundaryColor);
  const boundaryWidth = normaliseWidth(value.walkability.boundaryWidth);
  const boundaryCasingColor = normaliseColor(value.walkability.boundaryCasingColor);
  const lattice = normaliseCartographyLineStyle(value.grid.lattice);
  const current = normaliseCartographyLineStyle(value.grid.current);
  const hover = normaliseCartographyLineStyle(value.grid.hover);
  const normalRange = normaliseCartographyLineStyle(value.grid.normalRange);
  const birdsEyeRange = normaliseCartographyLineStyle(value.grid.birdsEyeRange);
  const casingColor = normaliseColor(value.grid.casingColor);
  const unseenColor = normaliseColor(value.grid.unseen.color);
  if (veilColor === null || boundaryColor === null || boundaryWidth === null
    || boundaryCasingColor === null || lattice === null || current === null
    || hover === null || normalRange === null || birdsEyeRange === null
    || casingColor === null || unseenColor === null
    || !CARTOGRAPHY_UNSEEN_MARKERS.includes(value.grid.unseen.marker as CartographyUnseenMarker)) {
    return null;
  }
  return Object.freeze({
    walkability: Object.freeze({
      veilColor,
      boundaryColor,
      boundaryWidth,
      boundaryCasingColor,
    }),
    grid: Object.freeze({
      casingColor,
      lattice,
      unseen: Object.freeze({
        color: unseenColor,
        marker: value.grid.unseen.marker as CartographyUnseenMarker,
      }),
      current,
      hover,
      normalRange,
      birdsEyeRange,
    }),
  });
}

function line(color: CartographyColor, width: number, pattern: CartographyLinePattern = "solid") {
  return Object.freeze({ color, width, pattern });
}
function presetStyle(value: CartographyPresetStyle): CartographyPresetStyle {
  const normalised = normaliseCartographyPresetStyle(value);
  if (!normalised) throw new TypeError("Built-in cartography preset is invalid");
  return normalised;
}

export const CARTOGRAPHY_BUILTIN_PRESETS: Readonly<Record<
  CartographyBuiltinPresetId,
  Readonly<{ name: string; style: CartographyPresetStyle }>
>> = Object.freeze({
  cartographer: Object.freeze({ name: "Cartographer", style: presetStyle({
    walkability: {
      veilColor: "#081014", boundaryColor: "#E69F00", boundaryWidth: 2,
      boundaryCasingColor: "#050709",
    },
    grid: {
      casingColor: "#050709", lattice: line("#E8E1D0", 1),
      unseen: { color: "#D55E00", marker: "corners" },
      current: line("#FFFFFF", 2), hover: line("#F0E442", 3),
      normalRange: line("#009E73", 2, "dashed"),
      birdsEyeRange: line("#CC79A7", 2, "dash-dot"),
    },
  }) }),
  synthwave: Object.freeze({ name: "Synthwave", style: presetStyle({
    walkability: {
      veilColor: "#080516", boundaryColor: "#FF4FD8", boundaryWidth: 2,
      boundaryCasingColor: "#070A12",
    },
    grid: {
      casingColor: "#070A12", lattice: line("#00E5FF", 1),
      unseen: { color: "#FFB000", marker: "cross" },
      current: line("#FFFFFF", 2), hover: line("#F9F871", 3),
      normalRange: line("#00E5FF", 2, "dashed"),
      birdsEyeRange: line("#B967FF", 2, "dash-dot"),
    },
  }) }),
  monochrome: Object.freeze({ name: "Monochrome", style: presetStyle({
    walkability: {
      veilColor: "#080A0C", boundaryColor: "#F2F4F5", boundaryWidth: 1,
      boundaryCasingColor: "#050607",
    },
    grid: {
      casingColor: "#050607", lattice: line("#A8B0B8", 1, "dotted"),
      unseen: { color: "#FFFFFF", marker: "diamond" },
      current: line("#FFFFFF", 2), hover: line("#D8DDE2", 3),
      normalRange: line("#D8DDE2", 2, "dashed"),
      birdsEyeRange: line("#8F99A3", 2, "dash-dot"),
    },
  }) }),
});

export const DEFAULT_CARTOGRAPHY_PRESET_LIBRARY: CartographyPresetLibrary = Object.freeze({
  activePreset: Object.freeze({ kind: "builtin", id: "cartographer" }),
  customPresets: Object.freeze([]),
});

export function normaliseCartographyPresetLibrary(value: unknown): CartographyPresetLibrary | null {
  if (!isRecord(value) || !hasOnly(value, LIBRARY_FIELDS)
    || !Array.isArray(value.customPresets)
    || value.customPresets.length > CARTOGRAPHY_CUSTOM_PRESETS_MAX) return null;
  const customPresets: CartographyCustomPreset[] = [];
  const ids = new Set<string>();
  const names = new Set(
    Object.values(CARTOGRAPHY_BUILTIN_PRESETS)
      .map(({ name }) => name.toLocaleLowerCase("en-US")),
  );
  for (const candidate of value.customPresets) {
    if (!isRecord(candidate) || !hasOnly(candidate, CUSTOM_FIELDS)) return null;
    const id = normalisePresetId(candidate.id);
    const name = normalisePresetName(candidate.name);
    const style = normaliseCartographyPresetStyle(candidate.style);
    if (id === null || name === null || style === null) return null;
    const nameKey = name.toLocaleLowerCase("en-US");
    if (ids.has(id) || names.has(nameKey)) {
      return null;
    }
    ids.add(id);
    names.add(nameKey);
    customPresets.push(Object.freeze({ id, name, style }));
  }
  const activePreset = normaliseCartographyPresetRef(value.activePreset);
  const activeExists = activePreset?.kind === "builtin"
    || activePreset?.kind === "custom" && ids.has(activePreset.id);
  return activePreset === null || !activeExists ? null : Object.freeze({
    activePreset,
    customPresets: Object.freeze(customPresets),
  });
}

export function encodeCartographyPreset(preset: SharedCartographyPreset): string {
  const name = normalisePresetName(preset.name);
  const style = normaliseCartographyPresetStyle(preset.style);
  if (name === null || style === null) throw new TypeError("Cartography preset is invalid");
  const encoded = JSON.stringify({ format: SHARE_FORMAT, version: SHARE_VERSION, name, style });
  if (new TextEncoder().encode(encoded).byteLength > CARTOGRAPHY_PRESET_SHARE_MAX_BYTES) {
    throw new TypeError("Cartography preset is too large");
  }
  return encoded;
}

export function decodeCartographyPreset(value: string): SharedCartographyPreset | null {
  if (value.length > CARTOGRAPHY_PRESET_SHARE_MAX_BYTES) return null;
  const encoded = value.trim();
  if (new TextEncoder().encode(encoded).byteLength > CARTOGRAPHY_PRESET_SHARE_MAX_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { return null; }
  if (!isRecord(parsed) || !hasOnly(parsed, SHARED_FIELDS)
    || parsed.format !== SHARE_FORMAT || parsed.version !== SHARE_VERSION) return null;
  const name = normalisePresetName(parsed.name);
  const style = normaliseCartographyPresetStyle(parsed.style);
  return name === null || style === null ? null : Object.freeze({ name, style });
}
