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
export interface AppPaths {
  userData: string;
  settings: string;
  diagnostics: string;
  profiles: string;
  game: string;
  artifacts: string;
  previousArtifacts: string;
  rejectedClient: string;
  compatibility: string;
  enhancements: string;
  chunks: string;
  bootChunks: string;
  cacheClearRequest: string;
}

export function appPaths(userData: string): AppPaths {
  const game = path.join(userData, "game");
  const artifacts = path.join(game, "artifacts");
  return {
    userData,
    settings: path.join(userData, "settings.json"),
    diagnostics: path.join(userData, "diagnostics"),
    profiles: path.join(userData, "profiles"),
    game,
    artifacts,
    previousArtifacts: clientGenerationPaths(artifacts).previous,
    rejectedClient: path.join(game, "rejected-client.json"),
    compatibility: path.join(game, "compatibility"),
    enhancements: path.join(game, "enhancements"),
    chunks: path.join(game, "chunks"),
    bootChunks: path.join(game, "boot-chunks.json"),
    cacheClearRequest: path.join(userData, "clear-cache-on-start"),
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
export function documentDirectories(paths: AppPaths): string[] {
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
export function obsoleteEnhancementCachePath(paths: AppPaths): string {
  return path.join(paths.game, "toolbox");
}

export async function discardObsoleteEnhancementCache(
  paths: AppPaths,
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
