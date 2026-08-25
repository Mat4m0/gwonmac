/** The small, durable vocabulary a player may customise. Component tokens are
 * derived from these values; they are deliberately not persisted one by one. */
export type UiThemeColor = `#${string}`;

export const UI_THEME_MATERIALS = ["classic", "modern"] as const;
export type UiThemeMaterial = (typeof UI_THEME_MATERIALS)[number];

export const UI_THEME_COLOR_FIELDS = [
  "window",
  "titlebar",
  "surface",
  "recessed",
  "selected",
  "accent",
  "text",
  "mutedText",
  "border",
] as const;
export type UiThemeColorField = (typeof UI_THEME_COLOR_FIELDS)[number];

export type CustomUiTheme = Readonly<Record<UiThemeColorField, UiThemeColor> & {
  material: UiThemeMaterial;
  windowGradient: boolean;
}>;
const UI_THEME_FIELDS = new Set<string>([
  "material",
  ...UI_THEME_COLOR_FIELDS,
  "windowGradient",
]);

const CLASSIC_CUSTOM_UI_THEME: CustomUiTheme = Object.freeze({
  material: "classic",
  window: "#0B0B0B",
  titlebar: "#292927",
  surface: "#202225",
  recessed: "#080807",
  selected: "#1B3554",
  accent: "#E6C882",
  text: "#F1EBDD",
  mutedText: "#B7B09F",
  border: "#D8D2BF",
  windowGradient: true,
});

const MODERN_CUSTOM_UI_THEME: CustomUiTheme = Object.freeze({
  material: "modern",
  window: "#1B1A18",
  titlebar: "#22211F",
  surface: "#2B2926",
  recessed: "#11100F",
  selected: "#3C3832",
  accent: "#D5B86E",
  text: "#F4EFE5",
  mutedText: "#BDB5A8",
  border: "#5F5A52",
  windowGradient: false,
});

export const DEFAULT_CUSTOM_UI_THEME = CLASSIC_CUSTOM_UI_THEME;

/** The canonical clean slate for each material language. Reset, tests, and
 * future migrations all use this rather than maintaining palette copies. */
export function defaultCustomUiTheme(material: UiThemeMaterial): CustomUiTheme {
  return material === "modern" ? MODERN_CUSTOM_UI_THEME : CLASSIC_CUSTOM_UI_THEME;
}

const COLOR = /^#[0-9a-f]{6}$/iu;
const SHARE_PREFIX = "gwonmac-theme-v1";

export function normaliseUiThemeColor(value: unknown): UiThemeColor | null {
  return typeof value === "string" && COLOR.test(value)
    ? value.toUpperCase() as UiThemeColor
    : null;
}

export function normaliseCustomUiTheme(value: unknown): CustomUiTheme | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    Object.keys(source).some((key) => !UI_THEME_FIELDS.has(key))
    || typeof source.windowGradient !== "boolean"
    || !UI_THEME_MATERIALS.includes(source.material as UiThemeMaterial)
  ) return null;
  const colors = Object.fromEntries(UI_THEME_COLOR_FIELDS.map((field) => [
    field,
    normaliseUiThemeColor(source[field]),
  ])) as Record<UiThemeColorField, UiThemeColor | null>;
  if (UI_THEME_COLOR_FIELDS.some((field) => colors[field] === null)) return null;
  return Object.freeze({
    material: source.material as UiThemeMaterial,
    ...(colors as Record<UiThemeColorField, UiThemeColor>),
    windowGradient: source.windowGradient,
  });
}

export function encodeCustomUiTheme(theme: CustomUiTheme): string {
  const normalised = normaliseCustomUiTheme(theme);
  if (!normalised) throw new TypeError("Custom theme is invalid");
  return [
    SHARE_PREFIX,
    normalised.material,
    normalised.window,
    normalised.titlebar,
    normalised.surface,
    normalised.recessed,
    normalised.selected,
    normalised.accent,
    normalised.text,
    normalised.mutedText,
    normalised.border,
    normalised.windowGradient ? "1" : "0",
  ].join(":");
}

export function decodeCustomUiTheme(value: string): CustomUiTheme | null {
  const [
    prefix,
    material,
    window,
    titlebar,
    surface,
    recessed,
    selected,
    accent,
    text,
    mutedText,
    border,
    gradient,
    ...extra
  ] = value.trim().split(":");
  if (prefix !== SHARE_PREFIX || extra.length > 0 || (gradient !== "0" && gradient !== "1")) {
    return null;
  }
  return normaliseCustomUiTheme({
    material,
    window,
    titlebar,
    surface,
    recessed,
    selected,
    accent,
    text,
    mutedText,
    border,
    windowGradient: gradient === "1",
  });
}
