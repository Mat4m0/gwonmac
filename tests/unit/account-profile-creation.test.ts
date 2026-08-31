import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createAccountProfile,
  nodeAccountProfileCreationDependencies,
  type AccountProfileCreationDependencies,
} from "../../src/main/core/account-profile-creation.js";
import { AtomicExclusiveWriteError } from "../../src/main/core/atomic-file.js";
import {
  addMultiProfile,
  createMultiWorkspace,
  loadMultiWorkspace,
  saveMultiWorkspace,
} from "../../src/main/core/multiple-accounts.js";
import {
  colocatedStorageRoots,
  gamePaths,
  multiProfilePaths,
} from "../../src/main/core/paths.js";
import { EMPTY_LIBRARY } from "../../src/shared/builds/parse-library.js";
import { parseProfileId } from "../../src/shared/multiple-accounts.js";

const PROFILE_ID = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");

const deterministicDependencies: AccountProfileCreationDependencies = {
  ...nodeAccountProfileCreationDependencies,
  addProfile: (workspace, request) => addMultiProfile(workspace, {
    ...request,
    id: PROFILE_ID,
  }),
};

async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "gw-account-create-"));
  const paths = gamePaths(colocatedStorageRoots(root));
  const workspace = createMultiWorkspace();
  await saveMultiWorkspace(paths.multiWorkspace, workspace);
  await writeFile(paths.buildLibrary, JSON.stringify(EMPTY_LIBRARY));
  await mkdir(join(paths.multiRoot), { recursive: true });
  await writeFile(paths.multiSingleTemplateImport, JSON.stringify({
    formatVersion: 1,
    revision: 1,
    entries: [{ path: "Main/Build.txt", contents: "OQAA" }],
  }));
  const request = {
    name: "Main",
    builds: "shared" as const,
    templates: "shared" as const,
    copySingleBuilds: true,
    copySingleTemplates: true,
  };
  return { paths, request, root, workspace };
}

describe("Multiple Accounts profile creation", () => {
  it("validates every Single Account source before creating destinations", async () => {
    const test = await setup();
    await writeFile(test.paths.multiSingleTemplateImport, "{broken");

    await assert.rejects(
      createAccountProfile(
        test.workspace,
        test.request,
        test.paths,
        deterministicDependencies,
      ),
    );

    const profile = multiProfilePaths(test.paths, PROFILE_ID);
    assert.equal(await absent(profile.root), true);
    assert.equal(await absent(test.paths.multiSharedBuildLibrary), true);
    assert.deepEqual(await loadMultiWorkspace(test.paths.multiWorkspace), test.workspace);
    assert.deepEqual(JSON.parse(await readFile(test.paths.buildLibrary, "utf8")), EMPTY_LIBRARY);
  });

  it("rolls back both imported libraries when workspace publication fails", async () => {
    const test = await setup();
    const workspaceBytes = await readFile(test.paths.multiWorkspace, "utf8");
    const buildSourceBytes = await readFile(test.paths.buildLibrary, "utf8");
    const templateSourceBytes = await readFile(
      test.paths.multiSingleTemplateImport,
      "utf8",
    );
    const failure = new Error("workspace publication failed");
    const dependencies: AccountProfileCreationDependencies = {
      ...deterministicDependencies,
      saveWorkspace: async () => { throw failure; },
    };

    await assert.rejects(
      createAccountProfile(test.workspace, test.request, test.paths, dependencies),
      failure,
    );

    const profile = multiProfilePaths(test.paths, PROFILE_ID);
    assert.equal(await absent(profile.root), true);
    assert.equal(await absent(test.paths.multiSharedBuildLibrary), true);
    assert.equal(await absent(test.paths.multiSharedTemplates), true);
    assert.deepEqual(await loadMultiWorkspace(test.paths.multiWorkspace), test.workspace);
    assert.equal(await readFile(test.paths.multiWorkspace, "utf8"), workspaceBytes);
    assert.equal(await readFile(test.paths.buildLibrary, "utf8"), buildSourceBytes);
    assert.equal(
      await readFile(test.paths.multiSingleTemplateImport, "utf8"),
      templateSourceBytes,
    );
  });

  it("rolls back after each library publication boundary", async () => {
    const buildFailure = await setup();
    await assert.rejects(
      createAccountProfile(
        buildFailure.workspace,
        buildFailure.request,
        buildFailure.paths,
        {
          ...deterministicDependencies,
          saveBuilds: async () => { throw new Error("build failed"); },
        },
      ),
      /build failed/u,
    );
    assert.equal(
      await absent(multiProfilePaths(buildFailure.paths, PROFILE_ID).root),
      true,
    );

    const templateFailure = await setup();
    await assert.rejects(
      createAccountProfile(
        templateFailure.workspace,
        templateFailure.request,
        templateFailure.paths,
        {
          ...deterministicDependencies,
          saveTemplates: async () => { throw new Error("template failed"); },
        },
      ),
      /template failed/u,
    );
    assert.equal(await absent(templateFailure.paths.multiSharedBuildLibrary), true);
    assert.equal(
      await absent(multiProfilePaths(templateFailure.paths, PROFILE_ID).root),
      true,
    );

    const publishedTemplateFailure = await setup();
    await assert.rejects(
      createAccountProfile(
        publishedTemplateFailure.workspace,
        publishedTemplateFailure.request,
        publishedTemplateFailure.paths,
        {
          ...deterministicDependencies,
          saveTemplates: async (path, library) => {
            await nodeAccountProfileCreationDependencies.saveTemplates(path, library);
            throw new AtomicExclusiveWriteError(true, {
              cause: new Error("directory fsync failed"),
            });
          },
        },
      ),
      AtomicExclusiveWriteError,
    );
    assert.equal(
      await absent(publishedTemplateFailure.paths.multiSharedTemplates),
      true,
    );
    assert.equal(
      await absent(publishedTemplateFailure.paths.multiSharedBuildLibrary),
      true,
    );
  });

  it("refuses a requested destination without changing its existing bytes", async () => {
    const test = await setup();
    await mkdir(join(test.paths.multiRoot, "shared"), { recursive: true });
    await writeFile(test.paths.multiSharedBuildLibrary, "player recovery data");

    await assert.rejects(
      createAccountProfile(
        test.workspace,
        test.request,
        test.paths,
        deterministicDependencies,
      ),
      /refused existing Multiple Accounts data/u,
    );

    assert.equal(
      await readFile(test.paths.multiSharedBuildLibrary, "utf8"),
      "player recovery data",
    );
    assert.equal(await absent(test.paths.multiSharedTemplates), true);
    assert.equal(
      await absent(multiProfilePaths(test.paths, PROFILE_ID).root),
      true,
    );
  });

  it("refuses pre-existing profile roots and template destinations", async () => {
    const rootCollision = await setup();
    const profileRoot = multiProfilePaths(rootCollision.paths, PROFILE_ID).root;
    await mkdir(profileRoot, { recursive: true });
    await writeFile(join(profileRoot, "recovered.txt"), "keep me");
    await assert.rejects(
      createAccountProfile(
        rootCollision.workspace,
        rootCollision.request,
        rootCollision.paths,
        deterministicDependencies,
      ),
      /refused existing Multiple Accounts data/u,
    );
    assert.equal(await readFile(join(profileRoot, "recovered.txt"), "utf8"), "keep me");

    const templateCollision = await setup();
    await mkdir(join(templateCollision.paths.multiRoot, "shared"), {
      recursive: true,
    });
    await writeFile(templateCollision.paths.multiSharedTemplates, "template recovery");
    await assert.rejects(
      createAccountProfile(
        templateCollision.workspace,
        { ...templateCollision.request, copySingleBuilds: false },
        templateCollision.paths,
        deterministicDependencies,
      ),
      /refused existing Multiple Accounts data/u,
    );
    assert.equal(
      await readFile(templateCollision.paths.multiSharedTemplates, "utf8"),
      "template recovery",
    );

    const symlinkCollision = await setup();
    const symlinkRoot = multiProfilePaths(symlinkCollision.paths, PROFILE_ID).root;
    const recoveryRoot = join(symlinkCollision.root, "recovered-profile");
    await mkdir(join(symlinkCollision.paths.multiProfiles), { recursive: true });
    await mkdir(recoveryRoot);
    await writeFile(join(recoveryRoot, "kept.txt"), "symlink data");
    await symlink(recoveryRoot, symlinkRoot, "dir");
    await assert.rejects(
      createAccountProfile(
        symlinkCollision.workspace,
        symlinkCollision.request,
        symlinkCollision.paths,
        deterministicDependencies,
      ),
      /refused existing Multiple Accounts data/u,
    );
    assert.equal(await readFile(join(recoveryRoot, "kept.txt"), "utf8"), "symlink data");
  });

  it("loses a publication race without replacing the competing file", async () => {
    const test = await setup();
    const sentinel = "created by another owner";
    const dependencies: AccountProfileCreationDependencies = {
      ...deterministicDependencies,
      saveBuilds: async (path, library) => {
        await mkdir(join(test.paths.multiRoot, "shared"), { recursive: true });
        await writeFile(path, sentinel);
        return await nodeAccountProfileCreationDependencies.saveBuilds(path, library);
      },
    };

    await assert.rejects(
      createAccountProfile(test.workspace, test.request, test.paths, dependencies),
      (error) => error instanceof AtomicExclusiveWriteError && !error.published,
    );
    assert.equal(await readFile(test.paths.multiSharedBuildLibrary, "utf8"), sentinel);
    assert.equal(
      await absent(multiProfilePaths(test.paths, PROFILE_ID).root),
      true,
    );
  });

  it("treats a workspace rename followed by an error as committed", async () => {
    const test = await setup();
    const dependencies: AccountProfileCreationDependencies = {
      ...deterministicDependencies,
      saveWorkspace: async (path, workspace) => {
        await saveMultiWorkspace(path, workspace);
        throw new Error("directory fsync failed");
      },
    };

    const committed = await createAccountProfile(
      test.workspace,
      test.request,
      test.paths,
      dependencies,
    );

    assert.deepEqual(await loadMultiWorkspace(test.paths.multiWorkspace), committed);
    assert.equal(await absent(test.paths.multiSharedBuildLibrary), false);
    assert.equal(await absent(test.paths.multiSharedTemplates), false);
  });

  it("removes a later account root when its workspace write fails", async () => {
    const test = await setup();
    const existing = addMultiProfile(test.workspace, {
      id: "6038c349-435a-4483-933f-0a792563a370",
      name: "Existing",
      builds: "private",
      templates: "private",
    });
    await saveMultiWorkspace(test.paths.multiWorkspace, existing);
    const dependencies: AccountProfileCreationDependencies = {
      ...deterministicDependencies,
      saveWorkspace: async () => { throw new Error("workspace failed"); },
    };

    await assert.rejects(
      createAccountProfile(
        existing,
        {
          ...test.request,
          copySingleBuilds: false,
          copySingleTemplates: false,
        },
        test.paths,
        dependencies,
      ),
      /workspace failed/u,
    );
    assert.equal(
      await absent(multiProfilePaths(test.paths, PROFILE_ID).root),
      true,
    );
    assert.deepEqual(await loadMultiWorkspace(test.paths.multiWorkspace), existing);
  });

  it("preserves created resources when the workspace commit is ambiguous", async () => {
    const test = await setup();
    const dependencies: AccountProfileCreationDependencies = {
      ...deterministicDependencies,
      saveWorkspace: async () => { throw new Error("save failed"); },
      loadWorkspace: async () => { throw new Error("reload failed"); },
    };

    await assert.rejects(
      createAccountProfile(test.workspace, test.request, test.paths, dependencies),
      /commit is unclear; restart before retrying/u,
    );

    assert.equal(await absent(test.paths.multiSharedBuildLibrary), false);
    assert.equal(await absent(test.paths.multiSharedTemplates), false);
    assert.equal(
      await absent(multiProfilePaths(test.paths, PROFILE_ID).root),
      false,
    );
  });

  it("continues reverse cleanup and keeps the primary failure", async () => {
    const test = await setup();
    const removed: string[] = [];
    const primary = new Error("workspace failed");
    const dependencies: AccountProfileCreationDependencies = {
      ...deterministicDependencies,
      saveWorkspace: async () => { throw primary; },
      remove: async (path, recursive) => {
        removed.push(path);
        if (path === test.paths.multiSharedTemplates) {
          throw new Error("template cleanup failed");
        }
        await nodeAccountProfileCreationDependencies.remove(path, recursive);
      },
    };

    await assert.rejects(
      createAccountProfile(test.workspace, test.request, test.paths, dependencies),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], primary);
        return true;
      },
    );
    assert.deepEqual(removed, [
      test.paths.multiSharedTemplates,
      test.paths.multiSharedBuildLibrary,
      multiProfilePaths(test.paths, PROFILE_ID).root,
    ]);
    assert.equal(await absent(test.paths.multiSharedBuildLibrary), true);
    assert.equal(
      await absent(multiProfilePaths(test.paths, PROFILE_ID).root),
      true,
    );
  });
});
