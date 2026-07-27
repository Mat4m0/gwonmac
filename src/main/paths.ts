import { app } from "electron";
import path from "node:path";
import { gamePaths as resolveGamePaths } from "./core/paths.js";
import type { GamePaths } from "./core/paths.js";

export type { GamePaths } from "./core/paths.js";

/** The path table rooted at Electron's per-user data directory. */
export function gamePaths(userData = app.getPath("userData")): GamePaths {
  return resolveGamePaths(userData);
}

export function rendererRoot(): string {
  // Dev and packaged: compiled assets live under build/ next to main.
  return path.join(app.getAppPath(), "build", "renderer");
}

export function sharedRendererRoot(): string {
  // Renderer ESM may import the canonical browser-safe domain modules. Keep
  // that graph separate from renderer assets so the shared source stays the
  // single implementation used by main, tests, and the embedded UI.
  return path.join(app.getAppPath(), "build", "shared");
}

export function preloadPath(): string {
  // Sandboxed preload must be CommonJS (.cjs); ESM graphs are not executed.
  return path.join(app.getAppPath(), "build", "preload", "preload.cjs");
}

export function skillIconDecoderPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "gw-skill-icon-decoder")
    : path.join(app.getAppPath(), "build", "native", "gw-skill-icon-decoder");
}

export function skillNamesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "Skills.h")
    : path.join(
        app.getAppPath(),
        "src",
        "native",
        "skill-icons",
        "vendor",
        "gwca",
        "Skills.h",
      );
}
