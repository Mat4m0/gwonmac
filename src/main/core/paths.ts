import path from "node:path";
import type { CLIENT_ARTIFACTS } from "./access-key.js";
import { clientGenerationPaths } from "./client-compatibility.js";

/**
 * Every filesystem path this application constructs, in one place.
 *
 * Two of these values are load-bearing beyond the code that reads them:
 * `chunks` holds up to ~4 GB of downloaded game data and `userData` is the
 * root of a profile that already exists on alpha machines. Relocating either
 * costs a user a re-download or a reset, so `tests/unit/paths.test.ts` pins
 * every resolved value as a literal.
 *
 * This module is deliberately Electron-free so `src/main/core/**` can share it
 * and so the pinning test can execute it. The Electron-rooted entry point is
 * `src/main/paths.ts`.
 */
export interface GamePaths {
  userData: string;
  settings: string;
  windowState: string;
  credentials: string;
  diagnostics: string;
  game: string;
  artifacts: string;
  previousArtifacts: string;
  rejectedClient: string;
  compatibility: string;
  toolbox: string;
  chunks: string;
  bootChunks: string;
  cacheClearRequest: string;
  gameStorageClearRequest: string;
}

export function gamePaths(userData: string): GamePaths {
  const game = path.join(userData, "game");
  const artifacts = path.join(game, "artifacts");
  return {
    userData,
    settings: path.join(userData, "settings.json"),
    windowState: path.join(userData, "window-state.json"),
    credentials: path.join(userData, "credentials.bin"),
    diagnostics: path.join(userData, "diagnostics"),
    game,
    artifacts,
    previousArtifacts: clientGenerationPaths(artifacts).previous,
    rejectedClient: path.join(game, "rejected-client.json"),
    compatibility: path.join(game, "compatibility"),
    toolbox: path.join(game, "toolbox"),
    chunks: path.join(game, "chunks"),
    bootChunks: path.join(game, "boot-chunks.json"),
    cacheClearRequest: path.join(userData, "clear-cache-on-start"),
    gameStorageClearRequest: path.join(userData, "clear-game-storage-on-start"),
  };
}

/**
 * Every directory this application publishes documents into through
 * `writeAtomic`, so one boot-time sweep can reach all of them.
 *
 * Derived from the path table rather than listed separately: a new owned
 * directory added to `GamePaths` and forgotten here would leak abandoned temp
 * files forever, and nothing else collects them — `pruneUnreferencedChunks`
 * deliberately ignores non-hash filenames.
 */
export function documentDirectories(paths: GamePaths): string[] {
  return [
    paths.userData,
    paths.game,
    paths.diagnostics,
    paths.chunks,
    paths.artifacts,
    paths.previousArtifacts,
    paths.compatibility,
    paths.toolbox,
  ];
}

/** The published manifest of one client generation (installed, previous or stage). */
export function clientManifestPath(generationDir: string): string {
  return path.join(generationDir, "manifest.json");
}

/** The resident-chunk index published beside a generation's artifacts. */
export function snapshotMetadataPath(generationDir: string): string {
  return path.join(generationDir, "snapshot-metadata.json");
}

/** One ArenaNet artifact inside a client generation directory. */
export function clientArtifactPath(
  generationDir: string,
  name: (typeof CLIENT_ARTIFACTS)[number],
): string {
  return path.join(generationDir, name);
}

/** The binary frame log of one diagnostics session. */
export function diagnosticFramesPath(
  diagnosticsDir: string,
  sessionId: string,
): string {
  return path.join(diagnosticsDir, `frames-${sessionId}.bin`);
}
