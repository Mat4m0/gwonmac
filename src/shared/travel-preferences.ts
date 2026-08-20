/**
 * Defines Travel-only preferences.
 * Keeps their persistence contract safe across Stable rollbacks.
 */
import { TRAVEL_DESTINATIONS, travelDestination } from "./travel-destinations.js";
import { normaliseTravelTerm } from "./travel-search.js";

export const TRAVEL_PREFERENCES_FORMAT = 1;
export const TRAVEL_SYNONYM_LIMIT = 64;
export const TRAVEL_RECENT_LIMITS = [0, 3, 5, 10] as const;

export type TravelRecentLimit = (typeof TRAVEL_RECENT_LIMITS)[number];
export type TravelSynonym = Readonly<{ term: string; mapId: number }>;
export type TravelSynonyms = readonly TravelSynonym[];
export type TravelRecentMapIds = readonly number[];

export type TravelPreferencesDocument = Readonly<{
  formatVersion: typeof TRAVEL_PREFERENCES_FORMAT;
  synonyms: TravelSynonyms;
  recentLimit: TravelRecentLimit;
  recentMapIds: TravelRecentMapIds;
}>;

export type TravelPreferencesPatch = Readonly<{
  synonyms?: TravelSynonyms;
  recentLimit?: TravelRecentLimit;
  recentMapIds?: TravelRecentMapIds;
}>;

export const DEFAULT_TRAVEL_PREFERENCES: TravelPreferencesDocument = Object.freeze({
  formatVersion: TRAVEL_PREFERENCES_FORMAT,
  synonyms: Object.freeze([]),
  recentLimit: 5,
  recentMapIds: Object.freeze([]),
});

export function isTravelRecentLimit(value: unknown): value is TravelRecentLimit {
  return TRAVEL_RECENT_LIMITS.includes(value as TravelRecentLimit);
}

export function isTravelRecentMapIds(value: unknown): value is TravelRecentMapIds {
  return Array.isArray(value)
    && value.length <= 10
    && new Set(value).size === value.length
    && value.every((mapId) => Number.isSafeInteger(mapId) && travelDestination(mapId) !== null);
}

export function isTravelSynonyms(value: unknown): value is TravelSynonyms {
  if (!Array.isArray(value) || value.length > TRAVEL_SYNONYM_LIMIT) return false;
  const terms = new Set<string>();
  return value.every((candidate) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const entry = candidate as Record<string, unknown>;
    if (
      Object.keys(entry).length !== 2
      || typeof entry.term !== "string"
      || entry.term.trim() !== entry.term
      || entry.term.length < 1
      || entry.term.length > 40
      || !Number.isSafeInteger(entry.mapId)
      || travelDestination(Number(entry.mapId)) === null
    ) return false;
    const canonical = normaliseTravelTerm(entry.term);
    const mapId = Number(entry.mapId);
    if (!canonical || terms.has(canonical)) return false;
    const collides = TRAVEL_DESTINATIONS.some((destination) =>
      destination.mapId !== mapId
      && [destination.name, ...destination.aliases]
        .some((name) => normaliseTravelTerm(name) === canonical)
    );
    if (collides) return false;
    terms.add(canonical);
    return true;
  });
}

export function parseTravelPreferences(value: unknown): TravelPreferencesDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Travel preferences must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 4
    || input.formatVersion !== TRAVEL_PREFERENCES_FORMAT
    || !isTravelSynonyms(input.synonyms)
    || !isTravelRecentLimit(input.recentLimit)
    || !isTravelRecentMapIds(input.recentMapIds)
  ) throw new TypeError("Travel preferences are invalid");
  return Object.freeze({
    formatVersion: TRAVEL_PREFERENCES_FORMAT,
    synonyms: Object.freeze(input.synonyms.map((entry) => Object.freeze({ ...entry }))),
    recentLimit: input.recentLimit,
    recentMapIds: Object.freeze(input.recentLimit === 0 ? [] : [...input.recentMapIds]),
  });
}

export function parseTravelPreferencesPatch(value: unknown): TravelPreferencesPatch {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Travel preference patch must be an object");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["synonyms", "recentLimit", "recentMapIds"].includes(key))) {
    throw new TypeError("Travel preference patch has an unknown field");
  }
  if ("synonyms" in input && !isTravelSynonyms(input.synonyms)) {
    throw new TypeError("Travel synonyms are invalid");
  }
  if ("recentLimit" in input && !isTravelRecentLimit(input.recentLimit)) {
    throw new TypeError("Travel recent limit is invalid");
  }
  if ("recentMapIds" in input && !isTravelRecentMapIds(input.recentMapIds)) {
    throw new TypeError("Travel recent destinations are invalid");
  }
  return input as TravelPreferencesPatch;
}

export function applyTravelPreferencesPatch(
  current: TravelPreferencesDocument,
  patch: TravelPreferencesPatch,
): TravelPreferencesDocument {
  return parseTravelPreferences({
    formatVersion: TRAVEL_PREFERENCES_FORMAT,
    synonyms: patch.synonyms ?? current.synonyms,
    recentLimit: patch.recentLimit ?? current.recentLimit,
    recentMapIds: patch.recentLimit === 0 ? [] : patch.recentMapIds ?? current.recentMapIds,
  });
}

export function recordRecentTravel(
  current: TravelRecentMapIds,
  mapId: number,
): TravelRecentMapIds {
  if (travelDestination(mapId) === null) {
    throw new RangeError(`Travel destination ${mapId} is not reviewed`);
  }
  return Object.freeze([mapId, ...current.filter((candidate) => candidate !== mapId)].slice(0, 10));
}
