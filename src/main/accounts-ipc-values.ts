/**
 * Pure validation for the account-profile IPC surface.
 * The Electron boundary owns argument counts; this module owns account values.
 */
import type {
  AccountProfileCreateRequest,
  AccountProfileRequest,
  AccountProfileUpdateRequest,
} from "../shared/contracts.js";
import {
  MULTI_PROFILE_MAX_COUNT,
  parseProfileId,
  parseProfileName,
  type LibraryScope,
  type ProfileId,
} from "../shared/multiple-accounts.js";
import { ValidationError } from "../shared/errors.js";

function parseLibraryScope(value: unknown, field: string): LibraryScope {
  if (value !== "shared" && value !== "private") {
    throw new ValidationError(`${field} must be shared or private`);
  }
  return value;
}

function parseAccountProfile(value: unknown): AccountProfileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("account profile must be an object");
  }
  const input = value as Record<string, unknown>;
  return {
    name: parseProfileName(input.name),
    templates: parseLibraryScope(input.templates, "templates"),
    builds: parseLibraryScope(input.builds, "builds"),
  };
}

export function parseAccountProfileCreate(value: unknown): AccountProfileCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("account profile must be an object");
  }
  return { name: parseProfileName((value as Record<string, unknown>).name) };
}

export function parseAccountProfileUpdate(value: unknown): AccountProfileUpdateRequest {
  const profile = parseAccountProfile(value);
  return {
    id: parseProfileId((value as Record<string, unknown>).id),
    ...profile,
  };
}

export function parseProfileIds(value: unknown): readonly ProfileId[] {
  const maximumWorkspaceProfiles = MULTI_PROFILE_MAX_COUNT + 1;
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > maximumWorkspaceProfiles
  ) {
    throw new ValidationError(
      `select between 1 and ${maximumWorkspaceProfiles} account profiles`,
    );
  }
  const ids = value.map(parseProfileId);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError("account profile selection contains duplicates");
  }
  return ids;
}
