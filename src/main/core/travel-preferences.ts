/**
 * Owns durable Travel preferences.
 * Keeps them outside Stable-owned settings.json for rollback safety.
 */
import { readFile, rename } from "node:fs/promises";
import {
  DEFAULT_TRAVEL_PREFERENCES,
  applyTravelPreferencesPatch,
  parseTravelPreferences,
  recordRecentTravel,
  type TravelPreferencesDocument,
  type TravelPreferencesPatch,
} from "../../shared/travel-preferences.js";
import { writeAtomicJson } from "./atomic-file.js";

export async function loadTravelPreferences(path: string): Promise<TravelPreferencesDocument> {
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
    await rename(path, `${path}.corrupt`);
    return DEFAULT_TRAVEL_PREFERENCES;
  }
}

export async function updateTravelPreferences(
  path: string,
  patch: TravelPreferencesPatch,
): Promise<TravelPreferencesDocument> {
  const next = applyTravelPreferencesPatch(await loadTravelPreferences(path), patch);
  await writeAtomicJson(path, next);
  return next;
}

export async function recordConfirmedTravel(
  path: string,
  mapId: number,
): Promise<TravelPreferencesDocument> {
  const current = await loadTravelPreferences(path);
  if (current.recentLimit === 0) return current;
  const next = applyTravelPreferencesPatch(current, {
    recentMapIds: recordRecentTravel(current.recentMapIds, mapId),
  });
  await writeAtomicJson(path, next);
  return next;
}
