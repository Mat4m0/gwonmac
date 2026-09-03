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
import { defaultCustomUiTheme } from "../shared/ui-theme.js";
import { parseRgb, compositeColor, accessibleForeground, readableForeground } from "../shared/ui-color.js";

const fontChoices = new WeakMap<HTMLElement, AppSettings["uiFont"]>();
const fontLoads = new Map<string, Promise<boolean>>();
const appliedThemeVariables = new WeakMap<HTMLElement, readonly string[]>();
let activeGeneration = "active";

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
  const theme = settings.uiStyle === "custom"
    ? settings.uiCustomTheme
    : defaultCustomUiTheme(settings.uiStyle === "obsidian" ? "modern" : "classic");
  const baseline = defaultCustomUiTheme(theme.material);
  const opacity = settings.uiPanelOpacity / 100;
  const textBackgrounds = [
    compositeColor(theme.window, "#FFFFFF", opacity),
    compositeColor(theme.window, "#000000", opacity),
    theme.titlebar,
    theme.surface,
    theme.recessed,
  ];
  const safeText = accessibleForeground(theme.text, textBackgrounds);
  const safeMutedText = accessibleForeground(theme.mutedText, textBackgrounds);

  /* At low panel opacity the game is part of the rendered background. Muted
   * copy cannot stay dim over bright snow and still be readable, so the
   * projector temporarily narrows the ink range without changing the saved
   * opacity. Hierarchy still comes from type role and spacing. */
  if (safeMutedText !== theme.mutedText) {
    variables["--ui-text-muted"] = safeMutedText;
    variables["--ui-text-faint"] = safeMutedText;
  }
  if (settings.uiStyle !== "custom") return variables;

  if (theme.window !== baseline.window) {
    variables["--ui-panel-fill"] = `rgb(${parseRgb(theme.window).join(" ")} / var(--ui-effective-panel-opacity))`;
  }
  if (theme.titlebar !== baseline.titlebar || theme.windowGradient !== baseline.windowGradient) {
    variables["--ui-title-fill"] = theme.windowGradient
      ? `linear-gradient(180deg, color-mix(in srgb, ${theme.titlebar} 92%, ${theme.border}), ${theme.titlebar} 38%, color-mix(in srgb, ${theme.titlebar} 78%, ${theme.recessed}))`
      : `linear-gradient(${theme.titlebar}, ${theme.titlebar})`;
  }
  if (theme.surface !== baseline.surface) {
    const raisedFill = theme.material === "modern"
      ? `linear-gradient(${theme.surface}, ${theme.surface})`
      : `linear-gradient(color-mix(in srgb, ${theme.surface} 78%, ${theme.border}), ${theme.surface} 22%, color-mix(in srgb, ${theme.surface} 86%, ${theme.recessed}))`;
    variables["--ui-raised-fill"] = raisedFill;
    variables["--ui-command-fill"] = raisedFill;
  }
  if (theme.recessed !== baseline.recessed) {
    variables["--ui-well"] = theme.recessed;
    variables["--ui-well-fill"] = `color-mix(in srgb, ${theme.recessed} 88%, transparent)`;
    variables["--ui-pressed-layer"] = `color-mix(in srgb, ${theme.recessed} 28%, transparent)`;
    variables["--ui-focus-halo"] = theme.recessed;
    variables["--ui-scroll-track-color"] = theme.recessed;
    variables["--ui-scroll-track"] = theme.recessed;
  }
  if (theme.selected !== baseline.selected) {
    variables["--ui-selection-fill"] = `linear-gradient(color-mix(in srgb, ${theme.selected} 84%, transparent), color-mix(in srgb, ${theme.selected} 70%, ${theme.recessed}))`;
    variables["--ui-selection-hover-fill"] = `linear-gradient(color-mix(in srgb, ${theme.selected} 88%, ${safeText}), color-mix(in srgb, ${theme.selected} 82%, ${theme.recessed}))`;
    variables["--ui-selection-ink"] = readableForeground(theme.selected);
    variables["--ui-scroll-thumb-color"] = `color-mix(in srgb, ${theme.selected} 76%, ${theme.border})`;
    variables["--ui-scroll-thumb"] = "var(--ui-scroll-thumb-color)";
    variables["--ui-accent-fill"] = `linear-gradient(${theme.selected}, ${theme.selected})`;
  }
  if (theme.accent !== baseline.accent) {
    const accentInk = readableForeground(theme.accent);
    variables["--ui-accent"] = theme.accent;
    variables["--ui-accent-hover"] = `color-mix(in srgb, ${theme.accent} 82%, ${safeText})`;
    variables["--ui-accent-strong"] = `color-mix(in srgb, ${theme.accent} 70%, ${theme.window})`;
    variables["--ui-accent-ink"] = accentInk;
    variables["--ui-primary-fill"] = `linear-gradient(${theme.accent}, ${theme.accent})`;
    variables["--ui-primary-ink"] = accentInk;
    variables["--ui-focus"] = theme.accent;
    variables["--ui-selection-marker"] = theme.accent;
    variables["--ui-ring-gold"] = `linear-gradient(${theme.accent}, ${theme.accent})`;
  }
  if (theme.text !== baseline.text || safeText !== theme.text) {
    variables["--ui-text"] = safeText;
    variables["--ui-text-bright"] = safeText;
    variables["--ui-display-text"] = safeText;
  }
  if (theme.mutedText !== baseline.mutedText || safeMutedText !== theme.mutedText) {
    variables["--ui-text-muted"] = safeMutedText;
    variables["--ui-text-faint"] = safeMutedText;
  }
  if (theme.border !== baseline.border) {
    variables["--ui-control-mark"] = theme.border;
    variables["--ui-line"] = `color-mix(in srgb, ${theme.border} 62%, ${theme.window})`;
    variables["--ui-line-soft"] = `color-mix(in srgb, ${theme.border} 22%, transparent)`;
    variables["--ui-edge"] = `color-mix(in srgb, ${theme.border} 38%, transparent)`;
    variables["--ui-edge-strong"] = `color-mix(in srgb, ${theme.border} 72%, transparent)`;
    variables["--ui-edge-inner"] = `color-mix(in srgb, ${theme.border} 14%, transparent)`;
    variables["--ui-frame"] = theme.material === "modern"
      ? `linear-gradient(${theme.border}, ${theme.border})`
      : `linear-gradient(180deg, color-mix(in srgb, ${theme.border} 94%, white), ${theme.border} 48%, color-mix(in srgb, ${theme.border} 48%, black))`;
    variables["--ui-frame-top"] = theme.border;
    variables["--ui-ring-gilt"] = theme.material === "modern"
      ? `linear-gradient(${theme.border}, ${theme.border})`
      : `linear-gradient(180deg, color-mix(in srgb, ${theme.border} 82%, white), color-mix(in srgb, ${theme.border} 42%, black))`;
    variables["--ui-ring-quiet"] = "linear-gradient(var(--ui-edge), var(--ui-edge))";
    variables["--ui-ring-empty"] = "linear-gradient(var(--ui-edge), var(--ui-edge))";
    variables["--ui-ring-mark"] = "linear-gradient(var(--ui-edge-strong), var(--ui-edge-strong))";
  }
  return variables;
};

export function applyAppearance(
  settings: AppSettings,
  root: HTMLElement = document.documentElement,
  generation = activeGeneration,
): void {
  activeGeneration = generation;
  for (const name of appliedThemeVariables.get(root) ?? []) {
    root.style.removeProperty(name);
  }
  const variables = appearanceVariables(settings);
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  appliedThemeVariables.set(root, Object.keys(variables));
  if (
    settings.uiStyle === "obsidian"
    || (settings.uiStyle === "custom" && settings.uiCustomTheme.material === "modern")
  ) {
    root.dataset.uiStyle = "obsidian";
  } else {
    delete root.dataset.uiStyle;
  }
  if (settings.uiStyle === "custom") {
    root.dataset.uiMaterial = settings.uiCustomTheme.material;
  }
  else delete root.dataset.uiMaterial;
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
