// Embedded, the renderer's own `index.html` links these; the standalone dev
// page has no renderer, so it loads them here. Importing them from `mount.ts`
// instead would bundle a second copy of the design system into the embedded
// `tools-app.css`, which is exactly the drift this system exists to prevent.
import "@fontsource-variable/inter/wght.css";
import "../../../src/shared/ui/tokens.css";
import "../../../src/shared/ui/components.css";
import { createDemoHost } from "./host";
import { mountToolsApp } from "./mount";
import { createDemoTravelHost } from "./travel-host";
import { mountTravelPalette } from "./travel-mount";
import { createDemoTradeHost } from "./trade-host";
import { mountTradeChat } from "./trade-mount";

const target = document.getElementById("app");
if (!target) throw new Error("Tools workbench mount is missing");
document.body.dataset.toolsStandalone = "true";

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
