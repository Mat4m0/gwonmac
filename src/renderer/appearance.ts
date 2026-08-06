/**
 * The one place a settings value becomes a look.
 *
 * Theme and density are data attributes because `tokens.css` switches whole
 * palettes on them; opacity, border and radius are numbers a player chose, so
 * they arrive as the three public token overrides and nothing else. Everything
 * downstream — the launcher chrome, the Settings dialog, the Tools panel —
 * reads them through `var(--ui-…)` and needs no idea that a setting exists.
 *
 * Presentation only. Nothing here reaches the game: no value changes what the
 * client renders, what it sends, or what it is permitted to do.
 */
import type { AppSettings } from "../shared/contracts.js";

export const appearanceVariables = (
  settings: AppSettings,
): Readonly<Record<string, string>> => ({
  "--ui-panel-opacity": String(settings.uiPanelOpacity / 100),
  "--ui-border-width": `${settings.uiBorderWidth}px`,
  "--ui-radius": `${settings.uiRadius}px`,
});

export function applyAppearance(
  settings: AppSettings,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.uiTheme = settings.uiTheme;
  root.dataset.uiDensity = settings.uiDensity;
  for (const [name, value] of Object.entries(appearanceVariables(settings))) {
    root.style.setProperty(name, value);
  }
}
