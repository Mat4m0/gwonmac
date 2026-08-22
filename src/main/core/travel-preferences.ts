/**
 * Owns durable Travel preferences.
 * Keeps them outside Stable-owned settings.json for rollback safety.
 */
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  DEFAULT_TRAVEL_PREFERENCES,
  applyTravelPreferencesPatch,
  type TravelPreferencesDocument,
  type TravelPreferencesPatch,
} from "../../shared/travel-preferences.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";
import {
  parseTravelPreferencesV1,
  serializeTravelPreferencesV1,
} from "./travel-preferences-v1.js";

type TravelPreferencesRead = Readonly<{
  preferences: TravelPreferencesDocument;
  stored?: unknown;
}>;

async function readTravelPreferences(
  path: string,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<TravelPreferencesRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { preferences: DEFAULT_TRAVEL_PREFERENCES };
    }
    throw error;
  }
  let stored: unknown;
  let preferences: TravelPreferencesDocument;
  try {
    stored = JSON.parse(text) as unknown;
    preferences = parseTravelPreferencesV1(stored);
  } catch {
    const backupPath = await quarantineCorruptDocument(path);
    if (backupPath) await onRecovered?.(backupPath);
    return { preferences: DEFAULT_TRAVEL_PREFERENCES };
  }
  return { preferences, stored };
}

export async function loadTravelPreferences(
  path: string,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<TravelPreferencesDocument> {
  const { preferences, stored } = await readTravelPreferences(path, onRecovered);
  if (stored === undefined) return preferences;
  const sanitized = serializeTravelPreferencesV1(preferences);
  if (!isDeepStrictEqual(stored, sanitized)) {
    await writeAtomicJson(path, sanitized);
  }
  return preferences;
}

export async function updateTravelPreferences(
  path: string,
  patch: TravelPreferencesPatch,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<TravelPreferencesDocument> {
  const next = applyTravelPreferencesPatch(
    (await readTravelPreferences(path, onRecovered)).preferences,
    patch,
  );
  await writeAtomicJson(path, serializeTravelPreferencesV1(next));
  return next;
}
