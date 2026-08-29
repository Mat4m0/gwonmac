/** Unified-profile bootstrap preserves released data and publishes one marker. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AmbiguousAccountWorkspaceBootstrapError,
  addMultiProfile,
  bootstrapAccountWorkspace,
  createMultiWorkspace,
  loadMultiWorkspace,
  saveMultiWorkspace,
  type AccountWorkspaceBootstrapDependencies,
} from "../../src/main/core/multiple-accounts.js";
import { LEGACY_PRIMARY_PROFILE_ID } from "../../src/shared/multiple-accounts.js";
import { AppError } from "../../src/shared/errors.js";

const FRESH_ID = "00000000-0000-4000-8000-000000000001";

function dependencies(
  overrides: Partial<AccountWorkspaceBootstrapDependencies> = {},
): AccountWorkspaceBootstrapDependencies {
  return {
    loadWorkspace: loadMultiWorkspace,
    saveWorkspace: saveMultiWorkspace,
    addProfile: (workspace, options) => addMultiProfile(workspace, {
      ...options,
      id: FRESH_ID,
    }),
    ...overrides,
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "gw-workspace-bootstrap-"));
  return {
    root,
    workspace: join(root, "multi", "workspace.json"),
    launcherMode: join(root, "launcher-mode.json"),
  };
}

describe("unified account workspace bootstrap", () => {
  it("creates one isolated Main account for a fresh installation", async () => {
    const paths = await setup();
    const workspace = await bootstrapAccountWorkspace(
      paths.workspace,
      false,
      dependencies(),
    );

    assert.equal(workspace.legacyPrimaryProfileId, null);
    assert.deepEqual(workspace.profiles, [{
      id: FRESH_ID,
      name: "Main account",
      archived: false,
      templates: "private",
      builds: "private",
    }]);
  });

  it("adopts released Single stores without creating an isolated profile", async () => {
    const paths = await setup();
    const modeBytes = JSON.stringify({ formatVersion: 1, mode: "single" });
    await writeFile(paths.launcherMode, modeBytes);

    const workspace = await bootstrapAccountWorkspace(
      paths.workspace,
      true,
      dependencies(),
    );

    assert.equal(workspace.legacyPrimaryProfileId, LEGACY_PRIMARY_PROFILE_ID);
    assert.deepEqual(workspace.profiles, []);
    assert.equal(await readFile(paths.launcherMode, "utf8"), modeBytes);
  });

  it("preserves every existing profile while adding only the legacy marker", async () => {
    const paths = await setup();
    let oldWorkspace = createMultiWorkspace();
    oldWorkspace = addMultiProfile(oldWorkspace, {
      id: "00000000-0000-4000-8000-000000000010",
      name: "Storage",
      templates: "shared",
      builds: "private",
    });
    await saveMultiWorkspace(paths.workspace, oldWorkspace);

    const workspace = await bootstrapAccountWorkspace(
      paths.workspace,
      true,
      dependencies(),
    );

    assert.equal(workspace.legacyPrimaryProfileId, LEGACY_PRIMARY_PROFILE_ID);
    assert.deepEqual(workspace.profiles, oldWorkspace.profiles);
  });

  it("rebuilds an ignored marker after rollback Stable rewrites the workspace", async () => {
    const paths = await setup();
    const first = await bootstrapAccountWorkspace(
      paths.workspace,
      true,
      dependencies(),
    );
    await saveMultiWorkspace(paths.workspace, {
      formatVersion: 1,
      profiles: first.profiles,
      deletingProfileIds: first.deletingProfileIds,
    });

    const returned = await bootstrapAccountWorkspace(
      paths.workspace,
      true,
      dependencies(),
    );
    assert.equal(returned.legacyPrimaryProfileId, LEGACY_PRIMARY_PROFILE_ID);
    assert.deepEqual(returned.profiles, first.profiles);
  });

  it("does not count the adopted primary against sixteen isolated profiles", async () => {
    const paths = await setup();
    let oldWorkspace = createMultiWorkspace();
    for (let index = 1; index <= 16; index += 1) {
      oldWorkspace = addMultiProfile(oldWorkspace, {
        id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        name: `Account ${index}`,
        templates: "private",
        builds: "private",
      });
    }
    await saveMultiWorkspace(paths.workspace, oldWorkspace);

    const workspace = await bootstrapAccountWorkspace(
      paths.workspace,
      true,
      dependencies(),
    );
    assert.equal(workspace.profiles.length, 16);
    assert.equal(workspace.legacyPrimaryProfileId, LEGACY_PRIMARY_PROFILE_ID);
  });

  it("keeps the first classification on every later launch", async () => {
    const paths = await setup();
    const fresh = await bootstrapAccountWorkspace(
      paths.workspace,
      false,
      dependencies(),
    );
    const later = await bootstrapAccountWorkspace(
      paths.workspace,
      true,
      dependencies({
        saveWorkspace: async () => {
          throw new Error("an idempotent bootstrap must not write");
        },
      }),
    );

    assert.deepEqual(later, fresh);
    assert.equal(later.legacyPrimaryProfileId, null);
  });

  it("accepts a post-rename error only after reloading the exact candidate", async () => {
    const paths = await setup();
    const result = await bootstrapAccountWorkspace(
      paths.workspace,
      true,
      dependencies({
        saveWorkspace: async (path, workspace) => {
          await saveMultiWorkspace(path, workspace);
          throw new Error("directory fsync failed");
        },
      }),
    );

    assert.equal(result.legacyPrimaryProfileId, LEGACY_PRIMARY_PROFILE_ID);
    assert.deepEqual(await loadMultiWorkspace(paths.workspace), result);
  });

  it("propagates a confirmed pre-commit failure and retries cleanly", async () => {
    const paths = await setup();
    const failure = new Error("workspace publication failed");
    await assert.rejects(
      bootstrapAccountWorkspace(
        paths.workspace,
        true,
        dependencies({ saveWorkspace: async () => { throw failure; } }),
      ),
      failure,
    );
    assert.equal(await loadMultiWorkspace(paths.workspace), null);

    const retried = await bootstrapAccountWorkspace(
      paths.workspace,
      true,
      dependencies(),
    );
    assert.equal(retried.legacyPrimaryProfileId, LEGACY_PRIMARY_PROFILE_ID);
  });

  it("refuses an ambiguous commit instead of guessing", async () => {
    const paths = await setup();
    let loads = 0;
    await assert.rejects(
      bootstrapAccountWorkspace(
        paths.workspace,
        true,
        dependencies({
          saveWorkspace: async () => { throw new Error("save failed"); },
          loadWorkspace: async (path) => {
            loads += 1;
            if (loads === 1) return loadMultiWorkspace(path);
            throw new Error("reload failed");
          },
        }),
      ),
      AmbiguousAccountWorkspaceBootstrapError,
    );
  });

  it("preserves corrupt workspace bytes", async () => {
    const paths = await setup();
    await mkdir(join(paths.root, "multi"));
    await writeFile(paths.workspace, "{damaged");

    await assert.rejects(
      bootstrapAccountWorkspace(paths.workspace, true, dependencies()),
      AppError,
    );
    assert.equal(await readFile(paths.workspace, "utf8"), "{damaged");
  });

  it("rejects a reserved-id collision without changing the workspace", async () => {
    const paths = await setup();
    const collision = addMultiProfile(createMultiWorkspace(), {
      id: LEGACY_PRIMARY_PROFILE_ID,
      name: "Existing",
      templates: "private",
      builds: "private",
    });
    await saveMultiWorkspace(paths.workspace, collision);
    const before = await readFile(paths.workspace, "utf8");

    await assert.rejects(
      bootstrapAccountWorkspace(paths.workspace, true, dependencies()),
      AppError,
    );
    assert.equal(await readFile(paths.workspace, "utf8"), before);
  });
});
