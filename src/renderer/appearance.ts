/**
 * The one place a settings value becomes a look.
 *
 * Both interface styles are projections of the same component system. The
 * saved value selects a token vocabulary; it never creates parallel markup,
 * component behaviour, or gameplay state.
 *
 * Presentation only. Nothing here reaches the game: no value changes what the
 * client renders, what it sends, or what it is permitted to do.
 */
import type { AppSettings } from "../shared/contracts.js";
import {
  customThemeBuiltin,
  type UiThemeColor,
} from "../shared/ui-theme.js";

const fontChoices = new WeakMap<HTMLElement, AppSettings["uiFont"]>();
const fontLoads = new Map<string, Promise<boolean>>();
let activeGeneration = "active";
const CUSTOM_VARIABLES = [
  "--ui-custom-window",
  "--ui-custom-window-rgb",
  "--ui-custom-titlebar",
  "--ui-custom-surface",
  "--ui-custom-recessed",
  "--ui-custom-selected",
  "--ui-custom-accent",
  "--ui-custom-text",
  "--ui-custom-muted-text",
  "--ui-custom-border",
  "--ui-custom-selected-ink",
  "--ui-custom-accent-ink",
  "--ui-custom-title-fill",
] as const;

const parseRgb = (color: UiThemeColor): readonly [number, number, number] => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];

const luminance = (color: UiThemeColor): number => {
  const channels = parseRgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
};

export function contrastRatio(a: UiThemeColor, b: UiThemeColor): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

export function readableForeground(background: UiThemeColor): UiThemeColor {
  const dark = "#171613" as UiThemeColor;
  const light = "#F7F3E8" as UiThemeColor;
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

/** Find one neutral foreground that remains as readable as possible across
 * structural and recessed surfaces, including deliberately opposing colors. */
export function readableSharedForeground(
  backgrounds: readonly UiThemeColor[],
): UiThemeColor {
  let best = "#F7F3E8" as UiThemeColor;
  let bestMinimum = 0;
  for (let channel = 0; channel <= 255; channel += 1) {
    const hex = channel.toString(16).padStart(2, "0").toUpperCase();
    const candidate = `#${hex}${hex}${hex}` as UiThemeColor;
    const minimum = Math.min(...backgrounds.map((background) =>
      contrastRatio(background, candidate)));
    if (minimum > bestMinimum) {
      best = candidate;
      bestMinimum = minimum;
    }
  }
  return best;
}

function loadGuildWarsFont(generation: string): Promise<boolean> {
  const existing = fontLoads.get(generation);
  if (existing) return existing;
  if (typeof FontFace === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  const suffix = `?generation=${encodeURIComponent(generation)}`;
  const pending = Promise.all([
    new FontFace("Guild Wars Original", `url("gw://app/game-font.ttf${suffix}")`, {
      style: "normal",
      weight: "400",
    }).load(),
    new FontFace(
      "Guild Wars Original Display",
      `url("gw://app/game-font-display.ttf${suffix}")`,
      { style: "normal", weight: "400" },
    ).load(),
  ]).then((fonts) => {
    for (const font of fonts) document.fonts.add(font);
    return true;
  }).catch(() => false);
  fontLoads.set(generation, pending);
  return pending;
}

/** Load the client-derived face for game-adjacent HUD furniture even when the
 * player chose Inter for ordinary GWonMac panels. */
export const ensureGuildWarsFont = (): Promise<boolean> =>
  loadGuildWarsFont(activeGeneration);

export const appearanceVariables = (
  settings: AppSettings,
): Readonly<Record<string, string>> => {
  const variables: Record<string, string> = {
    "--ui-panel-opacity": String(settings.uiPanelOpacity / 100),
  };
  if (settings.uiStyle !== "custom") return variables;
  const theme = settings.uiCustomTheme;
  const textBackgrounds = [theme.window, theme.titlebar, theme.surface, theme.recessed];
  const safeText = Math.min(...textBackgrounds.map((background) =>
    contrastRatio(background, theme.text))) >= 4.5
    ? theme.text
    : readableSharedForeground(textBackgrounds);
  return {
    ...variables,
    "--ui-custom-window": theme.window,
    "--ui-custom-window-rgb": parseRgb(theme.window).join(" "),
    "--ui-custom-titlebar": theme.titlebar,
    "--ui-custom-surface": theme.surface,
    "--ui-custom-recessed": theme.recessed,
    "--ui-custom-selected": theme.selected,
    "--ui-custom-accent": theme.accent,
    "--ui-custom-text": safeText,
    "--ui-custom-muted-text": theme.mutedText,
    "--ui-custom-border": theme.border,
    "--ui-custom-selected-ink": readableForeground(theme.selected),
    "--ui-custom-accent-ink": readableForeground(theme.accent),
    "--ui-custom-title-fill": theme.windowGradient
      ? `linear-gradient(180deg, color-mix(in srgb, ${theme.titlebar} 92%, ${theme.border}), ${theme.titlebar} 38%, color-mix(in srgb, ${theme.titlebar} 78%, ${theme.recessed}))`
      : `linear-gradient(${theme.titlebar}, ${theme.titlebar})`,
  };
};

export function applyAppearance(
  settings: AppSettings,
  root: HTMLElement = document.documentElement,
  generation = activeGeneration,
): void {
  activeGeneration = generation;
  for (const [name, value] of Object.entries(appearanceVariables(settings))) {
    root.style.setProperty(name, value);
  }
  const customBuiltin = settings.uiStyle === "custom"
    ? customThemeBuiltin(settings.uiCustomTheme)
    : null;
  if (settings.uiStyle === "obsidian" || customBuiltin === "obsidian") {
    root.dataset.uiStyle = "obsidian";
  } else if (settings.uiStyle === "custom" && customBuiltin === null) {
    root.dataset.uiStyle = "custom";
  } else {
    delete root.dataset.uiStyle;
  }
  if (settings.uiStyle === "custom" && customBuiltin === null) {
    root.dataset.uiMaterial = settings.uiCustomTheme.material;
  }
  else delete root.dataset.uiMaterial;
  if (settings.uiStyle !== "custom") {
    for (const name of CUSTOM_VARIABLES) root.style.removeProperty(name);
  }
  if (settings.uiFont !== "guild-wars") {
    root.dataset.uiFont = settings.uiFont;
  } else {
    delete root.dataset.uiFont;
    void loadGuildWarsFont(generation).then((loaded) => {
      if (loaded && fontChoices.get(root) === "guild-wars") {
        root.dataset.uiFont = "guild-wars";
      }
    });
  }
  fontChoices.set(root, settings.uiFont);
}
