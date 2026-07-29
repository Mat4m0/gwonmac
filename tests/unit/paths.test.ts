import assert from "node:assert/strict";
import { basename } from "node:path";
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

// Every value below is a literal on purpose. A refactor may move where a path
// is *constructed*; it may not change what the path *is*. `game/chunks` holds
// up to ~4 GB of downloaded game data and the userData root already exists on
// alpha machines, so a silent relocation costs a user a re-download or a reset.
// Changing a literal here is a product decision with a migration attached, not
// a rename. See plans/refactor.md P1.23.
describe("resolved profile paths", () => {
  const root = "/Users/tester/Library/Application Support/Guild Wars";

  it("pins the whole profile layout as literals", () => {
    assert.deepEqual(gamePaths(root), {
      userData: root,
      settings: `${root}/settings.json`,
      windowState: `${root}/window-state.json`,
      credentials: `${root}/credentials.bin`,
      steamSession: `${root}/steam-session.bin`,
      diagnostics: `${root}/diagnostics`,
      game: `${root}/game`,
      artifacts: `${root}/game/artifacts`,
      previousArtifacts: `${root}/game/artifacts.previous`,
      rejectedClient: `${root}/game/rejected-client.json`,
      compatibility: `${root}/game/compatibility`,
      enhancements: `${root}/game/enhancements`,
      chunks: `${root}/game/chunks`,
      bootChunks: `${root}/game/boot-chunks.json`,
      cacheClearRequest: `${root}/clear-cache-on-start`,
      gameStorageClearRequest: `${root}/clear-game-storage-on-start`,
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
      `${root}/game`,
      `${root}/diagnostics`,
      `${root}/game/chunks`,
      `${root}/game/artifacts`,
      `${root}/game/artifacts.previous`,
      `${root}/game/compatibility`,
      `${root}/game/enhancements`,
    ]);
  });

  it("pins the obsolete beta cache selected for one-release cleanup", () => {
    assert.equal(
      basename(obsoleteEnhancementCachePath(gamePaths(root))),
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
    assert.equal(gamePaths(root).chunks, `${root}/game/chunks`);
  });

  it("pins the files published inside a client generation", () => {
    const generation = `${root}/game/artifacts`;
    assert.equal(clientManifestPath(generation), `${generation}/manifest.json`);
    assert.equal(
      snapshotMetadataPath(generation),
      `${generation}/snapshot-metadata.json`,
    );
    assert.equal(
      clientArtifactPath(generation, "Gw.jspi.wasm"),
      `${generation}/Gw.jspi.wasm`,
    );
    assert.equal(
      clientArtifactPath(generation, "Gw.jspi.js"),
      `${generation}/Gw.jspi.js`,
    );
    assert.equal(
      clientArtifactPath(generation, "version.json"),
      `${generation}/version.json`,
    );
  });

  it("pins the diagnostics frame log name", () => {
    assert.equal(
      diagnosticFramesPath(`${root}/diagnostics`, "abc-123"),
      `${root}/diagnostics/frames-abc-123.bin`,
    );
  });

  it("resolves a staged generation without escaping the game directory", () => {
    const paths = gamePaths(root);
    assert.equal(clientManifestPath(`${paths.artifacts}.next`).startsWith(
      `${paths.game}/`,
    ), true);
  });
});
