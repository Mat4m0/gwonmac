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
import { defaultCustomUiTheme, type UiThemeColor } from "../shared/ui-theme.js";
import { parseRgb, compositeColor, contrastRatio, accessibleForeground, readableForeground } from "../shared/ui-color.js";

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

/* What tokens.css paints for each material where a palette role is left at
 * its default. The model must measure painted colours, not the custom-palette
 * seeds, or it re-inks text that is already readable. Faint is not a palette
 * role, so a custom muted colour stands in for it, and a custom text colour
 * also paints the bright role. */
const PAINTED = {
  classic: { window: "#080807", text: "#EBE5D3", bright: "#F5F0E2", mutedText: "#B2AC9D", faintText: "#948E7E", accent: "#E6C882" },
  modern: { window: "#0F0D0A", text: "#ECE7DF", bright: "#F8F5EE", mutedText: "#B5B0A7", faintText: "#908C84", accent: "#DBB568" },
} as const;

/* Rendering rounds every composited channel to 8 bits. A little headroom keeps
 * guarded ink at or above 4.5:1 once it is actually painted. */
const TEXT_CONTRAST = 4.6;

/* The Hub never holds the scene behind its text darker than this share of
 * full brightness. Below it, the ink guard lifts ink instead. */
const HUB_SCENE_CAP_MIN = 0.45;
const HUB_SCENE_CAP_ID = "ui-hub-scene-cap";

const grey = (level: number): UiThemeColor => {
  const channel = Math.round(level * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${channel}${channel}${channel}` as UiThemeColor;
};
const reads = (ink: UiThemeColor, backgrounds: readonly UiThemeColor[]) =>
  backgrounds.every((background) => contrastRatio(ink, background) >= TEXT_CONTRAST);

const reducedTransparency = typeof matchMedia === "function"
  ? matchMedia("(prefers-reduced-transparency: reduce)")
  : null;
const appliedSettings = new Map<HTMLElement, AppSettings>();
reducedTransparency?.addEventListener("change", () => {
  for (const [root, settings] of appliedSettings) applyAppearance(settings, root);
});

type InkRole = "text" | "bright" | "mutedText" | "faintText" | "accent";
/* Published names per role: the shared ink and the Hub-scoped ink. */
const INK_VARIABLES: Readonly<Record<InkRole, { shared: readonly string[]; hub: readonly string[] }>> = {
  text: { shared: ["--ui-text"], hub: ["--ui-hub-text"] },
  bright: { shared: ["--ui-text-bright", "--ui-display-text"], hub: ["--ui-hub-text-bright", "--ui-hub-display-text"] },
  mutedText: { shared: ["--ui-text-muted"], hub: ["--ui-hub-text-muted"] },
  faintText: { shared: ["--ui-text-faint"], hub: ["--ui-hub-text-faint"] },
  accent: { shared: ["--ui-accent-text"], hub: ["--ui-hub-accent-text"] },
};

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
  const material = PAINTED[theme.material];
  const painted = (field: "window" | "text" | "mutedText" | "accent"): UiThemeColor =>
    theme[field] !== baseline[field] ? theme[field] : material[field];
  const roles: Readonly<Record<InkRole, UiThemeColor>> = {
    text: painted("text"),
    bright: theme.text !== baseline.text ? theme.text : material.bright,
    mutedText: painted("mutedText"),
    faintText: theme.mutedText !== baseline.mutedText ? theme.mutedText : material.faintText,
    accent: painted("accent"),
  };

  /* One worst-case legibility model for every text role. Panels never dim
   * the game around them (tokens.css `--ui-scrim`), so at low opacity the
   * brightest possible scene, snow, is part of the rendered background. Reduce
   * Transparency paints the panel opaque, so the guard then uses the
   * effective opacity of 1 and keeps the designed hierarchy. The Classic art
   * strip is not modelled: its text uses the brightest ink (tokens.css). */
  const opacity = options.reducedTransparency ? 1 : settings.uiPanelOpacity / 100;
  const overScene = (scene: UiThemeColor): UiThemeColor[] => {
    const panel = compositeColor(painted("window"), scene, opacity);
    /* Hovered rows and settings rows add the accent-tinted hover layer. */
    return [panel, compositeColor(material.accent, panel, 0.1)];
  };
  const backgroundsUnder = (scene: UiThemeColor): UiThemeColor[] => [
    ...overScene(scene),
    compositeColor(painted("window"), "#000000", opacity),
    /* Opaque surfaces only move when a player recolours them. */
    ...(["titlebar", "surface", "recessed"] as const)
      .filter((field) => theme[field] !== baseline[field])
      .map((field) => theme[field]),
  ];
  const inksUnder = (scene: UiThemeColor) => {
    const backgrounds = backgroundsUnder(scene);
    return Object.fromEntries(Object.entries(roles).map(([role, color]) =>
      [role, accessibleForeground(color, backgrounds, TEXT_CONTRAST)])) as Record<InkRole, UiThemeColor>;
  };

  /* Ink alone cannot keep a hierarchy over snow at low opacity: every role
   * would have to be near white. So the Hub, whose panel is all text, holds the
   * scene's highlights back behind its fill (D-28, hub.css) just far enough
   * that text, muted and accent keep their painted ink. Darker scenes pass
   * unchanged, the game around the Hub is never dimmed, and the saved opacity
   * still decides how much scene shows through. Roles no cap can rescue are
   * left to the guard. */
  const heldRoles = [roles.text, roles.mutedText, roles.accent]
    .filter((color) => reads(color, overScene("#000000")));
  let sceneCap = 1;
  while (sceneCap > HUB_SCENE_CAP_MIN
    && !heldRoles.every((color) => reads(color, overScene(grey(sceneCap))))) {
    sceneCap = Math.max(HUB_SCENE_CAP_MIN, Math.round(sceneCap * 255 - 1) / 255);
  }
  const shared = inksUnder("#FFFFFF");
  const hub = sceneCap < 1 ? inksUnder(grey(sceneCap)) : shared;
  if (sceneCap < 1) {
    variables["--ui-hub-scene-cap"] = sceneCap.toFixed(4);
    variables["--ui-hub-backdrop"] = `url("#${HUB_SCENE_CAP_ID}")`;
  }

  /* Each role moves only as far as it must, so one opacity step never
   * re-inks a whole role at once and faint stays distinct from muted wherever
   * both are readable. A recoloured role is always published, and the bright
   * role follows text wherever the guard moves it. The accent keeps its exact
   * colour for fills, rails and icons; only its text role is re-inked. */
  const recoloured: Readonly<Record<InkRole, boolean>> = {
    text: theme.text !== baseline.text,
    bright: theme.text !== baseline.text,
    mutedText: theme.mutedText !== baseline.mutedText,
    faintText: theme.mutedText !== baseline.mutedText,
    accent: theme.accent !== baseline.accent,
  };
  for (const role of Object.keys(roles) as InkRole[]) {
    if (recoloured[role] || shared[role] !== roles[role]) {
      for (const name of INK_VARIABLES[role].shared) variables[name] = shared[role];
    }
    /* Hub ink falls back to the shared ink (tokens.css), so it is published
     * only where the scene cap lets it differ. */
    if (hub[role] !== shared[role]) {
      for (const name of INK_VARIABLES[role].hub) variables[name] = hub[role];
    }
  }
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
    variables["--ui-selection-hover-fill"] = `linear-gradient(color-mix(in srgb, ${theme.selected} 88%, ${shared.text}), color-mix(in srgb, ${theme.selected} 82%, ${theme.recessed}))`;
    variables["--ui-selection-ink"] = readableForeground(theme.selected);
    variables["--ui-scroll-thumb-color"] = `color-mix(in srgb, ${theme.selected} 76%, ${theme.border})`;
    variables["--ui-scroll-thumb"] = "var(--ui-scroll-thumb-color)";
    variables["--ui-accent-fill"] = `linear-gradient(${theme.selected}, ${theme.selected})`;
  }
  if (theme.accent !== baseline.accent) {
    const accentInk = readableForeground(theme.accent);
    variables["--ui-accent"] = theme.accent;
    variables["--ui-accent-hover"] = `color-mix(in srgb, ${theme.accent} 82%, ${shared.text})`;
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

/* The scene cap as a soft shoulder: the scene passes unchanged up to 60 % of
 * the cap, then eases toward it, so dark scenes keep every detail and only
 * highlights are held back. No output is brighter than its input or the cap. */
export const sceneCapCurve = (cap: number): readonly number[] => {
  const knee = cap * 0.6;
  return Array.from({ length: 17 }, (_, index) => {
    const scene = index / 16;
    return scene <= knee
      ? scene
      : knee + (cap - knee) * (1 - Math.exp(-(scene - knee) / (cap - knee)));
  });
};

/* `backdrop-filter` needs a filter element in the same document, which keeps
 * it inside the renderer's CSP. One per document, removed when unused. */
function writeSceneCap(root: HTMLElement, cap: string | undefined): void {
  const document = root.ownerDocument as Document | undefined;
  if (!document?.createElementNS) return;
  const existing = document.getElementById(HUB_SCENE_CAP_ID)?.closest("svg");
  if (!cap) {
    existing?.remove();
    return;
  }
  const svg = existing ?? svgElement(document, "svg", {
    "aria-hidden": "true", width: "0", height: "0", style: "position:absolute",
  });
  if (!existing) {
    const filter = svgElement(document, "filter", {
      id: HUB_SCENE_CAP_ID, "color-interpolation-filters": "sRGB",
    });
    const transfer = svgElement(document, "feComponentTransfer", {});
    for (const channel of ["feFuncR", "feFuncG", "feFuncB"]) {
      transfer.append(svgElement(document, channel, { type: "table" }));
    }
    filter.append(transfer);
    svg.append(filter);
    (document.body ?? document.documentElement).append(svg);
  }
  const table = sceneCapCurve(Number(cap)).map((value) => value.toFixed(4)).join(" ");
  for (const channel of svg.querySelectorAll("feFuncR, feFuncG, feFuncB")) {
    channel.setAttribute("tableValues", table);
  }
}

function svgElement(document: Document, name: string, attributes: Readonly<Record<string, string>>): SVGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, value);
  return element;
}

export function applyAppearance(
  settings: AppSettings,
  root: HTMLElement = document.documentElement,
  generation = activeGeneration,
): void {
  activeGeneration = generation;
  appliedSettings.set(root, settings);
  for (const name of appliedThemeVariables.get(root) ?? []) {
    root.style.removeProperty(name);
  }
  const variables = appearanceVariables(settings, {
    reducedTransparency: reducedTransparency?.matches ?? false,
  });
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  writeSceneCap(root, variables["--ui-hub-scene-cap"]);
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
