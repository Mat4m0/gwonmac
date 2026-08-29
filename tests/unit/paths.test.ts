import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientArtifactPath,
  clientManifestPath,
  diagnosticFramesPath,
  documentDirectories,
  gamePaths,
  multiProfilePaths,
  unpackedPath,
} from "../../src/main/core/paths.ts";
import { parseProfileId } from "../../src/shared/multiple-accounts.ts";

// Every value below is a literal on purpose. A refactor may move where a path
// is *constructed*; it may not change what the path *is*. `game/chunks` holds
// up to ~4 GB of downloaded game data and the userData root already exists on
// alpha machines, so a silent relocation costs a user a re-download or a reset.
// Changing a literal here is a product decision with a migration attached, not
// a rename.
describe("resolved profile paths", () => {
  const root = "/Users/tester/Library/Application Support/Guild Wars";

  it("pins the whole profile layout as literals", () => {
    assert.deepEqual(gamePaths(root), {
      userData: root,
      settings: `${root}/settings.json`,
      diagnosticProfile: `${root}/diagnostic-profile.json`,
      travelPreferences: `${root}/travel-preferences.json`,
      travelHistory: `${root}/travel-history.json`,
      tradeSaved: `${root}/trade-saved.json`,
      buildLibrary: `${root}/build-library.json`,
      windowState: `${root}/window-state.json`,
      launcherState: `${root}/launcher-state.json`,
      launcherMode: `${root}/launcher-mode.json`,
      multiRoot: `${root}/multi`,
      multiWorkspace: `${root}/multi/workspace.json`,
      multiSingleTemplateImport: `${root}/multi/single-template-import.json`,
      multiSharedBuildLibrary: `${root}/multi/shared/build-library.json`,
      multiSharedTemplates: `${root}/multi/shared/templates.json`,
      multiProfiles: `${root}/multi/profiles`,
      diagnostics: `${root}/diagnostics`,
      game: `${root}/game`,
      artifacts: `${root}/game/artifacts`,
      previousArtifacts: `${root}/game/artifacts.previous`,
      rejectedClient: `${root}/game/rejected-client.json`,
      compatibility: `${root}/game/compatibility`,
      enhancements: `${root}/game/enhancements`,
      nativeDoubleClick: `${root}/game/double-click`,
      extendedMemory: `${root}/game/extended-memory`,
      chunks: `${root}/game/chunks`,
      skillAssets: `${root}/game/skill-assets`,
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
      // `game/skill-assets` is deliberately absent. Its writes land in a
      // per-archive subdirectory that this non-recursive sweep would not reach,
      // so `SkillAssets.prepare` collects its own orphans instead — the same
      // owner-recovery exemption the hashed derived-WASM entries take.
    ]);
  });

  it("derives profile paths only beneath the Multi namespace", () => {
    const id = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
    assert.deepEqual(multiProfilePaths(gamePaths(root), id), {
      root: `${root}/multi/profiles/${id}`,
      buildLibrary: `${root}/multi/profiles/${id}/build-library.json`,
      templates: `${root}/multi/profiles/${id}/templates.json`,
      windowState: `${root}/multi/profiles/${id}/window-state.json`,
      gameStorageClearRequest: `${root}/multi/profiles/${id}/clear-game-storage-on-start`,
    });
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

  // Both files that resolve through this must run as code, and neither can run
  // from inside app.asar. Stating the rule once means a change to it fails here
  // rather than only in a packaged build, which is the failure mode the
  // keychain path was deliberately shaped to prevent.
  it("resolves an unpacked executable in development and when packaged", () => {
    for (const relative of [
      "build/native/host.node",
      "build/native/gw-dat-decode",
    ]) {
      assert.equal(
        unpackedPath(
          { packaged: false, appPath: "/checkout", resourcesPath: "/ignored" },
          relative,
        ),
        `/checkout/${relative}`,
      );
      assert.equal(
        unpackedPath(
          {
            packaged: true,
            appPath: "/ignored",
            resourcesPath: "/App/Contents/Resources",
          },
          relative,
        ),
        `/App/Contents/Resources/app.asar.unpacked/${relative}`,
      );
    }
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
