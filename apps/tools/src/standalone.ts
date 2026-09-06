// Embedded, the renderer's own `index.html` links these; the standalone dev
// page has no renderer, so it loads them here. Importing them from `mount.ts`
// instead would bundle a second copy of the design system into the embedded
// `tools-app.css`, which is exactly the drift this system exists to prevent.
import "@fontsource-variable/inter/wght.css";
import "../../../src/shared/ui/tokens.css";
import "../../../src/shared/ui/components.css";
// The standalone-only visual fixture must exercise the renderer's real
// projector. Embedded Tools still obeys the apps -> shared dependency rule.
// eslint-disable-next-line no-restricted-imports
import { applyAppearance } from "../../../src/renderer/appearance";
import { DEFAULT_SETTINGS } from "../../../src/shared/contracts";
import type { StandaloneAppearanceFixture } from "./gw-native";
import { mountWhispers } from "./whispers-mount";
import { createWhisperSession } from "../../../src/shared/whisper-session";
import { createDemoHost } from "./host";
import { mountToolsApp } from "./mount";
import { createDemoTravelHost } from "./travel-host";
import { mountTravelPalette } from "./travel-mount";
import { createDemoTradeHost } from "./trade-host";
import { mountTradeChat } from "./trade-mount";

const target = document.getElementById("app");
if (!target) throw new Error("Tools workbench mount is missing");
document.body.dataset.toolsStandalone = "true";

// The standalone workbench is the visual-test fixture for every Tools surface.
// Keep its appearance on the same production boundary as the embedded app so a
// screenshot cannot silently exercise a hand-maintained token approximation.
window.gwApplyFixtureAppearance = (fixture: StandaloneAppearanceFixture) => {
  applyAppearance({
    ...DEFAULT_SETTINGS,
    uiStyle: fixture.uiStyle,
    uiPanelOpacity: fixture.uiPanelOpacity,
    uiFont: fixture.uiFont ?? DEFAULT_SETTINGS.uiFont,
    uiCustomTheme: fixture.uiCustomTheme ?? DEFAULT_SETTINGS.uiCustomTheme,
  });
};

const params = new URLSearchParams(window.location.search);
if (params.has("whispers")) {
  let id = 0;
  const session = createWhisperSession(async (recipient, message) => {
    session.observe([{ id: ++id, sender: recipient, message, direction: "outgoing" }]);
  });
  session.setAvailable(true);
  session.updateFriends({ status: "ready", sequence: 1, generation: 1, friends: [
    { key: "romi", character: "Romi Ranger", alias: "Romi", status: "online", mapId: 133 },
    { key: "kai", character: "Kai Storm", alias: "Kai", status: "away", mapId: 133 },
    { key: "eve", character: "Eve Mesmer", alias: "Eve", status: "do-not-disturb", mapId: 133 },
    { key: "gwon", character: "Gwon Warrior", alias: "Gwon", status: "offline", mapId: 0 },
  ] });
  mountWhispers(target, { session });
  const controls = document.createElement("div");
  controls.style.cssText = "position:fixed;bottom:8px;left:8px;display:flex;gap:8px";
  const action = (label: string, run: () => void) => {
    const button = document.createElement("button"); button.className = "ui-button";
    button.textContent = label; button.onclick = run; controls.append(button);
  };
  action("Simulate incoming", () => session.observe([{ id: ++id, sender: "Romi Ranger", message: "Ready for another mission?", direction: "incoming" }]));
  action("Simulate original chat reply", () => session.observe([{ id: ++id, sender: "Romi Ranger", message: "Yes, joining you now.", direction: "outgoing" }]));
  action("Simulate trade whisper", () => session.observe([{ id: ++id, sender: `Trader ${id}`, message: "Still selling?", direction: "incoming" }]));
  action("Simulate chat names", () => session.observe([
    { id: ++id, sender: "Moon D Eden", direction: "participant" },
    { id: ++id, sender: "Ancient N Chains", direction: "participant" },
    { id: ++id, sender: "Fureur Verte", direction: "participant" },
  ]));
  const theme = document.createElement("select");
  theme.className = "ui-select"; theme.setAttribute("aria-label", "Preview theme");
  for (const [value, label] of [["guild-wars", "Classic"], ["obsidian", "Modern"]] as const) {
    const option = document.createElement("option"); option.value = value; option.textContent = label; theme.append(option);
  }
  theme.onchange = () => window.gwApplyFixtureAppearance?.({
    uiStyle: theme.value === "obsidian" ? "obsidian" : "guild-wars", uiPanelOpacity: 94,
  });
  controls.append(theme);
  controls.style.flexWrap = "wrap";
  action("Reset session", () => { session.reset(); session.setAvailable(true); });
  document.body.append(controls);
  target.dataset.ready = "true";
} else if (params.has("trade")) {
  mountTradeChat(target, {
    host: createDemoTradeHost(),
    mode: "standalone",
    initiallyVisible: true,
  });
} else if (params.has("travel")) {
  mountTravelPalette(target, {
    host: createDemoTravelHost(),
    initiallyVisible: true,
  });
  target.dataset.ready = "true";
} else {
  mountToolsApp(target, {
    host: createDemoHost(window.localStorage),
    mode: "standalone",
    initiallyVisible: true,
  });
}
