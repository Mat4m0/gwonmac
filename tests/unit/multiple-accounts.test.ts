/** The account-mode documents preserve Single and reject ambiguous profiles. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  addMultiProfile,
  archiveMultiProfile,
  createMultiWorkspace,
  loadAccountMode,
  loadMultiWorkspace,
  quarantineAccountDocument,
  removeArchivedMultiProfile,
  restoreMultiProfile,
  saveAccountMode,
  saveMultiWorkspace,
  updateMultiProfile,
} from "../../src/main/core/multiple-accounts.js";
import {
  parseMultiWorkspace,
  parseProfileId,
  profileNameKey,
} from "../../src/shared/multiple-accounts.js";
import { AppError } from "../../src/shared/errors.js";

const ID = "2d31e565-9fc8-4dde-9fd4-9d644f8283ae";

describe("Multiple Accounts documents", () => {
  it("keeps a missing mode and workspace on the legacy Single path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-accounts-"));
    assert.equal(await loadAccountMode(join(dir, "launcher-mode.json")), "single");
    assert.equal(await loadMultiWorkspace(join(dir, "workspace.json")), null);
  });

  it("publishes a workspace before an explicit Multi selection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-accounts-"));
    const workspacePath = join(dir, "multi", "workspace.json");
    const modePath = join(dir, "launcher-mode.json");
    const workspace = createMultiWorkspace({
      id: ID,
      name: "Main",
      templates: "shared",
      builds: "private",
    });
    await saveMultiWorkspace(workspacePath, workspace);
    assert.equal(await loadAccountMode(modePath), "single");
    await saveAccountMode(modePath, "multi");
    assert.equal(await loadAccountMode(modePath), "multi");
    assert.deepEqual(await loadMultiWorkspace(workspacePath), workspace);
    assert.deepEqual(JSON.parse(await readFile(modePath, "utf8")), {
      formatVersion: 1,
      mode: "multi",
    });
  });

  it("fails closed for corrupt or future documents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-accounts-"));
    const modePath = join(dir, "launcher-mode.json");
    const workspacePath = join(dir, "workspace.json");
    await writeFile(modePath, "{broken");
    await assert.rejects(loadAccountMode(modePath), AppError);
    await writeFile(modePath, JSON.stringify({ formatVersion: 2, mode: "single" }));
    await assert.rejects(loadAccountMode(modePath), AppError);
    await writeFile(workspacePath, JSON.stringify({ formatVersion: 2, profiles: [] }));
    await assert.rejects(loadMultiWorkspace(workspacePath), AppError);
  });

  it("quarantines a damaged document without rewriting its bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-accounts-"));
    const workspacePath = join(dir, "workspace.json");
    await writeFile(workspacePath, "{damaged");
    const backup = await quarantineAccountDocument(workspacePath);
    assert.ok(backup);
    assert.equal(await readFile(backup, "utf8"), "{damaged");
    assert.equal(await loadMultiWorkspace(workspacePath), null);
  });

  it("accepts only lowercase UUID v4 identifiers", () => {
    assert.equal(parseProfileId(ID), ID);
    assert.throws(() => parseProfileId("../single"), AppError);
    assert.throws(() => parseProfileId(ID.toUpperCase()), AppError);
    assert.throws(
      () => parseProfileId("2d31e565-9fc8-3dde-9fd4-9d644f8283ae"),
      AppError,
    );
  });

  it("rejects duplicate labels after normalization and case folding", () => {
    assert.equal(profileNameKey("  MAIN  "), "main");
    assert.throws(
      () => parseMultiWorkspace({
        formatVersion: 1,
        profiles: [
          { id: ID, name: "Main", archived: false, templates: "shared", builds: "shared" },
          {
            id: "6038c349-435a-4483-933f-0a792563a370",
            name: "  main ",
            archived: false,
            templates: "private",
            builds: "private",
          },
        ],
      }),
      AppError,
    );
  });

  it("requires one active profile and valid binary sharing choices", () => {
    assert.throws(
      () => parseMultiWorkspace({
        formatVersion: 1,
        profiles: [{
          id: ID,
          name: "Main",
          archived: true,
          templates: "shared",
          builds: "private",
        }],
      }),
      AppError,
    );
    assert.throws(
      () => createMultiWorkspace({
        id: ID,
        name: "Main",
        templates: "linked" as never,
        builds: "private",
      }),
      AppError,
    );
  });

  it("adds, updates, and archives profiles without changing stable IDs", () => {
    const first = createMultiWorkspace({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Primary",
      templates: "private",
      builds: "private",
    });
    const added = addMultiProfile(first, {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Storage",
      templates: "shared",
      builds: "shared",
    });
    const updated = updateMultiProfile(added, added.profiles[1]!.id, {
      name: "Storage Alt",
      templates: "private",
      builds: "shared",
    });
    const archived = archiveMultiProfile(updated, updated.profiles[1]!.id);
    assert.equal(archived.profiles[0]!.name, "Primary");
    assert.equal(archived.profiles[1]!.id, added.profiles[1]!.id);
    assert.equal(archived.profiles[1]!.name, "Storage Alt");
    assert.equal(archived.profiles[1]!.archived, true);
    const restored = restoreMultiProfile(archived, archived.profiles[1]!.id);
    assert.equal(restored.profiles[1]!.archived, false);
    const archivedAgain = archiveMultiProfile(restored, restored.profiles[1]!.id);
    const removed = removeArchivedMultiProfile(
      archivedAgain,
      archivedAgain.profiles[1]!.id,
    );
    assert.deepEqual(removed.profiles.map((profile) => profile.name), ["Primary"]);
  });
});
