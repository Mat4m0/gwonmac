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

export function preloadPath(): string {
  // Sandboxed preload must be CommonJS (.cjs); ESM graphs are not executed.
  return path.join(app.getAppPath(), "build", "preload", "preload.cjs");
}
