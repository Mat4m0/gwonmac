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
import path from "node:path";
import type { CLIENT_ARTIFACTS } from "./access-key.js";
import { clientGenerationPaths } from "./client-compatibility.js";

export interface GamePaths {
  userData: string;
  settings: string;
  buildLibrary: string;
  windowState: string;
  diagnostics: string;
  game: string;
  artifacts: string;
  previousArtifacts: string;
  rejectedClient: string;
  localClientVerification: string;
  certificateFeed: string;
  compatibility: string;
  enhancements: string;
  nativeDoubleClick: string;
  chunks: string;
  bootChunks: string;
  skillAssets: string;
  cacheClearRequest: string;
  gameStorageClearRequest: string;
}

export function gamePaths(userData: string): GamePaths {
  const game = path.join(userData, "game");
  const artifacts = path.join(game, "artifacts");
  return {
    userData,
    settings: path.join(userData, "settings.json"),
    buildLibrary: path.join(userData, "build-library.json"),
    windowState: path.join(userData, "window-state.json"),
    diagnostics: path.join(userData, "diagnostics"),
    game,
    artifacts,
    previousArtifacts: clientGenerationPaths(artifacts).previous,
    rejectedClient: path.join(game, "rejected-client.json"),
    localClientVerification: path.join(
      game,
      "local-client-verification.json",
    ),
    certificateFeed: path.join(game, "certificate-feed.json"),
    compatibility: path.join(game, "compatibility"),
    enhancements: path.join(game, "enhancements"),
    nativeDoubleClick: path.join(game, "double-click"),
    chunks: path.join(game, "chunks"),
    bootChunks: path.join(game, "boot-chunks.json"),
    // Icons and text decoded out of the player's own archive, under a
    // per-client-build directory so a new build starts a new cache rather than
    // serving last build's art. Discardable: deleting it costs a re-decode.
    skillAssets: path.join(game, "skill-assets"),
    cacheClearRequest: path.join(userData, "clear-cache-on-start"),
    gameStorageClearRequest: path.join(userData, "clear-game-storage-on-start"),
  };
}

/**
 * Stable document roots whose direct atomic-write temporaries need the generic
 * boot-time sweep.
 *
 * Generation staging and hashed derived-WASM entries have stronger owner
 * recovery: their publishers discard an incomplete stage/cache before reuse.
 * They are intentionally not walked recursively here. A recursive sweep would
 * need to distinguish those state machines and could delete a file while its
 * owner is validating it.
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
    paths.enhancements,
  ];
}

/**
 * Derived cache written by 2026.7.0-beta.1. Remove this after the next release;
 * its contents are never migrated because transform ABI 4 cannot consume them.
 */
export function obsoleteEnhancementCachePath(paths: GamePaths): string {
  return path.join(paths.game, "toolbox");
}

export async function discardObsoleteEnhancementCache(
  paths: GamePaths,
  remove: (
    directory: string,
    options: { recursive: true; force: true },
  ) => Promise<unknown>,
): Promise<unknown | null> {
  try {
    await remove(obsoleteEnhancementCachePath(paths), {
      recursive: true,
      force: true,
    });
    return null;
  } catch (error) {
    return error;
  }
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

/**
 * Where the application bundle keeps things, as plain values.
 *
 * Taken as an argument rather than read from `app` so the rule below can be
 * executed by a test — which is the whole point of it existing once.
 */
export interface BundleLayout {
  readonly packaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
}

/**
 * A file that must live outside `app.asar`.
 *
 * Executable code cannot be run from inside the archive: a `.node` addon cannot
 * be loaded from it and a helper cannot be spawned from it. Both are unpacked
 * by the `asar.unpack` pattern in `forge.config.ts`, and both resolve here, so
 * the packaging rule is stated once and a change that breaks it fails a test
 * rather than only a packaged build.
 */
export function unpackedPath(layout: BundleLayout, relative: string): string {
  return layout.packaged
    ? path.join(layout.resourcesPath, "app.asar.unpacked", relative)
    : path.join(layout.appPath, relative);
}
