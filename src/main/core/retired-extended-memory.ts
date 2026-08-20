/**
 * One bounded retirement for the withdrawn post-build 4 GiB profile.
 *
 * The raw settings document is rewritten instead of being round-tripped
 * through AppSettings so this one-time cleanup deletes only the retired key.
 * The executable transform no longer exists, so every failure is safe: it is
 * reported to the caller but never blocks the ordinary 2 GiB client.
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeAtomicJson } from "./atomic-file.js";
import { parseSettings } from "./settings.js";

const RETIRED_SETTING = "extendedMemoryEnabled";
const RETIRED_CACHE_DIRECTORY = "extended-memory";

export interface RetiredExtendedMemoryMigration {
  readonly wasEnabled: boolean;
  readonly persistenceError: unknown | null;
}

const noMigration = (): RetiredExtendedMemoryMigration => ({
  wasEnabled: false,
  persistenceError: null,
});

export async function retireExtendedMemorySetting(
  settingsPath: string,
  persist: typeof writeAtomicJson = writeAtomicJson,
): Promise<RetiredExtendedMemoryMigration> {
  let text: string;
  try {
    text = await readFile(settingsPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? noMigration()
      : { wasEnabled: false, persistenceError: error };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // loadSettings owns malformed JSON and its preserved recovery copy.
    return noMigration();
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return noMigration();
  }
  const document = raw as Record<string, unknown>;
  if (!Object.hasOwn(document, RETIRED_SETTING)) return noMigration();

  const migrated = { ...document };
  const wasEnabled = migrated[RETIRED_SETTING] === true;
  delete migrated[RETIRED_SETTING];
  try {
    // Do not rewrite a document the ordinary settings reader would preserve
    // as corrupt. Its existing recovery path must remain the only owner.
    parseSettings(migrated);
  } catch {
    return noMigration();
  }
  try {
    await persist(settingsPath, migrated);
    return { wasEnabled, persistenceError: null };
  } catch (error) {
    return { wasEnabled, persistenceError: error };
  }
}

export async function discardRetiredExtendedMemoryCache(
  gameRoot: string,
): Promise<unknown | null> {
  try {
    await rm(path.join(gameRoot, RETIRED_CACHE_DIRECTORY), {
      recursive: true,
      force: true,
    });
    return null;
  } catch (error) {
    return error;
  }
}
