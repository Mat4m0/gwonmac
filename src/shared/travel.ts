/**
 * Composes the public Travel domain surface.
 * Keeps requests, released shortcuts, preferences, and search discoverable.
 */
import {
  travelDestination,
} from "./travel-destinations.js";

export {
  TRAVEL_DESTINATIONS,
  travelDestination,
  type TravelDestination,
} from "./travel-destinations.js";

export const TRAVEL_SHORTCUT_LIMIT = 9;
export * from "./travel-preferences.js";
export * from "./travel-search.js";

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

/** Runtime action: live region/language are resolved on the game thread. */
export type TravelRequest = Readonly<{ mapId: number }>;

/** Released on-disk shortcut shape kept readable by Stable rollbacks. */
export type StoredTravelShortcut = Readonly<{
  mapId: number;
  district: TravelDistrictId;
  districtNumber: number;
}>;

export type StoredTravelShortcuts = readonly (StoredTravelShortcut | null)[];

export const DEFAULT_STORED_TRAVEL_SHORTCUTS: StoredTravelShortcuts = Object.freeze([
  { mapId: 81, district: "international", districtNumber: 0 },
  { mapId: 55, district: "international", districtNumber: 0 },
  { mapId: 449, district: "international", districtNumber: 0 },
  { mapId: 194, district: "international", districtNumber: 0 },
  { mapId: 642, district: "international", districtNumber: 0 },
  { mapId: 857, district: "international", districtNumber: 0 },
]);

export type TravelShortcut = TravelRequest | null;
export type TravelShortcuts = readonly [
  TravelShortcut, TravelShortcut, TravelShortcut,
  TravelShortcut, TravelShortcut, TravelShortcut,
  TravelShortcut, TravelShortcut, TravelShortcut,
];

export const EMPTY_TRAVEL_SHORTCUTS: TravelShortcuts = Object.freeze([
  null, null, null, null, null, null, null, null, null,
]);

export const DEFAULT_TRAVEL_SHORTCUTS: TravelShortcuts = Object.freeze([
  { mapId: 81 }, { mapId: 55 }, { mapId: 449 },
  { mapId: 194 }, { mapId: 642 }, { mapId: 857 },
  null, null, null,
]);

export function isTravelRequest(value: unknown): value is TravelRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return Object.keys(request).length === 1
    && Object.hasOwn(request, "mapId")
    && Number.isSafeInteger(request.mapId)
    && travelDestination(Number(request.mapId)) !== null;
}

export function isTravelShortcuts(value: unknown): value is TravelShortcuts {
  return Array.isArray(value)
    && value.length === TRAVEL_SHORTCUT_LIMIT
    && value.every((shortcut) => shortcut === null || isTravelRequest(shortcut));
}

export function isStoredTravelShortcuts(value: unknown): value is StoredTravelShortcuts {
  return Array.isArray(value)
    && value.length <= TRAVEL_SHORTCUT_LIMIT
    && value.every((entry) => {
      if (entry === null) return true;
      if (typeof entry !== "object" || Array.isArray(entry)) return false;
      const shortcut = entry as Record<string, unknown>;
      return Object.keys(shortcut).length === 3
        && Number.isSafeInteger(shortcut.mapId)
        && travelDestination(Number(shortcut.mapId)) !== null
        && TRAVEL_DISTRICTS.some(({ id }) => id === shortcut.district)
        && Number.isSafeInteger(shortcut.districtNumber)
        && Number(shortcut.districtNumber) >= 0
        && Number(shortcut.districtNumber) <= 255;
    });
}

export function travelShortcutsFromStored(stored: StoredTravelShortcuts): TravelShortcuts {
  return Object.freeze(Array.from({ length: TRAVEL_SHORTCUT_LIMIT }, (_, index) => {
    const shortcut = stored[index];
    return shortcut ? Object.freeze({ mapId: shortcut.mapId }) : null;
  })) as TravelShortcuts;
}

/** Preserves released district fields when a slot keeps the same map. */
export function storeTravelShortcuts(
  shortcuts: TravelShortcuts,
  previous: StoredTravelShortcuts,
): StoredTravelShortcuts {
  return Object.freeze(shortcuts.map((shortcut, index) => {
    if (shortcut === null) return null;
    const existing = previous[index];
    return existing?.mapId === shortcut.mapId
      ? Object.freeze({ ...existing })
      : Object.freeze({
          mapId: shortcut.mapId,
          district: "international" as const,
          districtNumber: 0,
        });
  }));
}

export function replaceTravelShortcut(
  shortcuts: TravelShortcuts,
  slot: number,
  replacement: TravelShortcut,
): TravelShortcuts {
  if (!Number.isInteger(slot) || slot < 0 || slot >= TRAVEL_SHORTCUT_LIMIT) {
    throw new RangeError(`Travel shortcut slot ${slot} is outside 0–8`);
  }
  const next: [...TravelShortcuts] = [...shortcuts];
  next[slot] = replacement;
  return next;
}

export function travelDistrict(id: TravelDistrictId): TravelDistrict {
  return TRAVEL_DISTRICTS.find((district) => district.id === id)!;
}
