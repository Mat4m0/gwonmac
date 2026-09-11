/**
 * Owns capture-location meaning and the player's bounded tracking choices.
 * Learned skills remain live observations, never a second saved completion ledger.
 */
import { isTravelCharacterKey, type TravelCharacterKey } from "./travel-history.js";

export const ELITE_REGIONS = ["Tyria", "Cantha", "Elona", "Eye of the North"] as const;
export type EliteRegion = typeof ELITE_REGIONS[number];
export type EliteLocation = Readonly<{
  id: string;
  skillId: number;
  boss: string;
  mapId: number;
  region: EliteRegion;
  /** Absolute world-map coordinates. Empty means no usable boss position. */
  points: readonly (readonly [number, number])[];
  note: string | null;
}>;
export type EliteTracking = Readonly<{
  skills: readonly number[];
  activeLocation: string | null;
  missionMap: boolean;
}>;
export const EMPTY_ELITE_TRACKING: EliteTracking = Object.freeze({
  skills: Object.freeze([]), activeLocation: null, missionMap: true,
});
export type EliteChange =
  | Readonly<{ kind: "track" | "remove"; skillId: number }>
  | Readonly<{ kind: "target"; locationId: string }>
  | Readonly<{ kind: "mission-map"; show: boolean }>;
export type EliteUpdate = Readonly<{ characterKey: TravelCharacterKey; change: EliteChange }>;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Elite tracking must be an object");
  }
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new TypeError("Elite tracking contains unexpected fields");
  }
}
export function parseEliteCharacter(value: unknown): Readonly<{ characterKey: TravelCharacterKey }> {
  const input = object(value);
  exact(input, ["characterKey"]);
  if (!isTravelCharacterKey(input.characterKey)) throw new TypeError("Character is unavailable");
  return { characterKey: input.characterKey };
}
export function parseEliteUpdate(value: unknown): EliteUpdate {
  const input = object(value);
  exact(input, ["characterKey", "change"]);
  const { characterKey } = parseEliteCharacter({ characterKey: input.characterKey });
  const change = object(input.change);
  if (change.kind === "track" || change.kind === "remove") {
    exact(change, ["kind", "skillId"]);
    if (typeof change.skillId !== "number" || !Number.isSafeInteger(change.skillId)
      || change.skillId < 1 || change.skillId > 10_000) throw new TypeError("Invalid skill");
    return { characterKey, change: { kind: change.kind, skillId: change.skillId } };
  }
  if (change.kind === "target") {
    exact(change, ["kind", "locationId"]);
    if (typeof change.locationId !== "string" || !/^[a-f0-9]{16}$/u.test(change.locationId)) {
      throw new TypeError("Invalid capture location");
    }
    return { characterKey, change: { kind: "target", locationId: change.locationId } };
  }
  if (change.kind === "mission-map") {
    exact(change, ["kind", "show"]);
    if (typeof change.show !== "boolean") throw new TypeError("Invalid mission map choice");
    return { characterKey, change: { kind: "mission-map", show: change.show } };
  }
  throw new TypeError("Unknown tracking action");
}
export function parseEliteTracking(value: unknown, locations: readonly EliteLocation[]): EliteTracking {
  const input = object(value);
  exact(input, ["skills", "activeLocation", "missionMap"]);
  const known = new Set(locations.map((location) => location.skillId));
  if (!Array.isArray(input.skills) || input.skills.length > known.size
    || input.skills.some((id: unknown) => typeof id !== "number" || !known.has(id))
    || new Set(input.skills).size !== input.skills.length
    || typeof input.missionMap !== "boolean") throw new TypeError("Invalid tracking choices");
  const skills: number[] = input.skills.map(Number);
  const active = input.activeLocation;
  if (active !== null && (typeof active !== "string" || !locations.some((location) =>
    location.id === active && skills.includes(location.skillId)))) {
    throw new TypeError("Active boss must belong to a tracked skill");
  }
  return Object.freeze({ skills: Object.freeze(skills), activeLocation: active, missionMap: input.missionMap });
}
export function changeEliteTracking(
  current: EliteTracking, change: EliteChange, locations: readonly EliteLocation[],
): EliteTracking {
  if (change.kind === "mission-map") return { ...current, missionMap: change.show };
  if (change.kind === "target") {
    const location = locations.find((entry) => entry.id === change.locationId);
    if (!location) throw new TypeError("Unknown capture location");
    return { ...current, activeLocation: location.id,
      skills: [...new Set([...current.skills, location.skillId])] };
  }
  if (!locations.some((entry) => entry.skillId === change.skillId)) throw new TypeError("Unknown capture skill");
  if (change.kind === "track") return { ...current, skills: [...new Set([...current.skills, change.skillId])] };
  const active = locations.find((entry) => entry.id === current.activeLocation);
  return { ...current, skills: current.skills.filter((id) => id !== change.skillId),
    activeLocation: active?.skillId === change.skillId ? null : current.activeLocation };
}

export function eliteContinent(region: EliteRegion): number {
  return region === "Cantha" ? 2 : region === "Elona" ? 3 : 0;
}
export function eliteLearned(
  skillId: number, observed: Readonly<{ knownThrough: number; unlocked: ReadonlySet<number> }> | null,
): "learned" | "not-learned" | "unknown" {
  if (!observed || skillId >= observed.knownThrough) return "unknown";
  return observed.unlocked.has(skillId) ? "learned" : "not-learned";
}
