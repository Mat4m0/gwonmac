import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  clientArtifactPath,
  clientManifestPath,
  diagnosticFramesPath,
  discardObsoleteEnhancementCache,
  documentDirectories,
  gamePaths,
  obsoleteEnhancementCachePath,
  snapshotMetadataPath,
} from "../../src/main/core/paths.ts";

describe("resolved profile paths", () => {
  const root = "/Users/tester/Library/Application Support/Guild Wars";

  it("retains the existing macOS userData root for migration", () => {
    // This is the one intentionally platform-specific literal. Existing macOS
    // profiles and their multi-gigabyte chunk caches already live here.
    assert.equal(root, "/Users/tester/Library/Application Support/Guild Wars");
  });

  it("constructs the common profile layout with native separators", () => {
    assert.deepEqual(gamePaths(root), {
      userData: root,
      settings: path.join(root, "settings.json"),
      windowState: path.join(root, "window-state.json"),
      credentials: path.join(root, "credentials.bin"),
      diagnostics: path.join(root, "diagnostics"),
      game: path.join(root, "game"),
      artifacts: path.join(root, "game", "artifacts"),
      previousArtifacts: path.join(root, "game", "artifacts.previous"),
      rejectedClient: path.join(root, "game", "rejected-client.json"),
      compatibility: path.join(root, "game", "compatibility"),
      enhancements: path.join(root, "game", "enhancements"),
      chunks: path.join(root, "game", "chunks"),
      bootChunks: path.join(root, "game", "boot-chunks.json"),
      cacheClearRequest: path.join(root, "clear-cache-on-start"),
      gameStorageClearRequest: path.join(root, "clear-game-storage-on-start"),
    });
  });

  it("sweeps every directory the profile publishes documents into", () => {
    // Pinned as literals beside the layout above on purpose: adding a directory
    // to `gamePaths` already breaks that assertion, so whoever updates it lands
    // here and has to decide whether the new directory receives `writeAtomic`
    // writes. A directory left off this list leaks abandoned temp files forever
    // — nothing else collects them.
    assert.deepEqual(documentDirectories(gamePaths(root)), [
      root,
      path.join(root, "game"),
      path.join(root, "diagnostics"),
      path.join(root, "game", "chunks"),
      path.join(root, "game", "artifacts"),
      path.join(root, "game", "artifacts.previous"),
      path.join(root, "game", "compatibility"),
      path.join(root, "game", "enhancements"),
    ]);
  });

  it("pins the obsolete beta cache selected for one-release cleanup", () => {
    assert.equal(
      path.basename(obsoleteEnhancementCachePath(gamePaths(root))),
      ["tool", "box"].join(""),
    );
  });

  it("discards the obsolete cache without making cleanup failure fatal", async () => {
    const paths = gamePaths(root);
    const calls: unknown[][] = [];
    assert.equal(
      await discardObsoleteEnhancementCache(paths, async (...args) => {
        calls.push(args);
      }),
      null,
    );
    assert.deepEqual(calls, [[
      obsoleteEnhancementCachePath(paths),
      { recursive: true, force: true },
    ]]);

    const failure = new Error("injected");
    assert.equal(
      await discardObsoleteEnhancementCache(paths, async () => {
        throw failure;
      }),
      failure,
    );
  });

  it("keeps the downloaded chunk cache exactly where the alpha put it", () => {
    // Called out separately because this is the expensive one: it is the only
    // path in the table whose relocation costs a full re-download.
    assert.equal(gamePaths(root).chunks, path.join(root, "game", "chunks"));
  });

  it("pins the files published inside a client generation", () => {
    const generation = path.join(root, "game", "artifacts");
    assert.equal(clientManifestPath(generation), path.join(generation, "manifest.json"));
    assert.equal(
      snapshotMetadataPath(generation),
      path.join(generation, "snapshot-metadata.json"),
    );
    assert.equal(
      clientArtifactPath(generation, "Gw.jspi.wasm"),
      path.join(generation, "Gw.jspi.wasm"),
    );
    assert.equal(
      clientArtifactPath(generation, "Gw.jspi.js"),
      path.join(generation, "Gw.jspi.js"),
    );
    assert.equal(
      clientArtifactPath(generation, "version.json"),
      path.join(generation, "version.json"),
    );
  });

  it("pins the diagnostics frame log name", () => {
    assert.equal(
      diagnosticFramesPath(path.join(root, "diagnostics"), "abc-123"),
      path.join(root, "diagnostics", "frames-abc-123.bin"),
    );
  });

  it("resolves a staged generation without escaping the game directory", () => {
    const paths = gamePaths(root);
    assert.equal(clientManifestPath(`${paths.artifacts}.next`).startsWith(
      `${paths.game}${path.sep}`,
    ), true);
  });
});
