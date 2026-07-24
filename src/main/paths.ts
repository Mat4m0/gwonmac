import { app } from "electron";
import path from "node:path";
import { clientGenerationPaths } from "./core/client-compatibility.js";

export interface GamePaths {
  userData: string;
  settings: string;
  windowState: string;
  credentials: string;
  diagnostics: string;
  game: string;
  manifest: string;
  artifacts: string;
  previousArtifacts: string;
  rejectedClient: string;
  chunks: string;
  bootChunks: string;
  cacheClearRequest: string;
}

export function gamePaths(userData = app.getPath("userData")): GamePaths {
  const game = path.join(userData, "game");
  const artifacts = path.join(game, "artifacts");
  return {
    userData,
    settings: path.join(userData, "settings.json"),
    windowState: path.join(userData, "window-state.json"),
    credentials: path.join(userData, "credentials.bin"),
    diagnostics: path.join(userData, "diagnostics"),
    game,
    manifest: path.join(game, "manifest.json"),
    artifacts,
    previousArtifacts: clientGenerationPaths(artifacts).previous,
    rejectedClient: path.join(game, "rejected-client.json"),
    chunks: path.join(game, "chunks"),
    bootChunks: path.join(game, "boot-chunks.json"),
    cacheClearRequest: path.join(userData, "clear-cache-on-start"),
  };
}

export function rendererRoot(): string {
  // Dev and packaged: compiled assets live under build/ next to main.
  return path.join(app.getAppPath(), "build", "renderer");
}

export function preloadPath(): string {
  // Sandboxed preload must be CommonJS (.cjs); ESM graphs are not executed.
  return path.join(app.getAppPath(), "build", "preload", "preload.cjs");
}
