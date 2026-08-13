import type {
  AccountLaunchIssue,
  MultiProfileRuntimeState,
} from "../../shared/contracts.js";
import type { ProfileId } from "../../shared/multiple-accounts.js";

export interface ProfileRuntime {
  readonly state: MultiProfileRuntimeState;
  readonly launchIssue?: AccountLaunchIssue;
}

/** The process-local source of truth for every account launch row. */
export class ProfileRuntimeStore {
  readonly #profiles = new Map<ProfileId, ProfileRuntime>();

  get(profileId: ProfileId): ProfileRuntime {
    return this.#profiles.get(profileId) ?? { state: "ready" };
  }

  set(
    profileId: ProfileId,
    state: MultiProfileRuntimeState,
    launchIssue?: AccountLaunchIssue,
  ): void {
    this.#profiles.set(profileId, launchIssue ? { state, launchIssue } : { state });
  }

  queue(profileIds: readonly ProfileId[], isOpen: (id: ProfileId) => boolean): void {
    for (const profileId of profileIds) {
      if (!isOpen(profileId)) this.set(profileId, "queued");
    }
  }

  releaseQueued(profileIds: readonly ProfileId[]): void {
    for (const profileId of profileIds) {
      if (this.get(profileId).state === "queued") this.set(profileId, "ready");
    }
  }
}

export type ProfileLaunchStage =
  | "preparing"
  | "starting"
  | "validating"
  | "crashed"
  | "unknown";

export function launchIssueForStage(stage: ProfileLaunchStage): AccountLaunchIssue {
  switch (stage) {
    case "preparing": return "profile-preparation";
    case "starting": return "window-startup";
    case "validating": return "client-validation";
    case "crashed": return "renderer-crash";
    case "unknown": return "unknown";
  }
}
