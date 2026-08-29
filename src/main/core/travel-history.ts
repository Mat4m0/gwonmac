/**
 * Serializes atomic per-character Travel history updates. Corrupt convenience
 * data is quarantined without affecting settings or Travel preferences.
 */
import { readFile } from "node:fs/promises";
import {
  DEFAULT_TRAVEL_HISTORY,
  EMPTY_TRAVEL_HISTORY,
  TRAVEL_HISTORY_CHARACTER_LIMIT,
  TRAVEL_HISTORY_FORMAT,
  parseTravelHistoryDocument,
  recordVisitedTravel,
  type TravelCharacterKey,
  type TravelHistory,
  type TravelHistoryDocument,
} from "../../shared/travel-history.js";
import {
  travelMapIdForStableStorage,
  travelMapIdFromReleasedStorage,
} from "../../shared/travel-map-id.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";

async function readDocument(path: string): Promise<TravelHistoryDocument> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_TRAVEL_HISTORY;
    throw error;
  }
  try {
    return parseTravelHistoryDocument(runtimeHistory(JSON.parse(text) as unknown));
  } catch {
    await quarantineCorruptDocument(path);
    return DEFAULT_TRAVEL_HISTORY;
  }
}

function runtimeHistory(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const document = value as Record<string, unknown>;
  if (document.characters === null || typeof document.characters !== "object"
    || Array.isArray(document.characters)) return value;
  return {
    ...document,
    characters: Object.fromEntries(Object.entries(document.characters).map(([key, history]) => [
      key,
      Array.isArray(history)
        ? history.map((mapId) => Number.isSafeInteger(mapId)
            ? travelMapIdFromReleasedStorage(Number(mapId))
            : mapId)
        : history,
    ])),
  };
}

function storedHistory(document: TravelHistoryDocument): TravelHistoryDocument {
  return {
    ...document,
    characters: Object.fromEntries(Object.entries(document.characters).map(([key, history]) => [
      key,
      history.map(travelMapIdForStableStorage),
    ])) as Record<TravelCharacterKey, TravelHistory>,
  };
}

function updateCharacter(
  document: TravelHistoryDocument,
  characterKey: TravelCharacterKey,
  history: TravelHistory,
): TravelHistoryDocument {
  const entries = Object.entries(document.characters)
    .filter(([key]) => key !== characterKey)
    .slice(-(TRAVEL_HISTORY_CHARACTER_LIMIT - 1));
  return {
    formatVersion: TRAVEL_HISTORY_FORMAT,
    characters: Object.fromEntries([...entries, [characterKey, history]]) as Record<
      TravelCharacterKey,
      TravelHistory
    >,
  };
}

export class TravelHistoryStore {
  readonly #path: string;
  #tail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  get(characterKey: TravelCharacterKey): Promise<TravelHistory> {
    return this.#enqueue(async () =>
      (await readDocument(this.#path)).characters[characterKey] ?? EMPTY_TRAVEL_HISTORY
    );
  }

  record(characterKey: TravelCharacterKey, mapId: number): Promise<TravelHistory> {
    return this.#enqueue(async () => {
      const document = await readDocument(this.#path);
      const next = recordVisitedTravel(
        document.characters[characterKey] ?? EMPTY_TRAVEL_HISTORY,
        mapId,
      );
      await writeAtomicJson(
        this.#path,
        storedHistory(updateCharacter(document, characterKey, next)),
      );
      return next;
    });
  }

}
