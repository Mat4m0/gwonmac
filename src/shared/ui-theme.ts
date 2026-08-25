/** The small, durable vocabulary a player may customise. Component tokens are
 * derived from these values; they are deliberately not persisted one by one. */
export type UiThemeColor = `#${string}`;

export const UI_THEME_MATERIALS = ["classic", "modern"] as const;
export type UiThemeMaterial = (typeof UI_THEME_MATERIALS)[number];

export type CustomUiTheme = Readonly<{
  material: UiThemeMaterial;
  window: UiThemeColor;
  titlebar: UiThemeColor;
  surface: UiThemeColor;
  recessed: UiThemeColor;
  selected: UiThemeColor;
  accent: UiThemeColor;
  text: UiThemeColor;
  mutedText: UiThemeColor;
  border: UiThemeColor;
  windowGradient: boolean;
}>;

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

const THEME_FIELDS = [
  "material",
  "window",
  "titlebar",
  "surface",
  "recessed",
  "selected",
  "accent",
  "text",
  "mutedText",
  "border",
  "windowGradient",
] as const satisfies readonly (keyof CustomUiTheme)[];

/** Reset palettes render through the built-in projector. This guarantees that
 * Reset is an exact visual restore instead of an approximation maintained by
 * a second set of component tokens. The moment one field changes, the custom
 * projector takes over. */
export function customThemeBuiltin(
  theme: CustomUiTheme,
): "guild-wars" | "obsidian" | null {
  for (const material of UI_THEME_MATERIALS) {
    const builtIn = defaultCustomUiTheme(material);
    if (THEME_FIELDS.every((field) => theme[field] === builtIn[field])) {
      return material === "classic" ? "guild-wars" : "obsidian";
    }
  }
  return null;
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
    Object.keys(source).some((key) => ![
      "window",
      "material",
      "titlebar",
      "surface",
      "recessed",
      "selected",
      "accent",
      "text",
      "mutedText",
      "border",
      "windowGradient",
    ].includes(key))
    || typeof source.windowGradient !== "boolean"
    || !UI_THEME_MATERIALS.includes(source.material as UiThemeMaterial)
  ) return null;
  const window = normaliseUiThemeColor(source.window);
  const titlebar = normaliseUiThemeColor(source.titlebar);
  const surface = normaliseUiThemeColor(source.surface);
  const recessed = normaliseUiThemeColor(source.recessed);
  const selected = normaliseUiThemeColor(source.selected);
  const accent = normaliseUiThemeColor(source.accent);
  const text = normaliseUiThemeColor(source.text);
  const mutedText = normaliseUiThemeColor(source.mutedText);
  const border = normaliseUiThemeColor(source.border);
  return window && titlebar && surface && recessed && selected && accent && text && mutedText && border
    ? Object.freeze({
      material: source.material as UiThemeMaterial,
      window,
      titlebar,
      surface,
      recessed,
      selected,
      accent,
      text,
      mutedText,
      border,
      windowGradient: source.windowGradient,
    })
    : null;
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
