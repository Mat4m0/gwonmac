/**
 * Owns the atomic local history derived from observed reviewed destinations.
 * It recovers corrupt convenience data without touching Travel preferences.
 */
import { readFile } from "node:fs/promises";
import {
  DEFAULT_TRAVEL_HISTORY,
  TRAVEL_HISTORY_FORMAT,
  parseTravelHistoryDocument,
  recordVisitedTravel,
  type TravelHistory,
  type TravelHistoryDocument,
} from "../../shared/travel-history.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";

async function readTravelHistory(path: string): Promise<TravelHistoryDocument> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_TRAVEL_HISTORY;
    throw error;
  }
  try {
    return parseTravelHistoryDocument(JSON.parse(text) as unknown);
  } catch {
    await quarantineCorruptDocument(path);
    return DEFAULT_TRAVEL_HISTORY;
  }
}

export async function loadTravelHistory(path: string): Promise<TravelHistory> {
  return (await readTravelHistory(path)).mapIds;
}

export async function recordTravelVisit(
  path: string,
  mapId: number,
): Promise<TravelHistory> {
  const next = recordVisitedTravel((await readTravelHistory(path)).mapIds, mapId);
  await writeAtomicJson(path, { formatVersion: TRAVEL_HISTORY_FORMAT, mapIds: next });
  return next;
}

export async function clearTravelHistory(path: string): Promise<TravelHistory> {
  await writeAtomicJson(path, DEFAULT_TRAVEL_HISTORY);
  return DEFAULT_TRAVEL_HISTORY.mapIds;
}
