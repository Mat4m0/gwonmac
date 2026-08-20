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

export function highlightTravelDestinationName(
  destination: TravelDestination,
  query: string,
): readonly TravelHighlightPart[] {
  if (query.length > TRAVEL_SEARCH_QUERY_LIMIT) return [{ text: destination.name, match: false }];
  const tokens = normaliseTravelTerm(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [{ text: destination.name, match: false }];
  const marked = Array.from({ length: destination.name.length }, () => false);
  for (const token of tokens) {
    for (let start = 0; start < destination.name.length; start += 1) {
      for (let end = start + 1; end <= destination.name.length; end += 1) {
        if (normaliseTravelTerm(destination.name.slice(start, end)) === token) {
          for (let index = start; index < end; index += 1) marked[index] = true;
          start = end - 1;
          break;
        }
      }
    }
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  for (let index = 0; index < destination.name.length; index += 1) {
    const match = marked[index]!;
    const previous = parts.at(-1);
    if (previous?.match === match) previous.text += destination.name[index]!;
    else parts.push({ text: destination.name[index]!, match });
  }
  return parts;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j]!;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

function isAdjacentTransposition(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  const different = Array.from({ length: left.length }, (_, index) => index)
    .filter((index) => left[index] !== right[index]);
  return different.length === 2
    && different[1] === different[0]! + 1
    && left[different[0]!] === right[different[1]!]
    && left[different[1]!] === right[different[0]!];
}

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
  const terms = query.split(" ");
  const searchable = [name, ...aliases, normaliseTravelTerm(destination.campaign), ...custom];
  if (terms.every((term) => searchable.some((value) => value.includes(term)))) return 4;
  const words = searchable.flatMap((value) => value.split(" "));
  const fuzzy = terms.every((term) => {
    const allowance = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
    return allowance > 0 && words.some((word) =>
      editDistance(term, word) <= allowance || isAdjacentTransposition(term, word)
    );
  });
  return fuzzy ? 5 : Number.POSITIVE_INFINITY;
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
