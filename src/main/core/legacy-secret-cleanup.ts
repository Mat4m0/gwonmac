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
