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

const fontChoices = new WeakMap<HTMLElement, AppSettings["uiFont"]>();
const fontLoads = new Map<string, Promise<boolean>>();
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
): Readonly<Record<string, string>> => ({
  "--ui-panel-opacity": String(settings.uiPanelOpacity / 100),
});

export function applyAppearance(
  settings: AppSettings,
  root: HTMLElement = document.documentElement,
  generation = activeGeneration,
): void {
  activeGeneration = generation;
  for (const [name, value] of Object.entries(appearanceVariables(settings))) {
    root.style.setProperty(name, value);
  }
  if (settings.uiStyle === "obsidian") {
    root.dataset.uiStyle = "obsidian";
  } else {
    delete root.dataset.uiStyle;
  }
  if (settings.uiFont === "inter") {
    root.dataset.uiFont = "inter";
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
