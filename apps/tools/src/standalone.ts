import { createDemoHost } from "./host";
import { mountToolsApp } from "./mount";

const target = document.getElementById("app");
if (!target) throw new Error("Tools workbench mount is missing");

mountToolsApp(target, {
  host: createDemoHost(window.localStorage),
  mode: "standalone",
  initiallyVisible: true,
});
