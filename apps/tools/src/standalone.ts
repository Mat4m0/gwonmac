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
if (params.has("trade")) {
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
