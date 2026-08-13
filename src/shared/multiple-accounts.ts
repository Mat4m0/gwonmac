/**
 * The durable vocabulary for the opt-in Multiple Accounts workspace.
 *
 * Stable profile IDs authorize native resources, so this module validates
 * them before main derives a path, partition, or Keychain item. Display names
 * never carry authority. Runtime launch state is deliberately absent because
 * the live window registry is its only owner.
 */
import { AppError } from "./errors.js";

export const ACCOUNT_MODES = ["single", "multi"] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];

export const LIBRARY_SCOPES = ["shared", "private"] as const;
export type LibraryScope = (typeof LIBRARY_SCOPES)[number];

declare const PROFILE_ID: unique symbol;
export type ProfileId = string & { readonly [PROFILE_ID]: true };

export interface LauncherModeDocument {
  readonly formatVersion: 1;
  readonly mode: AccountMode;
}

export interface MultiProfile {
  readonly id: ProfileId;
  readonly name: string;
  readonly archived: boolean;
  readonly templates: LibraryScope;
  readonly builds: LibraryScope;
}

export interface MultiWorkspace {
  readonly formatVersion: 1;
  readonly profiles: readonly MultiProfile[];
}

const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;
export const PROFILE_NAME_MAX_LENGTH = 48;

function record(value: unknown, owner: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(owner === "launcher mode" ? "bad_launcher_mode" : "bad_multi_workspace", `${owner} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseProfileId(value: unknown): ProfileId {
  if (typeof value !== "string" || !PROFILE_ID_PATTERN.test(value)) {
    throw new AppError("bad_multi_workspace", "profile id must be a lowercase UUID v4");
  }
  return value as ProfileId;
}

export function parseProfileName(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("bad_multi_workspace", "profile name must be text");
  }
  const name = value.normalize("NFC").trim();
  if (
    name.length === 0
    || name.length > PROFILE_NAME_MAX_LENGTH
    || CONTROL_CHARACTER.test(name)
  ) {
    throw new AppError("bad_multi_workspace", "profile name is empty, too long, or contains a control character");
  }
  return name;
}

/** Duplicate labels would make windows and destructive confirmations unsafe. */
export function profileNameKey(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

function parseLibraryScope(value: unknown, field: string): LibraryScope {
  if (value !== "shared" && value !== "private") {
    throw new AppError("bad_multi_workspace", `profile ${field} must be shared or private`);
  }
  return value;
}

export function parseLauncherMode(value: unknown): LauncherModeDocument {
  const source = record(value, "launcher mode");
  if (source.formatVersion !== 1) {
    throw new AppError("bad_launcher_mode", "launcher mode format is not supported");
  }
  if (source.mode !== "single" && source.mode !== "multi") {
    throw new AppError("bad_launcher_mode", "launcher mode must be single or multi");
  }
  return { formatVersion: 1, mode: source.mode };
}

export function parseMultiWorkspace(value: unknown): MultiWorkspace {
  const source = record(value, "Multiple Accounts workspace");
  if (source.formatVersion !== 1 || !Array.isArray(source.profiles)) {
    throw new AppError("bad_multi_workspace", "workspace format or profiles are invalid");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  const profiles = source.profiles.map((raw): MultiProfile => {
    const profile = record(raw, "Multiple Accounts profile");
    const id = parseProfileId(profile.id);
    const name = parseProfileName(profile.name);
    if (typeof profile.archived !== "boolean") {
      throw new AppError("bad_multi_workspace", "profile archived must be a boolean");
    }
    if (ids.has(id) || names.has(profileNameKey(name))) {
      throw new AppError("bad_multi_workspace", "profile ids and names must be unique");
    }
    ids.add(id);
    names.add(profileNameKey(name));
    return {
      id,
      name,
      archived: profile.archived,
      templates: parseLibraryScope(profile.templates, "templates"),
      builds: parseLibraryScope(profile.builds, "builds"),
    };
  });
  if (!profiles.some((profile) => !profile.archived)) {
    throw new AppError("bad_multi_workspace", "workspace needs an active profile");
  }
  return { formatVersion: 1, profiles };
}
