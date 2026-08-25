/**
 * Defines the bounded Travel history that every process validates and returns.
 * It contains reviewed map IDs only; live unlock policy remains game state.
 */
import { travelDestination } from "./travel-destinations.js";

export const TRAVEL_HISTORY_FORMAT = 1;
export const TRAVEL_HISTORY_LIMIT = 10;
export const TRAVEL_HISTORY_VISIBLE_LIMIT = 5;

export type TravelHistory = readonly number[];

export type TravelHistoryDocument = Readonly<{
  formatVersion: typeof TRAVEL_HISTORY_FORMAT;
  mapIds: TravelHistory;
}>;

export const EMPTY_TRAVEL_HISTORY: TravelHistory = Object.freeze([]);
export const DEFAULT_TRAVEL_HISTORY: TravelHistoryDocument = Object.freeze({
  formatVersion: TRAVEL_HISTORY_FORMAT,
  mapIds: EMPTY_TRAVEL_HISTORY,
});

export function isTravelHistory(value: unknown): value is TravelHistory {
  return Array.isArray(value)
    && value.length <= TRAVEL_HISTORY_LIMIT
    && new Set(value).size === value.length
    && value.every((mapId) =>
      Number.isSafeInteger(mapId) && travelDestination(Number(mapId)) !== null
    );
}

export function parseTravelHistoryDocument(value: unknown): TravelHistoryDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Travel history must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2
    || input.formatVersion !== TRAVEL_HISTORY_FORMAT
    || !isTravelHistory(input.mapIds)
  ) throw new TypeError("Travel history is invalid");
  return Object.freeze({
    formatVersion: TRAVEL_HISTORY_FORMAT,
    mapIds: Object.freeze(input.mapIds.map(Number)),
  });
}

/** Most-recently visited unique destinations, newest first. */
export function recordVisitedTravel(
  current: TravelHistory,
  mapId: number,
): TravelHistory {
  if (travelDestination(mapId) === null) {
    throw new RangeError(`Travel destination ${mapId} is not reviewed`);
  }
  return Object.freeze([
    mapId,
    ...current.filter((candidate) => candidate !== mapId),
  ].slice(0, TRAVEL_HISTORY_LIMIT));
}
