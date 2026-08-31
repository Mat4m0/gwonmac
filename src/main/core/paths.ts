/**
 * Every writable application path, rooted by its durability responsibility.
 *
 * Two of these values are load-bearing beyond the code that reads them:
 * `chunks` holds up to ~4 GB of downloaded game data and `userData` is the
 * root of a profile that already exists on alpha machines. Relocating either
 * costs a user a re-download or a reset, so `tests/unit/paths.test.ts` pins
 * every resolved value as a literal.
 *
 * macOS deliberately gives every responsibility the released `userData` root.
 * Other platforms can provide distinct roots without teaching settings, game
 * content, diagnostics, or profile owners about an operating system.
 *
 * This module is deliberately Electron-free so `src/main/core/**` can share it
 * and so the pinning test can execute it. The Electron-rooted entry point is
 * `src/main/paths.ts`.
 */
import path from "node:path";
import type { CLIENT_ARTIFACTS } from "./access-key.js";
import type { ProfileId } from "../../shared/multiple-accounts.js";
import { clientGenerationPaths } from "./client-compatibility.js";

export interface GamePaths {
  readonly storage: ApplicationStorageRoots;
  userData: string;
  settings: string;
  diagnosticProfile: string;
  travelPreferences: string;
  travelHistory: string;
  tradeSaved: string;
  buildLibrary: string;
  windowState: string;
  launcherState: string;
  launcherMode: string;
  multiRoot: string;
  multiWorkspace: string;
  multiSingleTemplateImport: string;
  multiSharedBuildLibrary: string;
  multiSharedTemplates: string;
  multiProfiles: string;
  diagnostics: string;
  game: string;
  artifacts: string;
  previousArtifacts: string;
  rejectedClient: string;
  compatibility: string;
  enhancements: string;
  cartographySpike: string;
  nativeDoubleClick: string;
  extendedMemory: string;
  chunks: string;
  skillAssets: string;
  cacheClearRequest: string;
  gameStorageClearRequest: string;
}

export interface ApplicationStorageRoots {
  /** Settings and other player-selected application configuration. */
  readonly config: string;
  /** Durable player-authored data and the canonical profile registry. */
  readonly data: string;
  /** Verified or derived content that the application can reacquire. */
  readonly cache: string;
  /** Restart state, window state, and recovery markers. */
  readonly state: string;
  /** Diagnostics and bounded local logs. */
  readonly logs: string;
  /** Electron browser/session data, isolated from the global game cache. */
  readonly sessions: string;
}

/** Preserve a released installation whose stores already share one root. */
export function colocatedStorageRoots(root: string): ApplicationStorageRoots {
  return {
    config: root,
    data: root,
    cache: root,
    state: root,
    logs: root,
    sessions: root,
  };
}

export function gamePaths(storage: ApplicationStorageRoots): GamePaths {
  const game = path.join(storage.cache, "game");
  const artifacts = path.join(game, "artifacts");
  const multiRoot = path.join(storage.data, "multi");
  return {
    storage,
    userData: storage.sessions,
    settings: path.join(storage.config, "settings.json"),
    diagnosticProfile: path.join(storage.config, "diagnostic-profile.json"),
    travelPreferences: path.join(storage.config, "travel-preferences.json"),
    travelHistory: path.join(storage.data, "travel-history.json"),
    tradeSaved: path.join(storage.data, "trade-saved.json"),
    buildLibrary: path.join(storage.data, "build-library.json"),
    windowState: path.join(storage.state, "window-state.json"),
    launcherState: path.join(storage.config, "launcher-state.json"),
    launcherMode: path.join(storage.config, "launcher-mode.json"),
    multiRoot,
    multiWorkspace: path.join(multiRoot, "workspace.json"),
    multiSingleTemplateImport: path.join(multiRoot, "single-template-import.json"),
    multiSharedBuildLibrary: path.join(multiRoot, "shared", "build-library.json"),
    multiSharedTemplates: path.join(multiRoot, "shared", "templates.json"),
    multiProfiles: path.join(multiRoot, "profiles"),
    diagnostics: path.join(storage.logs, "diagnostics"),
    game,
    artifacts,
    previousArtifacts: clientGenerationPaths(artifacts).previous,
    rejectedClient: path.join(game, "rejected-client.json"),
    compatibility: path.join(game, "compatibility"),
    enhancements: path.join(game, "enhancements"),
    cartographySpike: path.join(game, "cartography-spike"),
    nativeDoubleClick: path.join(game, "double-click"),
    extendedMemory: path.join(game, "extended-memory"),
    chunks: path.join(game, "chunks"),
    // Icons and text decoded out of the player's own archive, under a
    // per-client-build directory so a new build starts a new cache rather than
    // serving last build's art. Discardable: deleting it costs a re-decode.
    skillAssets: path.join(game, "skill-assets"),
    cacheClearRequest: path.join(storage.state, "clear-cache-on-start"),
    gameStorageClearRequest: path.join(storage.state, "clear-game-storage-on-start"),
  };
}

export interface MultiProfilePaths {
  readonly root: string;
  readonly buildLibrary: string;
  readonly templates: string;
  readonly windowState: string;
  readonly gameStorageClearRequest: string;
}

/** Resolve stores only after `parseProfileId` has made traversal impossible. */
export function multiProfilePaths(
  paths: GamePaths,
  profileId: ProfileId,
): MultiProfilePaths {
  const root = path.join(paths.multiProfiles, profileId);
  return {
    root,
    buildLibrary: path.join(root, "build-library.json"),
    templates: path.join(root, "templates.json"),
    windowState: path.join(root, "window-state.json"),
    gameStorageClearRequest: path.join(root, "clear-game-storage-on-start"),
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
  return [...new Set([
    paths.storage.sessions,
    paths.storage.config,
    paths.storage.data,
    paths.storage.state,
    paths.game,
    paths.diagnostics,
    paths.chunks,
    paths.artifacts,
    paths.previousArtifacts,
    paths.compatibility,
    paths.enhancements,
  ])];
}

/** The published manifest of one client generation (installed, previous or stage). */
export function clientManifestPath(generationDir: string): string {
  return path.join(generationDir, "manifest.json");
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
