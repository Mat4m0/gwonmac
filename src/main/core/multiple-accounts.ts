/**
 * The durable profile registry and legacy rollback document readers.
 *
 * The candidate never writes `launcher-mode.json`; its reader and writer stay
 * only for supported Stable tests and rollback code. Workspace publication
 * uses the repository's atomic file publisher.
 */
import { randomUUID } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  LEGACY_PRIMARY_PROFILE_ID,
  parseLauncherMode,
  parseMultiWorkspace,
  parseProfileName,
  type AccountWorkspace,
  type AccountMode,
  type LibraryScope,
  type MultiWorkspace,
  type MultiProfile,
  type ProfileId,
} from "../../shared/multiple-accounts.js";
import { AppError } from "../../shared/errors.js";
import { writeAtomicJson } from "./atomic-file.js";

const DOCUMENT_MODE = 0o600;

async function readDocument(path: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AppError(
      path.endsWith("launcher-mode.json") ? "bad_launcher_mode" : "bad_multi_workspace",
      "account-mode data is not valid JSON",
      { cause: error },
    );
  }
}

export async function loadAccountMode(path: string): Promise<AccountMode> {
  const value = await readDocument(path);
  return value === null ? "single" : parseLauncherMode(value).mode;
}

export async function saveAccountMode(
  path: string,
  mode: AccountMode,
): Promise<AccountMode> {
  const parsed = parseLauncherMode({ formatVersion: 1, mode });
  await writeAtomicJson(path, parsed, DOCUMENT_MODE);
  return parsed.mode;
}

export async function loadMultiWorkspace(
  path: string,
): Promise<MultiWorkspace | null> {
  const value = await readDocument(path);
  return value === null ? null : parseMultiWorkspace(value);
}

export async function saveMultiWorkspace(
  path: string,
  workspace: MultiWorkspace,
): Promise<MultiWorkspace> {
  const parsed = parseMultiWorkspace(workspace);
  await writeAtomicJson(path, parsed, DOCUMENT_MODE);
  return parsed;
}

export interface AccountWorkspaceBootstrapDependencies {
  readonly loadWorkspace: typeof loadMultiWorkspace;
  readonly saveWorkspace: typeof saveMultiWorkspace;
  readonly addProfile: typeof addMultiProfile;
}

const accountWorkspaceBootstrapDependencies: AccountWorkspaceBootstrapDependencies = {
  loadWorkspace: loadMultiWorkspace,
  saveWorkspace: saveMultiWorkspace,
  addProfile: addMultiProfile,
};

export class AmbiguousAccountWorkspaceBootstrapError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AmbiguousAccountWorkspaceBootstrapError";
  }
}

function normalizedAccountWorkspace(
  current: MultiWorkspace | null,
  legacySingleData: boolean,
  dependencies: AccountWorkspaceBootstrapDependencies,
): AccountWorkspace {
  let workspace = current ?? createMultiWorkspace();
  const legacyPrimaryProfileId = legacySingleData
    ? LEGACY_PRIMARY_PROFILE_ID
    : null;
  if (
    !legacySingleData
    && workspace.profiles.length === 0
  ) {
    workspace = dependencies.addProfile(workspace, {
      name: "Main account",
      templates: "private",
      builds: "private",
    });
  }
  return parseMultiWorkspace({
    ...workspace,
    legacyPrimaryProfileId,
  }) as AccountWorkspace;
}

/**
 * Publish the unified account registry without touching released Single data.
 *
 * Callers must determine `legacySingleData` before they publish any candidate
 * settings or window state. A present marker wins on later launches, which
 * prevents candidate-created files from reclassifying a fresh installation.
 */
export async function bootstrapAccountWorkspace(
  path: string,
  legacySingleData: boolean,
  dependencies: AccountWorkspaceBootstrapDependencies =
    accountWorkspaceBootstrapDependencies,
): Promise<AccountWorkspace> {
  const current = await dependencies.loadWorkspace(path);
  if (current?.legacyPrimaryProfileId !== undefined) {
    return current as AccountWorkspace;
  }
  const candidate = normalizedAccountWorkspace(
    current,
    legacySingleData,
    dependencies,
  );
  try {
    return await dependencies.saveWorkspace(path, candidate) as AccountWorkspace;
  } catch (error) {
    let durable: MultiWorkspace | null;
    try {
      durable = await dependencies.loadWorkspace(path);
    } catch (reloadError) {
      throw new AmbiguousAccountWorkspaceBootstrapError(
        "Account workspace bootstrap is unclear; restart before retrying",
        { cause: new AggregateError([error, reloadError]) },
      );
    }
    if (isDeepStrictEqual(durable, candidate)) return candidate;
    if (isDeepStrictEqual(durable, current)) throw error;
    throw new AmbiguousAccountWorkspaceBootstrapError(
      "Account workspace bootstrap is unclear; restart before retrying",
      { cause: error },
    );
  }
}

/** Preserve an unreadable account document before a player-approved recovery. */
export async function quarantineAccountDocument(
  filePath: string,
): Promise<string | null> {
  const backupPath = `${filePath}.corrupt-${Date.now()}`;
  try {
    await rename(filePath, backupPath);
    return backupPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function createMultiWorkspace(): MultiWorkspace {
  return parseMultiWorkspace({
    formatVersion: 1,
    profiles: [],
    deletingProfileIds: [],
  });
}

export function addMultiProfile(
  workspace: MultiWorkspace,
  options: {
    readonly name: string;
    readonly templates: LibraryScope;
    readonly builds: LibraryScope;
    readonly id?: string;
  },
): MultiWorkspace {
  const profile: MultiProfile = {
    id: (options.id ?? randomUUID()) as ProfileId,
    name: parseProfileName(options.name),
    archived: false,
    templates: options.templates,
    builds: options.builds,
  };
  return parseMultiWorkspace({
    ...workspace,
    profiles: [...workspace.profiles, profile],
  });
}

export function updateMultiProfile(
  workspace: MultiWorkspace,
  profileId: ProfileId,
  changes: Pick<MultiProfile, "name" | "templates" | "builds">,
): MultiWorkspace {
  if (!workspace.profiles.some((profile) => profile.id === profileId)) {
    throw new AppError("bad_multi_workspace", "profile does not exist");
  }
  return parseMultiWorkspace({
    ...workspace,
    profiles: workspace.profiles.map((profile) =>
      profile.id === profileId ? { ...profile, ...changes } : profile,
    ),
  });
}

export function archiveMultiProfile(
  workspace: MultiWorkspace,
  profileId: ProfileId,
): MultiWorkspace {
  if (!workspace.profiles.some((profile) => profile.id === profileId)) {
    throw new AppError("bad_multi_workspace", "profile does not exist");
  }
  return parseMultiWorkspace({
    ...workspace,
    profiles: workspace.profiles.map((profile) =>
      profile.id === profileId ? { ...profile, archived: true } : profile,
    ),
  });
}

export function restoreMultiProfile(
  workspace: MultiWorkspace,
  profileId: ProfileId,
): MultiWorkspace {
  if (!workspace.profiles.some((profile) => profile.id === profileId)) {
    throw new AppError("bad_multi_workspace", "profile does not exist");
  }
  return parseMultiWorkspace({
    ...workspace,
    profiles: workspace.profiles.map((profile) =>
      profile.id === profileId ? { ...profile, archived: false } : profile,
    ),
  });
}

export function removeArchivedMultiProfile(
  workspace: MultiWorkspace,
  profileId: ProfileId,
): MultiWorkspace {
  const profile = workspace.profiles.find((candidate) => candidate.id === profileId);
  if (!profile?.archived) {
    throw new AppError("bad_multi_workspace", "only an archived profile can be deleted");
  }
  return parseMultiWorkspace({
    ...workspace,
    profiles: workspace.profiles.filter((candidate) => candidate.id !== profileId),
    deletingProfileIds: workspace.deletingProfileIds.filter(
      (candidate) => candidate !== profileId,
    ),
  });
}

/** Persist this transition before any native resource for the profile is erased. */
export function beginArchivedProfileDeletion(
  workspace: MultiWorkspace,
  profileId: ProfileId,
): MultiWorkspace {
  const profile = workspace.profiles.find((candidate) => candidate.id === profileId);
  if (!profile?.archived) {
    throw new AppError("bad_multi_workspace", "only an archived profile can be deleted");
  }
  return parseMultiWorkspace({
    ...workspace,
    deletingProfileIds: [...new Set([...workspace.deletingProfileIds, profileId])],
  });
}
