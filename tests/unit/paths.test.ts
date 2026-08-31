import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientArtifactPath,
  clientManifestPath,
  colocatedStorageRoots,
  diagnosticFramesPath,
  documentDirectories,
  gamePaths,
  linuxStorageRoots,
  multiProfilePaths,
  nativeExecutableName,
  unpackedPath,
  windowsStorageRoots,
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
    assert.deepEqual(gamePaths(colocatedStorageRoots(root)), {
      storage: {
        config: root,
        data: root,
        cache: root,
        state: root,
        logs: root,
        sessions: root,
      },
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
      cartographySpike: `${root}/game/cartography-spike`,
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
    assert.deepEqual(documentDirectories(gamePaths(colocatedStorageRoots(root))), [
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
    assert.deepEqual(multiProfilePaths(gamePaths(colocatedStorageRoots(root)), id), {
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
    assert.equal(
      gamePaths(colocatedStorageRoots(root)).chunks,
      `${root}/game/chunks`,
    );
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

  it("adds an executable suffix only on Windows", () => {
    assert.equal(nativeExecutableName("gw-dat-decode", "darwin"), "gw-dat-decode");
    assert.equal(nativeExecutableName("gw-dat-decode", "linux"), "gw-dat-decode");
    assert.equal(nativeExecutableName("gw-dat-decode", "win32"), "gw-dat-decode.exe");
  });

  it("pins the diagnostics frame log name", () => {
    assert.equal(
      diagnosticFramesPath(`${root}/diagnostics`, "abc-123"),
      `${root}/diagnostics/frames-abc-123.bin`,
    );
  });

  it("resolves a staged generation without escaping the game directory", () => {
    const paths = gamePaths(colocatedStorageRoots(root));
    assert.equal(clientManifestPath(`${paths.artifacts}.next`).startsWith(
      `${paths.game}/`,
    ), true);
  });

  it("routes split storage without giving domain owners a platform", () => {
    const storage = {
      config: "/roots/config",
      data: "/roots/data",
      cache: "/roots/cache",
      state: "/roots/state",
      logs: "/roots/logs",
      sessions: "/roots/sessions",
    };
    const paths = gamePaths(storage);

    assert.equal(paths.userData, "/roots/sessions");
    assert.equal(paths.settings, "/roots/config/settings.json");
    assert.equal(paths.launcherState, "/roots/config/launcher-state.json");
    assert.equal(paths.buildLibrary, "/roots/data/build-library.json");
    assert.equal(paths.multiWorkspace, "/roots/data/multi/workspace.json");
    assert.equal(paths.travelHistory, "/roots/data/travel-history.json");
    assert.equal(paths.game, "/roots/cache/game");
    assert.equal(paths.chunks, "/roots/cache/game/chunks");
    assert.equal(paths.windowState, "/roots/state/window-state.json");
    assert.equal(paths.cacheClearRequest, "/roots/state/clear-cache-on-start");
    assert.equal(paths.diagnostics, "/roots/logs/diagnostics");
    assert.deepEqual(documentDirectories(paths), [
      "/roots/sessions",
      "/roots/config",
      "/roots/data",
      "/roots/state",
      "/roots/cache/game",
      "/roots/logs/diagnostics",
      "/roots/cache/game/chunks",
      "/roots/cache/game/artifacts",
      "/roots/cache/game/artifacts.previous",
      "/roots/cache/game/compatibility",
      "/roots/cache/game/enhancements",
    ]);
  });

  it("pins the first Windows layout beneath native LocalAppData", () => {
    assert.deepEqual(windowsStorageRoots("C:\\Users\\Player\\AppData\\Local"), {
      config: "C:\\Users\\Player\\AppData\\Local\\Guild Wars Reforged\\config",
      data: "C:\\Users\\Player\\AppData\\Local\\Guild Wars Reforged\\data",
      cache: "C:\\Users\\Player\\AppData\\Local\\Guild Wars Reforged\\cache",
      state: "C:\\Users\\Player\\AppData\\Local\\Guild Wars Reforged\\state",
      logs: "C:\\Users\\Player\\AppData\\Local\\Guild Wars Reforged\\logs",
      sessions:
        "C:\\Users\\Player\\AppData\\Local\\Guild Wars Reforged\\data\\sessions",
    });
  });

  it("pins the Flatpak layout beneath sandbox-provided XDG homes", () => {
    assert.deepEqual(linuxStorageRoots({
      config: "/var/config",
      data: "/var/data",
      cache: "/var/cache",
      state: "/var/state",
    }), {
      config: "/var/config/gwonmac",
      data: "/var/data/gwonmac",
      cache: "/var/cache/gwonmac",
      state: "/var/state/gwonmac",
      logs: "/var/state/gwonmac/logs",
      sessions: "/var/data/gwonmac/sessions",
    });
  });

  it("refuses relative Linux XDG homes", () => {
    assert.throws(() => linuxStorageRoots({
      config: "config",
      data: "/var/data",
      cache: "/var/cache",
      state: "/var/state",
    }), /Linux config home must be absolute/);
  });
});
