import { rename, stat } from "node:fs/promises";
import path from "node:path";
import type { ProfileRecord } from "./core/profiles.js";
import { ProfileStore } from "./core/profiles.js";

export interface ProfileBootstrapResult {
  readonly profile: ProfileRecord;
  readonly store: ProfileStore;
  readonly cleanedStages: number;
  readonly trashedProfiles: number;
  readonly trashFailures: number;
}

async function moveLegacyDocument(
  source: string,
  destination: string,
): Promise<void> {
  const sourceExists = await stat(source).then(
    (info) => info.isFile(),
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (!sourceExists) return;
  const destinationExists = await stat(destination).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (destinationExists) return;
  await rename(source, destination);
}

export async function bootstrapProfiles(options: {
  userData: string;
  profilesRoot: string;
  trashItem: (profileRoot: string) => Promise<void>;
}): Promise<ProfileBootstrapResult> {
  const store = new ProfileStore(options.profilesRoot);
  const cleanedStages = await store.cleanupIncompleteStages();
  const trash = await store.trashMarked(options.trashItem);
  let scan = await store.scan();
  if (scan.profiles.length === 0) {
    if (scan.invalidCount > 0) {
      throw new Error("no readable profile remains");
    }
    await store.create("Default");
    scan = await store.scan();
  }
  const profile = scan.profiles[0];
  if (!profile) throw new Error("default profile creation failed");

  // The root documents are the one-profile preview layout. Same-volume rename
  // is atomic, and an already-published destination wins after an interrupted
  // retry; the legacy source is preserved rather than overwriting it.
  await moveLegacyDocument(
    path.join(options.userData, "credentials.bin"),
    profile.paths.credentials,
  );
  await moveLegacyDocument(
    path.join(options.userData, "window-state.json"),
    profile.paths.windowState,
  );
  await moveLegacyDocument(
    path.join(options.userData, "clear-game-storage-on-start"),
    profile.paths.gameStorageClearRequest,
  );

  return {
    profile,
    store,
    cleanedStages,
    trashedProfiles: trash.trashed,
    trashFailures: trash.failed,
  };
}
