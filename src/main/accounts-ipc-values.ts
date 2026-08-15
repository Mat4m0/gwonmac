/**
 * Pure validation for the Multiple Accounts IPC surface.
 * The Electron boundary owns argument counts; this module owns account values.
 */
import type {
  AccountProfileCreateRequest,
  AccountProfileRequest,
  AccountProfileUpdateRequest,
  AccountsSetupRequest,
} from "../shared/contracts.js";
import {
  MULTI_PROFILE_MAX_COUNT,
  parseProfileId,
  parseProfileName,
  type LibraryScope,
  type ProfileId,
} from "../shared/multiple-accounts.js";
import { ValidationError } from "../shared/errors.js";
import { parseExportEntries } from "./template-export.js";

function parseLibraryScope(value: unknown, field: string): LibraryScope {
  if (value !== "shared" && value !== "private") {
    throw new ValidationError(`${field} must be shared or private`);
  }
  return value;
}

export function parseAccountsSetup(value: unknown): AccountsSetupRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("account setup must be an object");
  }
  const input = value as Record<string, unknown>;
  return { templateEntries: parseExportEntries(input.templateEntries) };
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
  const profile = parseAccountProfile(value);
  const input = value as Record<string, unknown>;
  if (
    typeof input.copySingleBuilds !== "boolean"
    || typeof input.copySingleTemplates !== "boolean"
  ) {
    throw new ValidationError("account copy choices must be booleans");
  }
  return {
    ...profile,
    copySingleBuilds: input.copySingleBuilds,
    copySingleTemplates: input.copySingleTemplates,
  };
}

export function parseAccountProfileUpdate(value: unknown): AccountProfileUpdateRequest {
  const profile = parseAccountProfile(value);
  return {
    id: parseProfileId((value as Record<string, unknown>).id),
    ...profile,
  };
}

export function parseProfileIds(value: unknown): readonly ProfileId[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > MULTI_PROFILE_MAX_COUNT
  ) {
    throw new ValidationError(
      `select between 1 and ${MULTI_PROFILE_MAX_COUNT} account profiles`,
    );
  }
  const ids = value.map(parseProfileId);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError("account profile selection contains duplicates");
  }
  return ids;
}
