/**
 * The Electron-rooted entry to the path table.
 *
 * Which paths exist is decided in `./core/paths.ts`, which stays Electron-free
 * so it can be executed by a test and imported from `src/main/core/**`. This
 * module adds only what needs `app`: the per-user data root, the compiled
 * renderer directory, and the preload. Nothing here invents a path that the
 * core table does not already own.
 */
import { app } from "electron";
import path from "node:path";
import {
  colocatedStorageRoots,
  gamePaths as resolveGamePaths,
  nativeExecutableName,
  unpackedPath,
} from "./core/paths.js";
import type { GamePaths } from "./core/paths.js";
import type { ApplicationStorageRoots } from "./core/paths.js";

export type { GamePaths } from "./core/paths.js";

/** The path table rooted at Electron's per-user data directory. */
export function gamePaths(
  storage: ApplicationStorageRoots = colocatedStorageRoots(
    app.getPath("userData"),
  ),
): GamePaths {
  return resolveGamePaths(storage);
}

export function rendererRoot(): string {
  // Dev and packaged: compiled assets live under build/ next to main.
  return path.join(app.getAppPath(), "build", "renderer");
}

export function preloadPath(tools = false): string {
  // Sandboxed preload must be CommonJS (.cjs); ESM graphs are not executed.
  return path.join(
    app.getAppPath(),
    "build",
    "preload",
    tools ? "preload-tools.cjs" : "preload-core.cjs",
  );
}

export function launcherPreloadPath(): string {
  return path.join(
    app.getAppPath(),
    "build",
    "preload",
    "preload-launcher.cjs",
  );
}

/**
 * The Guild Wars archive decoder, which is spawned rather than linked.
 *
 * The packaging rule itself lives in `./core/paths.ts` beside the keychain
 * addon's, because it is the same rule and a test can execute it there.
 */
export function gwDatDecoderPath(platform = process.platform): string {
  return unpackedPath(
    {
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
    },
    `build/native/${nativeExecutableName("gw-dat-decode", platform)}`,
  );
}
