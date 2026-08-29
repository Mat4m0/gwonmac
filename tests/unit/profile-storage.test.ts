/** Every account store resolves through one closed profile-storage decision. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAdoptedProfileStorage,
  resolveProfileStorage,
} from "../../src/main/core/profile-storage.js";
import { gamePaths } from "../../src/main/core/paths.js";
import {
  LEGACY_PRIMARY_PROFILE_ID,
  parseMultiWorkspace,
  parseProfileId,
  type AccountWorkspace,
} from "../../src/shared/multiple-accounts.js";
import { AppError } from "../../src/shared/errors.js";

const PRIVATE_ID = parseProfileId("00000000-0000-4000-8000-000000000001");
const SHARED_ID = parseProfileId("00000000-0000-4000-8000-000000000002");
const root = "/profile";
const paths = gamePaths(root);
const workspace = parseMultiWorkspace({
  formatVersion: 1,
  legacyPrimaryProfileId: LEGACY_PRIMARY_PROFILE_ID,
  deletingProfileIds: [],
  profiles: [
    {
      id: PRIVATE_ID,
      name: "Private",
      archived: false,
      templates: "private",
      builds: "private",
    },
    {
      id: SHARED_ID,
      name: "Shared",
      archived: false,
      templates: "shared",
      builds: "shared",
    },
  ],
}) as AccountWorkspace;

describe("profile storage resolver", () => {
  it("adopts every released Single owner in place", () => {
    assert.deepEqual(
      resolveProfileStorage(workspace, LEGACY_PRIMARY_PROFILE_ID, paths),
      {
        kind: "legacy-primary",
        profileId: LEGACY_PRIMARY_PROFILE_ID,
        session: { kind: "default" },
        credentialsSlot: "arenaNetCredentials",
        steamSessionSlot: "steamSession",
        root: null,
        buildLibrary: `${root}/build-library.json`,
        templates: null,
        windowState: `${root}/window-state.json`,
        gameStorageClearRequest: `${root}/clear-game-storage-on-start`,
      },
    );
  });

  it("is the only place that discovers the optional released owner", () => {
    assert.equal(resolveAdoptedProfileStorage(workspace, paths)?.session.kind, "default");
    assert.equal(resolveAdoptedProfileStorage({
      ...workspace,
      legacyPrimaryProfileId: null,
    }, paths), null);
  });

  it("resolves a private profile only beneath its own identity", () => {
    assert.deepEqual(resolveProfileStorage(workspace, PRIVATE_ID, paths), {
      kind: "isolated",
      profileId: PRIVATE_ID,
      session: { kind: "partition", partition: `persist:gw-multi-${PRIVATE_ID}` },
      credentialsSlot: `multi.${PRIVATE_ID}.arenaNetCredentials`,
      steamSessionSlot: `multi.${PRIVATE_ID}.steamSession`,
      root: `${root}/multi/profiles/${PRIVATE_ID}`,
      buildLibrary: `${root}/multi/profiles/${PRIVATE_ID}/build-library.json`,
      templates: `${root}/multi/profiles/${PRIVATE_ID}/templates.json`,
      windowState: `${root}/multi/profiles/${PRIVATE_ID}/window-state.json`,
      gameStorageClearRequest:
        `${root}/multi/profiles/${PRIVATE_ID}/clear-game-storage-on-start`,
    });
  });

  it("shares only the two explicitly shared libraries", () => {
    const storage = resolveProfileStorage(workspace, SHARED_ID, paths);
    assert.equal(storage.kind, "isolated");
    assert.equal(storage.buildLibrary, `${root}/multi/shared/build-library.json`);
    assert.equal(storage.templates, `${root}/multi/shared/templates.json`);
    assert.equal(storage.windowState, `${root}/multi/profiles/${SHARED_ID}/window-state.json`);
    assert.equal(storage.credentialsSlot, `multi.${SHARED_ID}.arenaNetCredentials`);
  });

  it("refuses an unknown profile instead of deriving a path", () => {
    const unknown = parseProfileId("00000000-0000-4000-8000-000000000099");
    assert.throws(
      () => resolveProfileStorage(workspace, unknown, paths),
      AppError,
    );
  });
});
