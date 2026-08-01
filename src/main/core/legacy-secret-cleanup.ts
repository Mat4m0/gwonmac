/**
 * Deletes the two retired Safe Storage ciphertext files, and does nothing else
 * to a profile.
 *
 * The filenames are a closed list and the removal is not recursive, so this
 * cannot widen into a profile reset. Nothing here reads, parses, migrates or
 * backs up what it deletes: the secrets live in the Data Protection Keychain
 * now, and the old ciphertext is not a source to recover from. Failures are
 * collected and returned rather than thrown, because a file that will not
 * delete must not stop a launch.
 */
import path from "node:path";

const LEGACY_SECRET_FILES = ["credentials.bin", "steam-session.bin"] as const;

export type RemoveLegacyFile = (
  target: string,
  options: { force: true },
) => Promise<unknown>;

/**
 * One-way removal of the two retired Safe Storage ciphertext files. Nothing
 * reads, parses, migrates, backs up, or recursively removes their contents.
 */
export async function cleanupLegacySecretFiles(
  userData: string,
  remove: RemoveLegacyFile,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const filename of LEGACY_SECRET_FILES) {
    try {
      await remove(path.join(userData, filename), { force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}
