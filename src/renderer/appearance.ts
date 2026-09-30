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
import { defaultCustomUiTheme, type UiThemeColor, type UiThemeMaterial } from "../shared/ui-theme.js";
import { parseRgb, compositeColor, accessibleForeground, accessibleTint, readableForeground } from "../shared/ui-color.js";

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

/* What tokens.css paints for each material where a palette role keeps its
 * default. The guard measures painted colours, not the custom-palette seeds,
 * or it would re-ink text that already reads. tests/unit/appearance.test.ts
 * pins these values to tokens.css. */
export const PAINTED_INKS = {
  classic: { window: "#080807", text: "#EBE5D3", bright: "#F5F0E2", mutedText: "#B2AC9D", faintText: "#948E7E", accent: "#E6C882" },
  modern: { window: "#0F0D0A", text: "#ECE7DF", bright: "#F8F5EE", mutedText: "#B5B0A7", faintText: "#908C84", accent: "#DBB568" },
} as const satisfies Record<UiThemeMaterial, Record<string, UiThemeColor>>;

/* The browser rounds every composited channel to 8 bits. This headroom keeps
 * guarded ink at 4.5:1 or more once it is painted. */
const TEXT_CONTRAST = 4.6;

type InkRole = "text" | "bright" | "mutedText" | "faintText" | "accent";
const INK_ROLES: readonly InkRole[] = ["text", "bright", "mutedText", "faintText", "accent"];
const INK_VARIABLES: Readonly<Record<InkRole, readonly string[]>> = {
  text: ["--ui-text"],
  bright: ["--ui-text-bright", "--ui-display-text"],
  mutedText: ["--ui-text-muted"],
  faintText: ["--ui-text-faint"],
  accent: ["--ui-accent-text"],
};

/* Reduce Transparency paints every panel opaque (tokens.css). The guard then
 * measures that opaque panel, so a change of the system setting re-applies. */
const reducedTransparency = typeof matchMedia === "function"
  ? matchMedia("(prefers-reduced-transparency: reduce)")
  : null;
const appliedSettings = new Map<HTMLElement, AppSettings>();
reducedTransparency?.addEventListener("change", () => {
  for (const [root, settings] of appliedSettings) applyAppearance(settings, root);
});

export const appearanceVariables = (
  settings: AppSettings,
  options: { readonly reducedTransparency?: boolean } = {},
): Readonly<Record<string, string>> => {
  const variables: Record<string, string> = {
    "--ui-panel-opacity": String(settings.uiPanelOpacity / 100),
  };
  const theme = settings.uiStyle === "custom"
    ? settings.uiCustomTheme
    : defaultCustomUiTheme(settings.uiStyle === "obsidian" ? "modern" : "classic");
  const baseline = defaultCustomUiTheme(theme.material);
  const painted = PAINTED_INKS[theme.material];
  const recoloured = (field: "window" | "text" | "mutedText" | "accent") =>
    theme[field] !== baseline[field];

  /* One worst-case legibility model for every text role. At low opacity the
   * game is part of the rendered background, and snow is its brightest case.
   * Text sits on the panel over that scene and over a black scene, each with
   * and without the accent hover layer, and on any opaque surface the player
   * recoloured. Reduce Transparency makes the effective opacity 1 while the
   * saved opacity stays. The Classic art strip is artwork, not a colour, so
   * tokens.css gives its copy the text ink instead. */
  const opacity = options.reducedTransparency ? 1 : settings.uiPanelOpacity / 100;
  const panelFill = recoloured("window") ? theme.window : painted.window;
  const panels = [
    compositeColor(panelFill, "#FFFFFF", opacity),
    compositeColor(panelFill, "#000000", opacity),
  ];
  const textBackgrounds = [
    ...panels,
    ...panels.map((panel) => compositeColor(painted.accent, panel, 0.1)),
    ...(["titlebar", "surface", "recessed"] as const)
      .filter((field) => theme[field] !== baseline[field])
      .map((field) => theme[field]),
  ];
  const roles: Readonly<Record<InkRole, { painted: UiThemeColor; recoloured: boolean }>> = {
    text: { painted: recoloured("text") ? theme.text : painted.text, recoloured: recoloured("text") },
    bright: { painted: recoloured("text") ? theme.text : painted.bright, recoloured: recoloured("text") },
    mutedText: { painted: recoloured("mutedText") ? theme.mutedText : painted.mutedText, recoloured: recoloured("mutedText") },
    faintText: { painted: recoloured("mutedText") ? theme.mutedText : painted.faintText, recoloured: recoloured("mutedText") },
    accent: { painted: recoloured("accent") ? theme.accent : painted.accent, recoloured: recoloured("accent") },
  };
  /* Each role moves only as far as it must, so one opacity step never re-inks
   * a whole role at once and faint stays apart from muted wherever both read.
   * The accent keeps its exact colour for fills, rails and icons; only the
   * accent used as text moves, and only in lightness, so gold stays gold. */
  const inks = {} as Record<InkRole, UiThemeColor>;
  for (const role of INK_ROLES) {
    inks[role] = (role === "accent" ? accessibleTint : accessibleForeground)(roles[role].painted, textBackgrounds, TEXT_CONTRAST);
    if (roles[role].recoloured || inks[role] !== roles[role].painted) {
      for (const name of INK_VARIABLES[role]) variables[name] = inks[role];
    }
  }
  const safeText = inks.text;
  if (settings.uiStyle !== "custom") return variables;

  if (theme.window !== baseline.window) {
    variables["--ui-panel-fill"] = `rgb(${parseRgb(theme.window).join(" ")} / var(--ui-effective-panel-opacity))`;
  }
  if (theme.titlebar !== baseline.titlebar || theme.windowGradient !== baseline.windowGradient) {
    variables["--ui-title-fill"] = theme.windowGradient
      ? `linear-gradient(180deg, color-mix(in srgb, ${theme.titlebar} 92%, ${theme.border}), ${theme.titlebar} 38%, color-mix(in srgb, ${theme.titlebar} 78%, ${theme.recessed}))`
      : `linear-gradient(${theme.titlebar}, ${theme.titlebar})`;
    if (theme.material === "classic") variables["--ui-art-head-fill"] = variables["--ui-title-fill"];
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
  appliedSettings.set(root, settings);
  const variables = appearanceVariables(settings, { reducedTransparency: reducedTransparency?.matches ?? false });
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
