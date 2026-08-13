/** The account-mode documents preserve Single and reject ambiguous profiles. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createMultiWorkspace,
  loadAccountMode,
  loadMultiWorkspace,
  saveAccountMode,
  saveMultiWorkspace,
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
});
