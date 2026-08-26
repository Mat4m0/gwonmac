/**
 * Durable, bounded Travel history partitioned by a privacy-safe character key.
 * Character names and raw game UUIDs never cross this contract.
 */
import { travelDestination } from "./travel-destinations.js";

export const TRAVEL_HISTORY_FORMAT = 2;
export const TRAVEL_HISTORY_LIMIT = 10;
export const TRAVEL_HISTORY_VISIBLE_LIMIT = 6;
export const TRAVEL_HISTORY_CHARACTER_LIMIT = 32;

declare const TRAVEL_CHARACTER_KEY: unique symbol;
export type TravelCharacterKey = string & {
  readonly [TRAVEL_CHARACTER_KEY]: true;
};
export type TravelHistory = readonly number[];
export type TravelHistoryDocument = Readonly<{
  formatVersion: typeof TRAVEL_HISTORY_FORMAT;
  characters: Readonly<Record<TravelCharacterKey, TravelHistory>>;
}>;

const CHARACTER_KEY_PATTERN = /^[0-9a-f]{16}$/u;
export const EMPTY_TRAVEL_HISTORY: TravelHistory = Object.freeze([]);
export const DEFAULT_TRAVEL_HISTORY: TravelHistoryDocument = Object.freeze({
  formatVersion: TRAVEL_HISTORY_FORMAT,
  characters: Object.freeze({}) as Readonly<Record<TravelCharacterKey, TravelHistory>>,
});

export function isTravelCharacterKey(value: unknown): value is TravelCharacterKey {
  return typeof value === "string" && CHARACTER_KEY_PATTERN.test(value);
}

export function travelCharacterKey(value: unknown): TravelCharacterKey {
  if (!isTravelCharacterKey(value)) {
    throw new TypeError("Travel character key is invalid");
  }
  return value as TravelCharacterKey;
}

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
    || input.characters === null
    || typeof input.characters !== "object"
    || Array.isArray(input.characters)
  ) throw new TypeError("Travel history is invalid");
  const entries = Object.entries(input.characters as Record<string, unknown>);
  if (
    entries.length > TRAVEL_HISTORY_CHARACTER_LIMIT
    || entries.some(([key, history]) => {
      try {
        travelCharacterKey(key);
        return !isTravelHistory(history);
      } catch {
        return true;
      }
    })
  ) throw new TypeError("Travel history is invalid");
  return Object.freeze({
    formatVersion: TRAVEL_HISTORY_FORMAT,
    characters: Object.freeze(Object.fromEntries(entries.map(([key, history]) => [
      travelCharacterKey(key),
      Object.freeze((history as TravelHistory).map(Number)),
    ]))) as Readonly<Record<TravelCharacterKey, TravelHistory>>,
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

export function parseTravelHistoryRecord(value: unknown): Readonly<{
  characterKey: TravelCharacterKey;
  mapId: number;
}> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Travel history record is invalid");
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2
    || !Number.isSafeInteger(input.mapId)
    || travelDestination(Number(input.mapId)) === null
  ) throw new TypeError("Travel history record is invalid");
  return Object.freeze({
    characterKey: travelCharacterKey(input.characterKey),
    mapId: Number(input.mapId),
  });
}

export function parseTravelHistoryCharacter(value: unknown): Readonly<{
  characterKey: TravelCharacterKey;
}> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Travel history character is invalid");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1) {
    throw new TypeError("Travel history character is invalid");
  }
  return Object.freeze({ characterKey: travelCharacterKey(input.characterKey) });
}
