/**
 * The filesystem transaction that creates one Multiple Accounts profile.
 * The workspace document is the commit record; everything published before it
 * is removed on a confirmed pre-commit failure.
 */
import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { BuildLibrary } from "../../shared/builds/library.js";
import { parseBuildLibrary } from "../../shared/builds/parse-library.js";
import type { AccountProfileCreateRequest } from "../../shared/contracts.js";
import type { MultiWorkspace } from "../../shared/multiple-accounts.js";
import {
  loadAccountTemplateLibrary,
  saveAccountTemplateLibraryExclusive,
} from "./account-template-library.js";
import { AtomicExclusiveWriteError } from "./atomic-file.js";
import { saveBuildLibraryExclusive } from "./build-library.js";
import {
  addMultiProfile,
  loadMultiWorkspace,
  saveMultiWorkspace,
} from "./multiple-accounts.js";
import { multiProfilePaths, type GamePaths } from "./paths.js";

export interface AccountProfileCreationDependencies {
  readonly addProfile: typeof addMultiProfile;
  readonly remove: (path: string, recursive: boolean) => Promise<void>;
  readonly saveBuilds: typeof saveBuildLibraryExclusive;
  readonly saveTemplates: typeof saveAccountTemplateLibraryExclusive;
  readonly saveWorkspace: typeof saveMultiWorkspace;
  readonly loadWorkspace: typeof loadMultiWorkspace;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export const nodeAccountProfileCreationDependencies: AccountProfileCreationDependencies = {
  addProfile: addMultiProfile,
  async remove(path, recursive) {
    await rm(path, { recursive, force: true });
  },
  saveBuilds: saveBuildLibraryExclusive,
  saveTemplates: saveAccountTemplateLibraryExclusive,
  saveWorkspace: saveMultiWorkspace,
  loadWorkspace: loadMultiWorkspace,
};

async function createRoot(parent: string, root: string): Promise<void> {
  await mkdir(parent, { recursive: true });
  await mkdir(root);
}

async function loadBuildImport(path: string): Promise<BuildLibrary | null> {
  let bytes: string;
  try {
    bytes = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseBuildLibrary(JSON.parse(bytes) as unknown);
}

interface OwnedPath {
  readonly path: string;
  readonly recursive: boolean;
}

export class AmbiguousAccountCreationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AmbiguousAccountCreationError";
  }
}

async function rollback(
  owned: readonly OwnedPath[],
  primary: unknown,
  dependencies: AccountProfileCreationDependencies,
): Promise<never> {
  const cleanupErrors: unknown[] = [];
  for (let index = owned.length - 1; index >= 0; index -= 1) {
    const target = owned[index]!;
    try {
      await dependencies.remove(target.path, target.recursive);
    } catch (error) {
      cleanupErrors.push(
        new Error(`Could not remove ${target.path}`, { cause: error }),
      );
    }
  }
  if (cleanupErrors.length === 0) throw primary;
  throw new AggregateError(
    [primary, ...cleanupErrors],
    "Account creation failed and some newly created files could not be removed",
  );
}

/** Create one profile without ever replacing an unowned destination. */
export async function createAccountProfile(
  workspace: MultiWorkspace,
  request: AccountProfileCreateRequest,
  paths: GamePaths,
  dependencies: AccountProfileCreationDependencies = nodeAccountProfileCreationDependencies,
): Promise<MultiWorkspace> {
  const firstAccount = workspace.profiles.length === 0;
  if (!firstAccount && (request.copySingleBuilds || request.copySingleTemplates)) {
    throw new Error("Single Account data can be copied only into the first account");
  }

  const next = dependencies.addProfile(workspace, request);
  const profile = next.profiles.at(-1)!;
  const profilePaths = multiProfilePaths(paths, profile.id);
  const buildDestination = profile.builds === "shared"
    ? paths.multiSharedBuildLibrary
    : profilePaths.buildLibrary;
  const templateDestination = profile.templates === "shared"
    ? paths.multiSharedTemplates
    : profilePaths.templates;

  // Validate every requested source before creating any destination.
  const builds = firstAccount && request.copySingleBuilds
    ? await loadBuildImport(paths.buildLibrary)
    : null;
  const templates = firstAccount && request.copySingleTemplates
    ? await loadAccountTemplateLibrary(paths.multiSingleTemplateImport)
    : null;
  const destinations = [
    ...(builds === null ? [] : [buildDestination]),
    ...(templates === null ? [] : [templateDestination]),
  ];

  for (const target of [profilePaths.root, ...destinations]) {
    if (await pathExists(target)) {
      throw new Error(
        `Account creation refused existing Multiple Accounts data at ${target}`,
      );
    }
  }

  const owned: OwnedPath[] = [];
  try {
    await createRoot(paths.multiProfiles, profilePaths.root);
    owned.push({ path: profilePaths.root, recursive: true });

    if (builds !== null) {
      try {
        await dependencies.saveBuilds(buildDestination, builds);
        owned.push({ path: buildDestination, recursive: false });
      } catch (error) {
        if (error instanceof AtomicExclusiveWriteError && error.published) {
          owned.push({ path: buildDestination, recursive: false });
        }
        throw error;
      }
    }
    if (templates !== null) {
      try {
        await dependencies.saveTemplates(templateDestination, {
          revision: 1,
          entries: templates.entries,
        });
        owned.push({ path: templateDestination, recursive: false });
      } catch (error) {
        if (error instanceof AtomicExclusiveWriteError && error.published) {
          owned.push({ path: templateDestination, recursive: false });
        }
        throw error;
      }
    }

    try {
      await dependencies.saveWorkspace(paths.multiWorkspace, next);
      return next;
    } catch (error) {
      let durable: MultiWorkspace | null;
      try {
        durable = await dependencies.loadWorkspace(paths.multiWorkspace);
      } catch (reloadError) {
        throw new AmbiguousAccountCreationError(
          "Account creation commit is unclear; restart before retrying",
          { cause: new AggregateError([error, reloadError]) },
        );
      }
      if (isDeepStrictEqual(durable, next)) return next;
      if (!isDeepStrictEqual(durable, workspace)) {
        throw new AmbiguousAccountCreationError(
          "Account creation commit is unclear; restart before retrying",
          { cause: error },
        );
      }
      throw error;
    }
  } catch (error) {
    // Ambiguous commit errors deliberately preserve resources: deleting them
    // could break a workspace that was published before directory fsync failed.
    if (error instanceof AmbiguousAccountCreationError) {
      throw error;
    }
    return await rollback(owned, error, dependencies);
  }
}
