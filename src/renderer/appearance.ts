/**
 * The one place a settings value becomes a look.
 *
 * The product has one Guild Wars interface. Opacity is the only visual
 * preference because it changes how much of the fight remains visible behind
 * a panel without creating another theme or component geometry.
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
}
