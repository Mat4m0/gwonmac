// Embedded, the renderer's own `index.html` links these; the standalone dev
// page has no renderer, so it loads them here. Importing them from `mount.ts`
// instead would bundle a second copy of the design system into the embedded
// `tools-app.css`, which is exactly the drift this system exists to prevent.
import "../../../src/shared/ui/tokens.css";
import "../../../src/shared/ui/components.css";
import { createDemoHost } from "./host";
import { mountToolsApp } from "./mount";

const target = document.getElementById("app");
if (!target) throw new Error("Tools workbench mount is missing");

mountToolsApp(target, {
  host: createDemoHost(window.localStorage),
  mode: "standalone",
  initiallyVisible: true,
});
