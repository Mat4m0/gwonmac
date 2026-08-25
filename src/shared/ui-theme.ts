/** The small, durable vocabulary a player may customise. Component tokens are
 * derived from these values; they are deliberately not persisted one by one. */
export type UiThemeColor = `#${string}`;

export type CustomUiTheme = Readonly<{
  window: UiThemeColor;
  recessed: UiThemeColor;
  selected: UiThemeColor;
  accent: UiThemeColor;
  windowGradient: boolean;
}>;

export const DEFAULT_CUSTOM_UI_THEME: CustomUiTheme = Object.freeze({
  window: "#14120F",
  recessed: "#070707",
  selected: "#26374A",
  accent: "#E6C882",
  windowGradient: true,
});

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
      "recessed",
      "selected",
      "accent",
      "windowGradient",
    ].includes(key))
    || typeof source.windowGradient !== "boolean"
  ) return null;
  const window = normaliseUiThemeColor(source.window);
  const recessed = normaliseUiThemeColor(source.recessed);
  const selected = normaliseUiThemeColor(source.selected);
  const accent = normaliseUiThemeColor(source.accent);
  return window && recessed && selected && accent
    ? Object.freeze({ window, recessed, selected, accent, windowGradient: source.windowGradient })
    : null;
}

export function encodeCustomUiTheme(theme: CustomUiTheme): string {
  const normalised = normaliseCustomUiTheme(theme);
  if (!normalised) throw new TypeError("Custom theme is invalid");
  return [
    SHARE_PREFIX,
    normalised.window,
    normalised.recessed,
    normalised.selected,
    normalised.accent,
    normalised.windowGradient ? "1" : "0",
  ].join(":");
}

export function decodeCustomUiTheme(value: string): CustomUiTheme | null {
  const [prefix, window, recessed, selected, accent, gradient, ...extra] = value.trim().split(":");
  if (prefix !== SHARE_PREFIX || extra.length > 0 || (gradient !== "0" && gradient !== "1")) {
    return null;
  }
  return normaliseCustomUiTheme({
    window,
    recessed,
    selected,
    accent,
    windowGradient: gradient === "1",
  });
}
