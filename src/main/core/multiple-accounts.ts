/**
 * The durable Single/Multiple Accounts selection and Multi profile registry.
 *
 * A missing launcher-mode document means the legacy Single Account path. An
 * existing malformed document fails closed. Writes use the repository's one
 * atomic file publisher so setup cannot expose a partial workspace or mode.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  parseLauncherMode,
  parseMultiWorkspace,
  parseProfileName,
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

export function createMultiWorkspace(options: {
  readonly name: string;
  readonly templates: LibraryScope;
  readonly builds: LibraryScope;
  readonly id?: string;
}): MultiWorkspace {
  const id = (options.id ?? randomUUID()) as ProfileId;
  return parseMultiWorkspace({
    formatVersion: 1,
    profiles: [{
      id,
      name: parseProfileName(options.name),
      archived: false,
      templates: options.templates,
      builds: options.builds,
    }],
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
