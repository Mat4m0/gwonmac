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

export const appearanceVariables = (
  settings: AppSettings,
): Readonly<Record<string, string>> => ({
  "--ui-panel-opacity": String(settings.uiPanelOpacity / 100),
});

export function applyAppearance(
  settings: AppSettings,
  root: HTMLElement = document.documentElement,
): void {
  for (const [name, value] of Object.entries(appearanceVariables(settings))) {
    root.style.setProperty(name, value);
  }
  if (settings.uiStyle === "obsidian") {
    root.dataset.uiStyle = "obsidian";
  } else {
    delete root.dataset.uiStyle;
  }
}
