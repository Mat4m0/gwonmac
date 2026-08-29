/**
 * The one resolver from a trusted profile ID to its native storage owners.
 *
 * The adopted primary keeps the released default Electron session, fixed
 * Keychain slots, and root documents in place. Every other profile resolves
 * beneath its isolated partition and directory. Electron construction stays
 * outside this module so the storage decision remains directly testable.
 */
import { AppError } from "../../shared/errors.js";
import type {
  AccountWorkspace,
  MultiProfile,
  ProfileId,
} from "../../shared/multiple-accounts.js";
import type { SecretSlot } from "./native-keychain.js";
import { multiSecretSlot } from "./native-keychain.js";
import type { GamePaths } from "./paths.js";
import { multiProfilePaths } from "./paths.js";

export type ProfileStorage =
  | Readonly<{
      kind: "legacy-primary";
      profileId: ProfileId;
      session: Readonly<{ kind: "default" }>;
      credentialsSlot: "arenaNetCredentials";
      steamSessionSlot: "steamSession";
      root: null;
      buildLibrary: string;
      templates: null;
      windowState: string;
      gameStorageClearRequest: string;
    }>
  | Readonly<{
      kind: "isolated";
      profileId: ProfileId;
      session: Readonly<{ kind: "partition"; partition: string }>;
      credentialsSlot: SecretSlot;
      steamSessionSlot: SecretSlot;
      root: string;
      buildLibrary: string;
      templates: string;
      windowState: string;
      gameStorageClearRequest: string;
    }>;

function requireProfile(
  workspace: AccountWorkspace,
  profileId: ProfileId,
): MultiProfile {
  const profile = workspace.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new AppError("validation", "account profile does not exist");
  }
  return profile;
}

export function resolveProfileStorage(
  workspace: AccountWorkspace,
  profileId: ProfileId,
  paths: GamePaths,
): ProfileStorage {
  if (workspace.legacyPrimaryProfileId === profileId) {
    return {
      kind: "legacy-primary",
      profileId,
      session: { kind: "default" },
      credentialsSlot: "arenaNetCredentials",
      steamSessionSlot: "steamSession",
      root: null,
      buildLibrary: paths.buildLibrary,
      templates: null,
      windowState: paths.windowState,
      gameStorageClearRequest: paths.gameStorageClearRequest,
    };
  }
  const profile = requireProfile(workspace, profileId);
  const profilePaths = multiProfilePaths(paths, profile.id);
  return {
    kind: "isolated",
    profileId,
    session: {
      kind: "partition",
      partition: `persist:gw-multi-${profile.id}`,
    },
    credentialsSlot: multiSecretSlot(profile.id, "arenaNetCredentials"),
    steamSessionSlot: multiSecretSlot(profile.id, "steamSession"),
    root: profilePaths.root,
    buildLibrary: profile.builds === "shared"
      ? paths.multiSharedBuildLibrary
      : profilePaths.buildLibrary,
    templates: profile.templates === "shared"
      ? paths.multiSharedTemplates
      : profilePaths.templates,
    windowState: profilePaths.windowState,
    gameStorageClearRequest: profilePaths.gameStorageClearRequest,
  };
}

/** Return the one released-storage owner, when this workspace adopted one. */
export function resolveAdoptedProfileStorage(
  workspace: AccountWorkspace,
  paths: GamePaths,
): Extract<ProfileStorage, { kind: "legacy-primary" }> | null {
  const profileId = workspace.legacyPrimaryProfileId;
  if (!profileId) return null;
  const storage = resolveProfileStorage(workspace, profileId, paths);
  if (storage.kind !== "legacy-primary") {
    throw new AppError("validation", "adopted profile did not resolve released storage");
  }
  return storage;
}
