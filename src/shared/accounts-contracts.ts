/**
 * Renderer/main value contracts owned by the Multiple Accounts feature.
 * Durable workspace documents remain in `multiple-accounts.ts`.
 */
import type {
  AccountMode,
  LibraryScope,
  ProfileId,
} from "./multiple-accounts.js";
import type { TemplateExportEntry } from "./template-contracts.js";

export type MultiProfileRuntimeState =
  | "ready"
  | "queued"
  | "opening"
  | "checking"
  | "running"
  | "failed";

export type AccountLaunchIssue =
  | "profile-preparation"
  | "window-startup"
  | "client-validation"
  | "renderer-crash"
  | "unknown";

export interface AccountProfileSummary {
  readonly id: ProfileId;
  readonly name: string;
  readonly templates: LibraryScope;
  readonly builds: LibraryScope;
  readonly archived: boolean;
  readonly state: MultiProfileRuntimeState;
  readonly launchIssue?: AccountLaunchIssue;
}

export interface AccountsState {
  readonly mode: AccountMode;
  readonly profiles: readonly AccountProfileSummary[];
}

export interface AccountsSetupRequest {
  readonly templateEntries: readonly TemplateExportEntry[];
}

export interface AccountTemplateLibrary {
  readonly revision: number;
  readonly entries: readonly TemplateExportEntry[];
}

export interface AccountProfileRequest {
  readonly name: string;
  readonly templates: LibraryScope;
  readonly builds: LibraryScope;
}

export interface AccountProfileCreateRequest extends AccountProfileRequest {
  readonly copySingleBuilds: boolean;
  readonly copySingleTemplates: boolean;
}

export interface AccountProfileUpdateRequest extends AccountProfileRequest {
  readonly id: ProfileId;
}
