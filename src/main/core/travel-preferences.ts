/**
 * Owns durable Travel preferences.
 * Keeps them outside Stable-owned settings.json for rollback safety.
 */
import { readFile } from "node:fs/promises";
import {
  DEFAULT_TRAVEL_PREFERENCES,
  applyTravelPreferencesPatch,
  parseTravelPreferences,
  recordRecentTravel,
  type TravelPreferencesDocument,
  type TravelPreferencesPatch,
} from "../../shared/travel-preferences.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";

export async function loadTravelPreferences(
  path: string,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<TravelPreferencesDocument> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_TRAVEL_PREFERENCES;
    throw error;
  }
  try {
    return parseTravelPreferences(JSON.parse(text));
  } catch {
    const backupPath = await quarantineCorruptDocument(path);
    if (backupPath) await onRecovered?.(backupPath);
    return DEFAULT_TRAVEL_PREFERENCES;
  }
}

export async function updateTravelPreferences(
  path: string,
  patch: TravelPreferencesPatch,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<TravelPreferencesDocument> {
  const next = applyTravelPreferencesPatch(
    await loadTravelPreferences(path, onRecovered),
    patch,
  );
  await writeAtomicJson(path, next);
  return next;
}

export async function recordConfirmedTravel(
  path: string,
  mapId: number,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<TravelPreferencesDocument> {
  const current = await loadTravelPreferences(path, onRecovered);
  if (current.recentLimit === 0) return current;
  const next = applyTravelPreferencesPatch(current, {
    recentMapIds: recordRecentTravel(current.recentMapIds, mapId),
  });
  await writeAtomicJson(path, next);
  return next;
}
