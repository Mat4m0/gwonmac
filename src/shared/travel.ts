/**
 * Composes the public Travel domain surface.
 * Keeps requests, released shortcuts, catalogue, and search discoverable.
 */
import {
  TRAVEL_DESTINATIONS,
  travelDestination,
  type TravelDestination,
} from "./travel-destinations.js";

export {
  TRAVEL_DESTINATIONS,
  travelDestination,
  type TravelDestination,
} from "./travel-destinations.js";

export const TRAVEL_SHORTCUT_LIMIT = 9;
export const TRAVEL_SEARCH_QUERY_LIMIT = 80;

export type TravelDistrictId =
  | "international"
  | "america"
  | "europe-english"
  | "europe-french"
  | "europe-german"
  | "europe-italian"
  | "europe-spanish"
  | "europe-polish"
  | "europe-russian"
  | "asia-korean"
  | "asia-chinese"
  | "asia-japanese";

export type TravelDistrict = Readonly<{
  id: TravelDistrictId;
  label: string;
  aliases: readonly string[];
  region: number;
  language: number;
}>;

export const TRAVEL_DISTRICTS: readonly TravelDistrict[] = Object.freeze([
  { id: "international", label: "International", aliases: ["int"], region: -2, language: 0 },
  { id: "america", label: "America", aliases: ["ae", "ad"], region: 0, language: 0 },
  { id: "europe-english", label: "Europe English", aliases: ["ee"], region: 2, language: 0 },
  { id: "europe-french", label: "Europe French", aliases: ["ef", "fr"], region: 2, language: 2 },
  { id: "europe-german", label: "Europe German", aliases: ["eg", "de", "dd"], region: 2, language: 3 },
  { id: "europe-italian", label: "Europe Italian", aliases: ["ei", "it"], region: 2, language: 4 },
  { id: "europe-spanish", label: "Europe Spanish", aliases: ["es"], region: 2, language: 5 },
  { id: "europe-polish", label: "Europe Polish", aliases: ["ep", "pl"], region: 2, language: 9 },
  { id: "europe-russian", label: "Europe Russian", aliases: ["er", "ru"], region: 2, language: 10 },
  { id: "asia-korean", label: "Asia Korean", aliases: ["ak", "kr"], region: 1, language: 0 },
  { id: "asia-chinese", label: "Asia Chinese", aliases: ["ac", "cn"], region: 3, language: 0 },
  { id: "asia-japanese", label: "Asia Japanese", aliases: ["aj", "jp"], region: 4, language: 0 },
]);

export type TravelRequest = Readonly<{
  mapId: number;
  district: TravelDistrictId;
  districtNumber: number;
}>;

/** Fixed shortcut positions in the released, Stable-compatible disk shape. */
export type TravelShortcuts = readonly (TravelRequest | null)[];

export const DEFAULT_TRAVEL_SHORTCUTS: TravelShortcuts = Object.freeze([
  { mapId: 81, district: "international", districtNumber: 0 },
  { mapId: 55, district: "international", districtNumber: 0 },
  { mapId: 449, district: "international", districtNumber: 0 },
  { mapId: 194, district: "international", districtNumber: 0 },
  { mapId: 642, district: "international", districtNumber: 0 },
  { mapId: 857, district: "international", districtNumber: 0 },
]);

export function isTravelRequest(value: unknown): value is TravelRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return Object.keys(request).every((key) =>
    key === "mapId" || key === "district" || key === "districtNumber"
  )
    && Number.isSafeInteger(request.mapId)
    && travelDestination(Number(request.mapId)) !== null
    && TRAVEL_DISTRICTS.some((district) => district.id === request.district)
    && Number.isSafeInteger(request.districtNumber)
    && Number(request.districtNumber) >= 0
    && Number(request.districtNumber) <= 255;
}

export function isTravelShortcuts(value: unknown): value is TravelShortcuts {
  return Array.isArray(value)
    && value.length <= TRAVEL_SHORTCUT_LIMIT
    && value.every((shortcut) => shortcut === null || isTravelRequest(shortcut));
}

export function travelDistrict(id: TravelDistrictId): TravelDistrict {
  return TRAVEL_DISTRICTS.find((district) => district.id === id)!;
}

export function normaliseTravelTerm(value: string): string {
  return value.toLocaleLowerCase("en").normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function score(destination: TravelDestination, query: string): number {
  const name = normaliseTravelTerm(destination.name);
  const aliases = destination.aliases.map(normaliseTravelTerm);
  if (aliases.includes(query)) return 0;
  if (name === query) return 1;
  if (name.startsWith(query)) return 2;
  if (name.split(" ").some((word) => word.startsWith(query))) return 3;
  const terms = query.split(" ");
  return terms.every((term) =>
    name.includes(term) || aliases.some((alias) => alias.includes(term))
  ) ? 4 : Number.POSITIVE_INFINITY;
}

/** Stable autocomplete with bounded input and output work. */
export function searchTravelDestinations(
  query: string,
  limit = 8,
): readonly TravelDestination[] {
  if (query.length > TRAVEL_SEARCH_QUERY_LIMIT) return [];
  const normalised = normaliseTravelTerm(query);
  const boundedLimit = Math.max(0, Math.min(12, limit));
  if (!normalised) return TRAVEL_DESTINATIONS.slice(0, boundedLimit);
  return TRAVEL_DESTINATIONS
    .map((candidate, index) => ({ candidate, index, score: score(candidate, normalised) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, boundedLimit)
    .map((entry) => entry.candidate);
}
