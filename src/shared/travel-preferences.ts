/**
 * Defines Travel-only preferences.
 * Keeps their persistence contract safe across Stable rollbacks.
 */
import { TRAVEL_DESTINATIONS, travelDestination } from "./travel-destinations.js";
import { normaliseTravelTerm } from "./travel-search.js";

export const TRAVEL_PREFERENCES_FORMAT = 1;
export const TRAVEL_SYNONYM_LIMIT = 64;

export type TravelSynonym = Readonly<{ term: string; mapId: number }>;
export type TravelSynonyms = readonly TravelSynonym[];

export type TravelPreferencesDocument = Readonly<{
  formatVersion: typeof TRAVEL_PREFERENCES_FORMAT;
  synonyms: TravelSynonyms;
}>;

export type TravelPreferencesPatch = Readonly<{
  synonyms?: TravelSynonyms;
}>;

export const DEFAULT_TRAVEL_PREFERENCES: TravelPreferencesDocument = Object.freeze({
  formatVersion: TRAVEL_PREFERENCES_FORMAT,
  synonyms: Object.freeze([]),
});

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

export function createTravelPreferences(
  synonyms: unknown,
): TravelPreferencesDocument {
  if (!isTravelSynonyms(synonyms)) {
    throw new TypeError("Travel synonyms are invalid");
  }
  return Object.freeze({
    formatVersion: TRAVEL_PREFERENCES_FORMAT,
    synonyms: Object.freeze(synonyms.map((entry) => Object.freeze({ ...entry }))),
  });
}

export function parseTravelPreferencesPatch(value: unknown): TravelPreferencesPatch {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Travel preference patch must be an object");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "synonyms")) {
    throw new TypeError("Travel preference patch has an unknown field");
  }
  if ("synonyms" in input && !isTravelSynonyms(input.synonyms)) {
    throw new TypeError("Travel synonyms are invalid");
  }
  return input as TravelPreferencesPatch;
}

export function applyTravelPreferencesPatch(
  current: TravelPreferencesDocument,
  patch: TravelPreferencesPatch,
): TravelPreferencesDocument {
  return createTravelPreferences(patch.synonyms ?? current.synonyms);
}
