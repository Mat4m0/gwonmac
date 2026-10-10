/**
 * The Progress model: which missions, vanquishes and outposts each campaign
 * has, which title goal each one counts toward, and how far the current
 * character is.
 *
 * The catalogue is derived from the game's own AreaInfo rows with Toolbox's
 * rules, so it follows the installed client instead of a hand list. Every
 * goal count is computed from the same per-item status the list shows, so a
 * meter and its rows cannot disagree. Nothing here is saved: progress is the
 * current character's live record.
 */
import { guildWarsMapName } from "./guild-wars-map-names.js";
import {
  TRAVEL_DESTINATIONS,
  isPvpTravelDestination,
  isTravelDestinationInContext,
  travelDestination,
  type TravelDestination,
} from "./travel-destinations.js";

/** One 28-word bitset; bit `id % 32` of word `id >> 5` belongs to map `id`. */
export type ProgressBits = readonly number[];

/** One static AreaInfo row as the companion copies it. */
export type AreaRow = Readonly<{
  mapId: number;
  campaign: number;
  continent: number;
  region: number;
  type: number;
  thumbnail: boolean;
  flags: number;
  nameId: number;
  x: number;
  y: number;
}>;

export type GameProgressState =
  | Readonly<{ status: "waiting"; reason: "loading" | "unavailable" | "snapshot" }>
  | Readonly<{
    status: "ready";
    sequence: number;
    mapId: number;
    characterKey: string;
    /** Null when the client's arrays could not be read. */
    missions: Readonly<{
      completed: ProgressBits;
      bonus: ProgressBits;
      completedHm: ProgressBits;
      bonusHm: ProgressBits;
    }> | null;
    vanquished: ProgressBits | null;
    /** Cartographer percent for Tyria, Cantha and Elona; null when unknown. */
    cartographer: readonly (number | null)[] | null;
    areas: readonly AreaRow[];
  }>;

export type ProgressCampaignId = "prophecies" | "factions" | "nightfall" | "eotn";

export type ProgressCampaign = Readonly<{
  id: ProgressCampaignId;
  name: string;
  /** Title continent; Eye of the North has no mission or vanquish title. */
  continent: "Tyria" | "Cantha" | "Elona" | null;
  /** The word the game uses for the reward a mission title needs. */
  reward: "bonus" | "Master's" | null;
  gameCampaign: 1 | 2 | 3 | 4;
  travelCampaign: TravelDestination["campaign"];
  /** Index into `GameProgressState.cartographer`. */
  cartographer: 0 | 1 | 2 | null;
}>;

export const PROGRESS_CAMPAIGNS: readonly ProgressCampaign[] = Object.freeze([
  Object.freeze({ id: "prophecies", name: "Prophecies", continent: "Tyria", reward: "bonus", gameCampaign: 1, travelCampaign: "Prophecies", cartographer: 0 }),
  Object.freeze({ id: "factions", name: "Factions", continent: "Cantha", reward: "Master's", gameCampaign: 2, travelCampaign: "Factions", cartographer: 1 }),
  Object.freeze({ id: "nightfall", name: "Nightfall", continent: "Elona", reward: "Master's", gameCampaign: 3, travelCampaign: "Nightfall", cartographer: 2 }),
  Object.freeze({ id: "eotn", name: "Eye of the North", continent: null, reward: null, gameCampaign: 4, travelCampaign: "Eye of the North", cartographer: null }),
] satisfies ProgressCampaign[]);

/** Our names for the game's region ids. Regions without a name group as "Other". */
const REGION_NAMES: readonly string[] = Object.freeze([
  "Kryta", "Maguuma Jungle", "Ascalon", "Shiverpeak Mountains", "Heroes' Ascent",
  "Crystal Desert", "Ring of Fire Islands", "Pre-Searing", "Kaineng City", "Echovald Forest",
  "The Jade Sea", "Shing Jea Island", "Kourna", "Vabbi", "Desolation", "Istan",
  "Realm of Torment", "Tarnished Coast", "Depths of Tyria", "Far Shiverpeaks",
  "Charr Homelands", "Battle Isles",
]);

const AREA = Object.freeze({
  explorable: 2, missionOutpost: 5, cooperativeMission: 6,
  notOnWorldMap: 0x20, vanquishable: 0x1000_0000, preSearingRegion: 7,
});
/**
 * Rows that look like missions but are not separate title missions: a
 * duplicate Titan's Tears row, an event copy of Talmark Wilderness, and the
 * quarter outposts players start Vizunah Square and Unwaking Waters from.
 */
const EXCLUDED_MAPS = new Set([125, 837, 291, 292, 297, 298]);
/** Missions without their own outpost start from these, in preference order. */
const MISSION_ENTRANCES: ReadonlyMap<number, readonly number[]> = new Map([
  [215, [291, 292]],
  [204, [297, 298]],
]);
/**
 * Eye of the North missions have no thumbnail flag, so Toolbox lists them by
 * hand. The map identifiers do not spell every name as the game does.
 */
const EOTN_MISSIONS: readonly (readonly [number, string])[] = Object.freeze([
  [759, "Finding the Bloodstone"], [769, "The Elusive Golemancer"], [760, "G.O.L.E.M."],
  [761, "Against the Charr"], [762, "Warband of Brothers"], [763, "Assault on the Stronghold"],
  [766, "Curse of the Nornbear"], [768, "A Gate Too Far"], [767, "Blood Washes Blood"],
  [764, "Destruction's Depths"], [765, "A Time for Heroes"],
]);

export type ProgressItemKind = "mission" | "area" | "outpost";
export type ProgressItem = Readonly<{
  mapId: number;
  name: string;
  kind: ProgressItemKind;
  campaign: ProgressCampaignId;
  region: string;
  /** World-map position, or null when the row is not drawn on the world map. */
  position: Readonly<{ continent: number; x: number; y: number }> | null;
}>;

export type ProgressCatalogue = Readonly<Record<ProgressCampaignId, Readonly<{
  missions: readonly ProgressItem[];
  areas: readonly ProgressItem[];
  outposts: readonly ProgressItem[];
}>>>;

export function hasProgressBit(words: ProgressBits | null, mapId: number): boolean {
  if (words === null || !Number.isSafeInteger(mapId) || mapId < 0) return false;
  const word = words[mapId >>> 5];
  return word !== undefined && ((word >>> (mapId & 31)) & 1) === 1;
}

function displayName(mapId: number): string {
  return travelDestination(mapId)?.name
    ?? guildWarsMapName(mapId).replace(/ (outpost|mission)$/iu, "");
}

const catalogues = new WeakMap<readonly AreaRow[], ProgressCatalogue>();

/** Derives the catalogue once per AreaInfo table. */
export function progressCatalogue(rows: readonly AreaRow[]): ProgressCatalogue {
  const cached = catalogues.get(rows);
  if (cached) return cached;
  const byMap = new Map(rows.map((row) => [row.mapId, row]));
  const item = (mapId: number, kind: ProgressItemKind, campaign: ProgressCampaign, name = displayName(mapId)): ProgressItem => {
    const row = byMap.get(mapId);
    return Object.freeze({
      mapId,
      name,
      kind,
      campaign: campaign.id,
      region: row ? REGION_NAMES[row.region] ?? "Other" : "Other",
      position: row && (row.flags & AREA.notOnWorldMap) === 0 && (row.x !== 0 || row.y !== 0)
        ? Object.freeze({ continent: row.continent, x: row.x, y: row.y })
        : null,
    });
  };
  const entries = PROGRESS_CAMPAIGNS.map((campaign) => {
    const seen = new Set<number>();
    const missions: ProgressItem[] = [];
    const areas: ProgressItem[] = [];
    for (const row of rows) {
      if (row.campaign !== campaign.gameCampaign || EXCLUDED_MAPS.has(row.mapId)
        || (row.flags & AREA.notOnWorldMap) !== 0 || row.region === AREA.preSearingRegion
        || seen.has(row.nameId)) continue;
      const mission = (row.type === AREA.missionOutpost || row.type === AREA.cooperativeMission) && row.thumbnail;
      const area = row.type === AREA.explorable && (row.flags & AREA.vanquishable) !== 0;
      if (mission && campaign.reward !== null) missions.push(item(row.mapId, "mission", campaign));
      if (area) areas.push(item(row.mapId, "area", campaign));
      if (mission || area) seen.add(row.nameId);
    }
    if (campaign.id === "eotn") missions.push(...EOTN_MISSIONS.map(([mapId, name]) => item(mapId, "mission", campaign, name)));
    const outposts = TRAVEL_DESTINATIONS
      .filter((destination) => destination.campaign === campaign.travelCampaign
        && !isPvpTravelDestination(destination.mapId)
        // Travel's own rule: a pre-Searing outpost is no trip for a character after the Searing.
        && isTravelDestinationInContext("world", destination.mapId))
      .map((destination) => item(destination.mapId, "outpost", campaign));
    return [campaign.id, Object.freeze({
      missions: Object.freeze(missions),
      areas: Object.freeze(areas),
      outposts: Object.freeze(outposts),
    })] as const;
  });
  const catalogue = Object.freeze(Object.fromEntries(entries)) as ProgressCatalogue;
  catalogues.set(rows, catalogue);
  return catalogue;
}

export type ProgressGoalId =
  | "protector" | "guardian" | "missions" | "hard" | "vanquisher" | "cartographer" | "outposts";

/** Words players use for a goal, so "vq" or "hm" finds it in search. */
export const PROGRESS_GOAL_WORDS: Readonly<Record<ProgressGoalId, readonly string[]>> = Object.freeze({
  protector: ["protector", "missions", "bonus"],
  guardian: ["guardian", "hard mode", "hm", "masters"],
  missions: ["missions"],
  hard: ["hard mode", "hm"],
  vanquisher: ["vanquisher", "vanquish", "vq"],
  cartographer: ["cartographer", "carto", "explore"],
  outposts: ["outposts", "unlock", "locked"],
});

/** `done` counts toward the goal; the rest name what is still missing. */
export type ProgressStatus = "done" | "needs-reward" | "not-done" | "locked";

export type ProgressEntry = Readonly<{ item: ProgressItem; status: ProgressStatus; label: string }>;

export type ProgressGoal = Readonly<{
  id: ProgressGoalId;
  name: string;
  rule: string;
  /** Plural noun for "3 missions left". */
  unit: "missions" | "areas" | "outposts" | null;
  /** Outposts matter for travel, not for a title. */
  minor: boolean;
  entries: readonly ProgressEntry[];
  done: number;
  total: number;
  /** Cartographer only: the game's own percent, null when unknown. */
  percent: number | null;
}>;

/** Live inputs the goals read. Unknown arrays make their goals unknown, never 0%. */
export type ProgressInputs = Readonly<{
  progress: Extract<GameProgressState, { status: "ready" }>;
  unlockedMapWords: ProgressBits | null;
}>;

function missionGoal(
  campaign: ProgressCampaign,
  missions: readonly ProgressItem[],
  inputs: ProgressInputs,
  hard: boolean,
): ProgressGoal | null {
  const record = inputs.progress.missions;
  if (record === null) return null;
  const [completed, rewarded] = hard ? [record.completedHm, record.bonusHm] : [record.completed, record.bonus];
  const reward = campaign.reward;
  const entries = missions.map((item): ProgressEntry => {
    if (!hasProgressBit(completed, item.mapId)) {
      return Object.freeze({ item, status: "not-done", label: hard ? "Not completed in hard mode" : "Not completed" });
    }
    if (reward !== null && !hasProgressBit(rewarded, item.mapId)) {
      return Object.freeze({ item, status: "needs-reward", label: `Needs ${hard ? "hard mode " : ""}${reward}` });
    }
    return Object.freeze({ item, status: "done", label: "Done" });
  });
  const name = campaign.continent === null
    ? hard ? "Hard mode missions" : "Missions"
    : `${hard ? "Guardian" : "Protector"} of ${campaign.continent}`;
  const rule = reward === null
    ? hard ? "Completed in hard mode. No title is tied to these." : "Eye of the North missions have no bonus and no mission title."
    : `Every mission in ${hard ? "hard" : "normal"} mode with the ${reward}.`;
  return goal(campaign.continent === null ? (hard ? "hard" : "missions") : (hard ? "guardian" : "protector"),
    name, rule, "missions", false, entries);
}

function goal(
  id: ProgressGoalId, name: string, rule: string, unit: ProgressGoal["unit"],
  minor: boolean, entries: readonly ProgressEntry[],
): ProgressGoal {
  return Object.freeze({
    id, name, rule, unit, minor,
    entries: Object.freeze([...entries]),
    done: entries.filter((entry) => entry.status === "done").length,
    total: entries.length,
    percent: null,
  });
}

/** The goals of one campaign, in the order the Progress view shows them. */
export function progressGoals(campaignId: ProgressCampaignId, inputs: ProgressInputs): readonly ProgressGoal[] {
  const campaign = PROGRESS_CAMPAIGNS.find((candidate) => candidate.id === campaignId)!;
  const catalogue = progressCatalogue(inputs.progress.areas)[campaignId];
  const goals: ProgressGoal[] = [];
  for (const hard of [false, true]) {
    const mission = missionGoal(campaign, catalogue.missions, inputs, hard);
    if (mission) goals.push(mission);
  }
  const vanquished = inputs.progress.vanquished;
  if (vanquished !== null && catalogue.areas.length > 0) {
    goals.push(goal("vanquisher",
      campaign.continent === null ? "Vanquishes" : `Vanquisher of ${campaign.continent}`,
      campaign.continent === null
        ? "Kill every foe in hard mode. No title is tied to these."
        : "Kill every foe in hard mode. Travel goes to the nearest unlocked outpost.",
      "areas", false,
      catalogue.areas.map((item) => hasProgressBit(vanquished, item.mapId)
        ? Object.freeze({ item, status: "done" as const, label: "Vanquished" })
        : Object.freeze({ item, status: "not-done" as const, label: "Not vanquished" }))));
  }
  if (campaign.cartographer !== null) {
    const percent = inputs.progress.cartographer?.[campaign.cartographer] ?? null;
    goals.push(Object.freeze({
      id: "cartographer", name: "Cartographer",
      rule: "The game reports only a percentage. It does not say which areas are missing.",
      unit: null, minor: false, entries: Object.freeze([]), done: 0, total: 0, percent,
    }));
  }
  if (inputs.unlockedMapWords !== null) {
    const unlocked = inputs.unlockedMapWords;
    goals.push(goal("outposts", "Outposts", "Locked outposts with the nearest one you can travel to.",
      "outposts", true,
      catalogue.outposts.map((item) => hasProgressBit(unlocked, item.mapId)
        ? Object.freeze({ item, status: "done" as const, label: "Unlocked" })
        : Object.freeze({ item, status: "locked" as const, label: "Locked" }))));
  }
  return Object.freeze(goals);
}

/** The campaign whose AreaInfo row holds the current map, so the view opens where the player is. */
export function currentProgressCampaign(progress: Extract<GameProgressState, { status: "ready" }>): ProgressCampaignId | null {
  const row = progress.areas.find((candidate) => candidate.mapId === progress.mapId);
  return PROGRESS_CAMPAIGNS.find((campaign) => campaign.gameCampaign === row?.campaign)?.id ?? null;
}

export type ProgressTravelTarget = Readonly<{ mapId: number; name: string; nearest: boolean; here: boolean }>;

/**
 * Where ↵ goes for an item: a mission's own outpost when unlocked, otherwise
 * the unlocked outpost nearest on the same continent's world map.
 */
export function progressTravelTarget(item: ProgressItem, inputs: ProgressInputs): ProgressTravelTarget | null {
  const unlocked = inputs.unlockedMapWords;
  if (unlocked === null) return null;
  const current = inputs.progress.mapId;
  const direct = item.kind === "area" ? undefined
    : [item.mapId, ...MISSION_ENTRANCES.get(item.mapId) ?? []].find((mapId) => travelDestination(mapId) !== null
      && !isPvpTravelDestination(mapId) && hasProgressBit(unlocked, mapId));
  if (direct !== undefined) {
    return Object.freeze({ mapId: direct, name: displayName(direct), nearest: false, here: direct === current });
  }
  const from = item.position;
  if (from === null) return null;
  const catalogue = progressCatalogue(inputs.progress.areas);
  let best: ProgressItem | null = null;
  let distance = Infinity;
  for (const campaign of PROGRESS_CAMPAIGNS) {
    for (const outpost of catalogue[campaign.id].outposts) {
      const to = outpost.position;
      if (to === null || to.continent !== from.continent || !hasProgressBit(unlocked, outpost.mapId)) continue;
      const next = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
      if (next < distance) {
        distance = next;
        best = outpost;
      }
    }
  }
  return best === null ? null : Object.freeze({
    mapId: best.mapId, name: best.name, nearest: true, here: best.mapId === current,
  });
}
