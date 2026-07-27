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
