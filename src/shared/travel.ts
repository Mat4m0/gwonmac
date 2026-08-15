/**
 * The host-owned Travel vocabulary: destinations, districts, shortcuts, and
 * deterministic autocomplete. The game receives only the resulting four
 * scalar words; it never receives search text or a generic UI command.
 */

export const TRAVEL_SHORTCUT_LIMIT = 9;

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

export type TravelDestination = Readonly<{
  mapId: number;
  name: string;
  campaign: "Prophecies" | "Factions" | "Nightfall" | "Eye of the North" | "Battle Isles";
  aliases: readonly string[];
}>;

const destination = (
  mapId: number,
  name: string,
  campaign: TravelDestination["campaign"],
  aliases: readonly string[] = [],
): TravelDestination => Object.freeze({ mapId, name, campaign, aliases: Object.freeze(aliases) });

/**
 * A deliberately focused catalogue of useful hubs and competitive outposts.
 * It is static so autocomplete stays available before the game is observed;
 * adding a destination is a reviewed product choice, not a runtime memory walk.
 */
export const TRAVEL_DESTINATIONS: readonly TravelDestination[] = Object.freeze([
  destination(81, "Ascalon City", "Prophecies", ["ac", "ascalon"]),
  destination(55, "Lion's Arch", "Prophecies", ["la", "lions arch"]),
  destination(20, "Droknar's Forge", "Prophecies", ["droks", "droknars"]),
  destination(138, "Temple of the Ages", "Prophecies", ["toa"]),
  destination(82, "Tomb of the Primeval Kings", "Prophecies", ["topk", "tomb"]),
  destination(57, "Bergen Hot Springs", "Prophecies", ["bergen"]),
  destination(109, "The Amnoon Oasis", "Prophecies", ["amnoon"]),
  destination(38, "Augury Rock", "Prophecies", ["augury"]),
  destination(133, "Beacon's Perch", "Prophecies", ["beacons"]),
  destination(134, "Yak's Bend", "Prophecies", ["yaks"]),
  destination(156, "The Granite Citadel", "Prophecies", ["granite"]),
  destination(157, "Marhan's Grotto", "Prophecies", ["marhans"]),
  destination(206, "Deldrimor War Camp", "Prophecies", ["deldrimor"]),
  destination(194, "Kaineng Center", "Factions", ["kc", "kaineng"]),
  destination(242, "Shing Jea Monastery", "Factions", ["shing jea", "sjm"]),
  destination(77, "House zu Heltzer", "Factions", ["hzh"]),
  destination(193, "Cavalon", "Factions"),
  destination(283, "Maatu Keep", "Factions", ["maatu"]),
  destination(303, "The Marketplace", "Factions", ["marketplace"]),
  destination(291, "Vizunah Square — Local Quarter", "Factions", ["vizunah local", "vs local"]),
  destination(292, "Vizunah Square — Foreign Quarter", "Factions", ["vizunah foreign", "vs foreign"]),
  destination(293, "Fort Aspenwood — Luxon", "Factions", ["fa luxon"]),
  destination(294, "Fort Aspenwood — Kurzick", "Factions", ["fa kurzick", "fa"]),
  destination(295, "The Jade Quarry — Luxon", "Factions", ["jq luxon"]),
  destination(296, "The Jade Quarry — Kurzick", "Factions", ["jq kurzick", "jq"]),
  destination(449, "Kamadan, Jewel of Istan", "Nightfall", ["kama", "kamadan"]),
  destination(387, "Sunspear Sanctuary", "Nightfall", ["sunspear"]),
  destination(393, "Chantry of Secrets", "Nightfall", ["chantry"]),
  destination(493, "Consulate Docks", "Nightfall", ["consulate"]),
  destination(474, "Domain of Anguish", "Nightfall", ["doa", "goa", "tdp"]),
  destination(642, "Eye of the North", "Eye of the North", ["eotn"]),
  destination(640, "Rata Sum", "Eye of the North", ["rata"]),
  destination(624, "Vlox's Falls", "Eye of the North", ["vlox"]),
  destination(638, "Gadd's Encampment", "Eye of the North", ["gadds"]),
  destination(639, "Umbral Grotto", "Eye of the North", ["umbral"]),
  destination(643, "Sifhalla", "Eye of the North"),
  destination(644, "Gunnar's Hold", "Eye of the North", ["gunnars"]),
  destination(645, "Olafstead", "Eye of the North"),
  destination(648, "Doomlore Shrine", "Eye of the North", ["doomlore"]),
  destination(650, "Longeye's Ledge", "Eye of the North", ["longeyes"]),
  destination(652, "Central Transfer Chamber", "Eye of the North", ["ctc"]),
  destination(857, "Embark Beach", "Battle Isles", ["embark"]),
  destination(248, "Great Temple of Balthazar", "Battle Isles", ["gtob"]),
  destination(188, "Random Arenas", "Battle Isles", ["ra"]),
  destination(330, "Heroes' Ascent", "Battle Isles", ["ha"]),
]);

export type TravelRequest = Readonly<{
  mapId: number;
  district: TravelDistrictId;
  districtNumber: number;
}>;

/** Fixed shortcut positions; null preserves an intentionally empty number key. */
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
    && Number(request.mapId) > 0
    && Number(request.mapId) <= 2_000
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

export function travelDestination(mapId: number): TravelDestination | null {
  return TRAVEL_DESTINATIONS.find((candidate) => candidate.mapId === mapId) ?? null;
}

function normalise(value: string): string {
  return value.toLocaleLowerCase("en").normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function score(destination: TravelDestination, query: string): number {
  const name = normalise(destination.name);
  const aliases = destination.aliases.map(normalise);
  if (aliases.includes(query)) return 0;
  if (name === query) return 1;
  if (name.startsWith(query)) return 2;
  if (name.split(" ").some((word) => word.startsWith(query))) return 3;
  const terms = query.split(" ");
  if (terms.every((term) => name.includes(term) || aliases.some((alias) => alias.includes(term)))) {
    return 4;
  }
  return Number.POSITIVE_INFINITY;
}

/** Stable, bounded autocomplete: exact aliases first, then names and token matches. */
export function searchTravelDestinations(
  query: string,
  limit = 8,
): readonly TravelDestination[] {
  const normalised = normalise(query);
  if (!normalised) return TRAVEL_DESTINATIONS.slice(0, limit);
  return TRAVEL_DESTINATIONS
    .map((candidate, index) => ({ candidate, index, score: score(candidate, normalised) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
