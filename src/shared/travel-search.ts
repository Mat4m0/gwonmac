/**
 * Provides bounded Travel search.
 * Owns matching, ranking, and highlighted result segments.
 */
import { TRAVEL_DESTINATIONS, type TravelDestination } from "./travel-destinations.js";
import type { TravelSynonyms } from "./travel-preferences.js";

export const TRAVEL_SEARCH_QUERY_LIMIT = 80;

export function normaliseTravelTerm(value: string): string {
  return value.toLocaleLowerCase("en").normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export type TravelHighlightPart = Readonly<{ text: string; match: boolean }>;

/** A word starts at a letter or digit that follows no other letter, digit or apostrophe. */
const WORD_CHARACTER = /[\p{L}\p{N}'’]/u;
const startsWord = (name: string, index: number): boolean =>
  /[\p{L}\p{N}]/u.test(name[index]!) && (index === 0 || !WORD_CHARACTER.test(name[index - 1]!));

/**
 * Marks the start of each word that a typed word begins, the way search matches.
 * A mark never covers the space or punctuation before a word (HUB-189).
 */
export function highlightTravelDestinationName(
  destination: TravelDestination,
  query: string,
): readonly TravelHighlightPart[] {
  if (query.length > TRAVEL_SEARCH_QUERY_LIMIT) return [{ text: destination.name, match: false }];
  const tokens = normaliseTravelTerm(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [{ text: destination.name, match: false }];
  const { name } = destination;
  const marked = Array.from({ length: name.length }, () => false);
  for (let start = 0; start < name.length; start += 1) {
    if (!startsWord(name, start)) continue;
    for (const token of tokens) {
      for (let end = start + 1; end <= name.length; end += 1) {
        const typed = normaliseTravelTerm(name.slice(start, end));
        if (typed === token) {
          for (let index = start; index < end; index += 1) marked[index] = true;
          break;
        }
        if (!token.startsWith(typed)) break;
      }
    }
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  for (let index = 0; index < name.length; index += 1) {
    const match = marked[index]!;
    const previous = parts.at(-1);
    if (previous?.match === match) previous.text += name[index]!;
    else parts.push({ text: name[index]!, match });
  }
  return parts;
}

/**
 * Deterministic tiers, as in Hub search (D-21, HUB-065): the player's own phrase, an
 * official shortcut, the exact name, then words that start the name's words, a shortcut's
 * or a phrase's. No substring, campaign or typo guess ever finds a destination.
 */
function score(destination: TravelDestination, query: string, synonyms: TravelSynonyms): number {
  const name = normaliseTravelTerm(destination.name);
  const aliases = destination.aliases.map(normaliseTravelTerm);
  const custom = synonyms
    .filter(({ mapId }) => mapId === destination.mapId)
    .map(({ term }) => normaliseTravelTerm(term));
  if (custom.includes(query)) return 0;
  if (aliases.includes(query)) return 1;
  if (name === query) return 2;
  const nameWords = name.split(" ");
  if (name.startsWith(query) || nameWords.some((word) => word.startsWith(query))) return 3;
  const words = [name, ...aliases, ...custom].flatMap((value) => value.split(" "));
  return query.split(" ").every((term) => words.some((word) => word.startsWith(term)))
    ? 4
    : Number.POSITIVE_INFINITY;
}

/** The query names this destination exactly: the player's phrase, an official shortcut or the name. */
export function travelMatchIsExact(
  destination: TravelDestination,
  query: string,
  synonyms: TravelSynonyms = [],
): boolean {
  const normalised = normaliseTravelTerm(query);
  return normalised !== "" && score(destination, normalised, synonyms) <= 2;
}

export function searchTravelDestinations(
  query: string,
  synonymsOrLimit: TravelSynonyms | number = [],
  limit = 12,
): readonly TravelDestination[] {
  if (query.length > TRAVEL_SEARCH_QUERY_LIMIT) return [];
  const synonyms = typeof synonymsOrLimit === "number" ? [] : synonymsOrLimit;
  const requestedLimit = typeof synonymsOrLimit === "number" ? synonymsOrLimit : limit;
  const normalised = normaliseTravelTerm(query);
  const boundedLimit = Math.max(0, Math.min(12, requestedLimit));
  if (!normalised) return TRAVEL_DESTINATIONS.slice(0, boundedLimit);
  return TRAVEL_DESTINATIONS
    .map((candidate, index) => ({ candidate, index, score: score(candidate, normalised, synonyms) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, boundedLimit)
    .map((entry) => entry.candidate);
}
