/**
 * Owns capture-location meaning and the player's bounded tracking choices.
 * Learned skills remain live observations, never a second saved completion ledger.
 */
import { isTravelCharacterKey, type TravelCharacterKey } from "./travel-history.js";
import { PROFESSIONS } from "./builds/heroes.js";
import type { Profession } from "./builds/library.js";

export const ELITE_REGIONS = ["Tyria", "Cantha", "Elona", "Eye of the North"] as const;
export type EliteRegion = typeof ELITE_REGIONS[number];
export type EliteProfessionFilter = Readonly<{ kind: "all" | "mine" }>
  | Readonly<{ kind: "custom"; values: readonly Profession[] }>;
export type EliteViewPreferences = Readonly<{
  search: string;
  professions: EliteProfessionFilter;
  region: EliteRegion | "";
  hideLearned: boolean;
  mode: "browse" | "tracked";
  worldMap: boolean;
  panelOpen: boolean;
  focusedSkill: number | null;
}>;
export const DEFAULT_ELITE_VIEW: EliteViewPreferences = Object.freeze({
  search: "", professions: Object.freeze({ kind: "all" }), region: "",
  hideLearned: true, mode: "browse", worldMap: true, panelOpen: false, focusedSkill: null,
});
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
  view: EliteViewPreferences;
}>;
export const EMPTY_ELITE_TRACKING: EliteTracking = Object.freeze({
  skills: Object.freeze([]), activeLocation: null, missionMap: true, view: DEFAULT_ELITE_VIEW,
});
export type EliteChange =
  | Readonly<{ kind: "track" | "remove"; skillId: number }>
  | Readonly<{ kind: "target"; locationId: string }>
  | Readonly<{ kind: "view"; view: EliteViewPreferences }>
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
export function parseEliteView(value: unknown): EliteViewPreferences {
  const input = object(value);
  exact(input, ["search", "professions", "region", "hideLearned", "mode", "worldMap", "panelOpen", "focusedSkill"]);
  const filter = object(input.professions);
  let professions: EliteProfessionFilter;
  if (filter.kind === "all" || filter.kind === "mine") {
    exact(filter, ["kind"]);
    professions = { kind: filter.kind };
  } else if (filter.kind === "custom") {
    exact(filter, ["kind", "values"]);
    if (!Array.isArray(filter.values) || filter.values.length < 1 || filter.values.length > 10
      || !filter.values.every((value: unknown): value is Profession => typeof value === "string" && Object.hasOwn(PROFESSIONS, value))
      || new Set(filter.values).size !== filter.values.length) throw new TypeError("Invalid professions");
    professions = { kind: "custom", values: Object.freeze([...filter.values]) };
  } else throw new TypeError("Invalid profession filter");
  const region = input.region === "" ? "" : ELITE_REGIONS.find(region => region === input.region);
  if (typeof input.search !== "string" || input.search.length > 200
    || region === undefined
    || typeof input.hideLearned !== "boolean" || typeof input.worldMap !== "boolean" || typeof input.panelOpen !== "boolean"
    || (input.mode !== "browse" && input.mode !== "tracked")
    || (input.focusedSkill !== null && (typeof input.focusedSkill !== "number" || !Number.isSafeInteger(input.focusedSkill)
      || input.focusedSkill < 1 || input.focusedSkill > 10_000))) throw new TypeError("Invalid map preferences");
  return Object.freeze({ search: input.search, professions: Object.freeze(professions),
    region, hideLearned: input.hideLearned, mode: input.mode,
    worldMap: input.worldMap, panelOpen: input.panelOpen, focusedSkill: input.focusedSkill });
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
  if (change.kind === "view") {
    exact(change, ["kind", "view"]);
    return { characterKey, change: { kind: "view", view: parseEliteView(change.view) } };
  }
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
  // An absent view means the player has not saved map preferences yet.
  exact(input, "view" in input ? ["skills", "activeLocation", "missionMap", "view"] : ["skills", "activeLocation", "missionMap"]);
  const view = "view" in input ? parseEliteView(input.view) : DEFAULT_ELITE_VIEW;
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
  if (view.focusedSkill !== null && !known.has(view.focusedSkill)) throw new TypeError("Unknown focused skill");
  return Object.freeze({ skills: Object.freeze(skills), activeLocation: active, missionMap: input.missionMap, view });
}
export function changeEliteTracking(
  current: EliteTracking, change: EliteChange, locations: readonly EliteLocation[],
): EliteTracking {
  if (change.kind === "view") {
    const view = parseEliteView(change.view);
    if (view.focusedSkill !== null && !locations.some(entry => entry.skillId === view.focusedSkill)) throw new TypeError("Unknown focused skill");
    return { ...current, view };
  }
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
  return region === "Cantha" ? 2 : region === "Elona" ? 4 : 0;
}
export function eliteLearned(
  skillId: number, observed: Readonly<{ knownThrough: number; unlocked: ReadonlySet<number> }> | null,
): "learned" | "not-learned" | "unknown" {
  if (!observed || skillId >= observed.knownThrough) return "unknown";
  return observed.unlocked.has(skillId) ? "learned" : "not-learned";
}
