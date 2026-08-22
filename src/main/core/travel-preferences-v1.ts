/**
 * Reads and writes the exact Travel preference shape released in v2026.8.9.
 * The retired fields stay confined here until that Stable leaves rollback support.
 */
import { travelDestination } from "../../shared/travel-destinations.js";
import {
  TRAVEL_PREFERENCES_FORMAT,
  createTravelPreferences,
  type TravelPreferencesDocument,
} from "../../shared/travel-preferences.js";

const RELEASED_RECENT_LIMITS = [0, 3, 5, 10] as const;

function isReleasedRecentData(limit: unknown, mapIds: unknown): boolean {
  return RELEASED_RECENT_LIMITS.includes(limit as (typeof RELEASED_RECENT_LIMITS)[number])
    && Array.isArray(mapIds)
    && mapIds.length <= 10
    && new Set(mapIds).size === mapIds.length
    && mapIds.every((mapId) =>
      Number.isSafeInteger(mapId) && travelDestination(Number(mapId)) !== null
    );
}

export function parseTravelPreferencesV1(value: unknown): TravelPreferencesDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Travel preferences must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 4
    || input.formatVersion !== TRAVEL_PREFERENCES_FORMAT
    || !isReleasedRecentData(input.recentLimit, input.recentMapIds)
  ) throw new TypeError("Travel preferences are invalid");
  return createTravelPreferences(input.synonyms);
}

export function serializeTravelPreferencesV1(
  preferences: TravelPreferencesDocument,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    formatVersion: TRAVEL_PREFERENCES_FORMAT,
    synonyms: preferences.synonyms,
    recentLimit: 0,
    recentMapIds: Object.freeze([]),
  });
}
