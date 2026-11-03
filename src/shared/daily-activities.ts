/**
 * Owns the offline schedule of Guild Wars daily activities: which Zaishen
 * quest, Shining Blade target, Vanguard quest and Nicholas Sandford item is
 * active at any instant. Every activity walks a fixed list, one step per day,
 * so each rotation is stored as its ordered list plus one wiki-documented
 * anchor and read with whole-day modular arithmetic.
 *
 * It refuses to fetch anything and holds no other state, so the Dailies tab
 * works without a network. If ArenaNet ever changes a list, the lists below
 * are the only thing to edit; the wiki's Daily activities table is the check.
 */

export type DailyCategory =
  | "zaishenMission"
  | "zaishenBounty"
  | "zaishenCombat"
  | "zaishenVanquish"
  | "shiningBlade"
  | "vanguardQuest"
  | "nicholasSandford";

export interface DailyActivity {
  readonly category: DailyCategory;
  readonly label: string;
  readonly title: string;
}

/** One rotation day. Quests change at 16:00 UTC, so a day runs 16:00 to 16:00. */
export interface DailyDay {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly activities: readonly DailyActivity[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// https://wiki.guildwars.com/wiki/Daily_activities: "Quests change daily at
// 16:00 UTC; Sandford's requests change at 7:00 UTC". The wiki's table labels
// a row with the date its quests start, so row "2 November" is active from
// 2 November 16:00 UTC until 3 November 16:00 UTC (checked against the live
// "current quest" line on each rotation page).
const QUEST_RESET_HOUR_UTC = 16;

interface Rotation {
  readonly category: DailyCategory;
  readonly label: string;
  /** The instant `entries[0]` starts, which is also that rotation's reset hour. */
  readonly anchor: number;
  readonly entries: readonly string[];
}

const utc = (iso: string): number => Date.parse(iso);

// https://wiki.guildwars.com/wiki/Zaishen_Mission/cycles (69 days; the current
// cycle starts with Augury Rock on 2011-03-03).
const ZAISHEN_MISSION: readonly string[] = [
  "Augury Rock", "Grand Court of Sebelkeh", "Ice Caves of Sorrow", "Raisu Palace",
  "Gate of Desolation", "Thirsty River", "Blacktide Den", "Against the Charr",
  "Abaddon's Mouth", "Nundu Bay", "Divinity Coast", "Zen Daijun", "Pogahn Passage",
  "Tahnnakai Temple", "The Great Northern Wall", "Dasha Vestibule", "The Wilds",
  "Unwaking Waters", "Chahbek Village", "Aurora Glade", "A Time for Heroes",
  "Consulate Docks", "Ring of Fire", "Nahpui Quarter", "The Dragon's Lair",
  "Dzagonur Bastion", "D'Alessio Seaboard", "Assault on the Stronghold",
  "The Eternal Grove", "Sanctum Cay", "Rilohn Refuge", "Warband of Brothers",
  "Borlis Pass", "Imperial Sanctum", "Moddok Crevice", "Nolani Academy",
  "Destruction's Depths", "Venta Cemetery", "Fort Ranik", "A Gate Too Far",
  "Minister Cho's Estate", "Thunderhead Keep", "Tihark Orchard",
  "Finding the Bloodstone", "Dunes of Despair", "Vizunah Square", "Jokanur Diggings",
  "Iron Mines of Moladune", "Kodonur Crossroads", "G.O.L.E.M.", "Arborstone",
  "Gates of Kryta", "Gate of Madness", "The Elusive Golemancer", "Riverside Province",
  "Boreas Seabed", "Ruins of Morah", "Hell's Precipice", "Ruins of Surmia",
  "Curse of the Nornbear", "Sunjiang District", "Elona Reach", "Gate of Pain",
  "Blood Washes Blood", "Bloodstone Fen", "Jennur's Horde", "Gyala Hatchery",
  "Abaddon's Gate", "The Frost Gate",
];

// https://wiki.guildwars.com/wiki/Zaishen_Bounty/cycles (66 days; the current
// cycle starts with Droajam, Mage of the Sands on 2009-06-11).
const ZAISHEN_BOUNTY: readonly string[] = [
  "Droajam, Mage of the Sands", "Royen Beastkeeper", "Eldritch Ettin", "Vengeful Aatxe",
  "Fronis Irontoe", "Urgoz", "Fenrir", "Selvetarm", "Mohby Windbeak",
  "Charged Blackness", "Rotscale", "Zoldark the Unholy", "Korshek the Immolated",
  "Myish, Lady of the Lake", "Frostmaw the Kinslayer", "Kunvie Firewing", "Z'him Monns",
  "The Greater Darkness", "TPS Regulator Golem", "Plague of Destruction",
  "The Darknesses", "Admiral Kantoh", "Borrguus Blisterbark", "Forgewight",
  "Baubao Wavewrath", "Joffs the Mitigator", "Rragar Maneater", "Chung, the Attuned",
  "Lord Jadoth", "Nulfastu, Earthbound", "The Iron Forgeman", "Magmus",
  "Mobrin, Lord of the Marsh", "Jarimiya the Unmerciful", "Duncan the Black",
  "Quansong Spiritspeak", "The Stygian Underlords", "Fozzy Yeoryios",
  "The Black Beast of Arrgh", "Arachni", "The Four Horsemen", "Remnant of Antiquities",
  "Arbor Earthcall", "Prismatic Ooze", "Lord Khobay", "Jedeh the Mighty",
  "Ssuns, Blessed of Dwayna", "Justiciar Thommis", "Harn and Maxine Coldstone",
  "Pywatt the Swift", "Fendi Nin", "Mungri Magicbox", "Priest of Menzies",
  "Ilsundur, Lord of Fire", "Kepkhet Marrowfeast", "Commander Wahli", "Kanaxai",
  "Khabuus", "Molotov Rocktail", "The Stygian Lords", "Dragon Lich", "Havok Soulwail",
  "Ghial the Bone Dancer", "Murakai, Lady of the Night", "Rand Stormweaver", "Verata",
];

// https://wiki.guildwars.com/wiki/Zaishen_Combat/cycles states a 28-day
// rotation but lists dates per quest, not an order. The order is read from the
// consecutive rows of https://wiki.guildwars.com/wiki/Daily_activities starting
// 2026-10-30; the same table repeats it 28 days later, and the cycles page's
// "Jade Quarry 2012-02-09" falls on this cycle's Jade Quarry day (2026-11-26).
const ZAISHEN_COMBAT: readonly string[] = [
  "Codex Arena", "Heroes' Ascent", "Guild Versus Guild", "Alliance Battles",
  "Heroes' Ascent", "Guild Versus Guild", "Codex Arena", "Fort Aspenwood",
  "Jade Quarry", "Random Arena", "Codex Arena", "Guild Versus Guild", "Jade Quarry",
  "Alliance Battles", "Heroes' Ascent", "Random Arena", "Fort Aspenwood",
  "Jade Quarry", "Random Arena", "Fort Aspenwood", "Heroes' Ascent",
  "Alliance Battles", "Guild Versus Guild", "Codex Arena", "Random Arena",
  "Fort Aspenwood", "Alliance Battles", "Jade Quarry",
];

// https://wiki.guildwars.com/wiki/Zaishen_Vanquish/cycles (136 days; position 1,
// Jaya Bluffs, falls on 2017-02-15).
const ZAISHEN_VANQUISH: readonly string[] = [
  "Jaya Bluffs", "Holdings of Chokhin", "Ice Cliff Chasms", "Griffon's Mouth",
  "Kinya Province", "Issnur Isles", "Jaga Moraine", "Ice Floe", "Maishang Hills",
  "Jahai Bluffs", "Riven Earth", "Icedome", "Minister Cho's Estate", "Mehtani Keys",
  "Sacnoth Valley", "Iron Horse Mine", "Morostav Trail", "Plains of Jarin",
  "Sparkfly Swamp", "Kessex Peak", "Mourning Veil Falls", "The Alkali Pan",
  "Varajar Fells", "Lornar's Pass", "Pongmei Valley", "The Floodplain of Mahnkelon",
  "Verdant Cascades", "Majesty's Rest", "Raisu Palace", "The Hidden City of Ahdashim",
  "Rhea's Crater", "Mamnoon Lagoon", "Shadow's Passage", "The Mirror of Lyss",
  "Saoshang Trail", "Nebo Terrace", "Shenzun Tunnels", "The Ruptured Heart",
  "Salt Flats", "North Kryta Province", "Silent Surf", "The Shattered Ravines",
  "Scoundrel's Rise", "Old Ascalon", "Sunjiang District", "The Sulfurous Wastes",
  "Magus Stones", "Perdition Rock", "Sunqua Vale", "Turai's Procession",
  "Norrhart Domains", "Pockmark Flats", "Tahnnakai Temple", "Vehjin Mines",
  "Poisoned Outcrops", "Prophet's Path", "The Eternal Grove", "Tasca's Demise",
  "Resplendent Makuun", "Reed Bog", "Unwaking Waters", "Stingray Strand",
  "Sunward Marches", "Regent Valley", "Wajjun Bazaar", "Yatendi Canyons",
  "Twin Serpent Lakes", "Sage Lands", "Xaquang Skyway", "Zehlon Reach", "Tangle Root",
  "Silverwood", "Zen Daijun", "The Arid Sea", "Nahpui Quarter", "Skyward Reach",
  "The Scar", "The Black Curtain", "Panjiang Peninsula", "Snake Dance",
  "Traveler's Vale", "The Breach", "Lahtenda Bog", "Spearhead Peak", "Mount Qinkai",
  "Marga Coast", "Melandru's Hope", "The Falls", "Joko's Domain", "Vulture Drifts",
  "Wilderness of Bahdza", "Talmark Wilderness", "Vehtendi Valley", "Talus Chute",
  "Mineral Springs", "Anvil Rock", "Arborstone", "Witman's Folly", "Arkjok Ward",
  "Ascalon Foothills", "Bahdok Caverns", "Cursed Lands", "Alcazia Tangle",
  "Archipelagos", "Eastern Frontier", "Dejarin Estate", "Watchtower Coast",
  "Arbor Bay", "Barbarous Shore", "Deldrimor Bowl", "Boreas Seabed",
  "Cliffs of Dohjok", "Diessa Lowlands", "Bukdek Byway", "Bjora Marches",
  "Crystal Overlook", "Diviner's Ascent", "Dalada Uplands", "Drazach Thicket",
  "Fahranur, the First City", "Dragon's Gullet", "Ferndale", "Forum Highlands",
  "Dreadnought's Drift", "Drakkar Lake", "Dry Top", "Tears of the Fallen",
  "Gyala Hatchery", "Ettin's Back", "Gandara, the Moon Fortress", "Grothmar Wardowns",
  "Flame Temple Corridor", "Haiju Lagoon", "Frozen Forest", "Garden of Seborhin",
  "Grenth's Footprint",
];

// Order: https://wiki.guildwars.com/wiki/Wanted_by_the_Shining_Blade (21
// targets, one per day). The page names no anchor; position 1 falls on
// 2026-10-30 in https://wiki.guildwars.com/wiki/Daily_activities.
const SHINING_BLADE: readonly string[] = [
  "Insatiable Vakar", "Amalek the Unmerciful", "Carnak the Hungry", "Valis the Rampant",
  "Cerris", "Sarnia the Red-Handed", "Destor the Truth Seeker", "Selenas the Blunt",
  "Justiciar Amilyn", "Maximilian the Meticulous", "Joh the Hostile",
  "Barthimus the Provident", "Calamitous", "Greves the Overbearing", "Lev the Condemned",
  "Justiciar Marron", "Justiciar Kasandra", "Vess the Disputant", "Justiciar Kimii",
  "Zaln the Jaded", "Justiciar Sevaan",
];

// Order: https://wiki.guildwars.com/wiki/Vanguard_quest (a cycle of nine daily
// quests). Titles are the target names the Daily activities table shows. The
// page names no anchor; "Bandits" (Vanguard Annihilation: Bandits) falls on
// 2026-11-03 in https://wiki.guildwars.com/wiki/Daily_activities.
const VANGUARD_QUEST: readonly string[] = [
  "Bandits", "Utini Wupwup", "Ascalonian Noble", "Undead", "Blazefiend Griefblade",
  "Farmer Hamnet", "Charr", "Countess Nadya", "Footman Tate",
];

// https://wiki.guildwars.com/wiki/Nicholas_Sandford/cycles (52 days; the
// current cycle started with Grawl Necklace on 2026-07-01). Names follow the
// plural spelling of the Daily activities table.
const NICHOLAS_SANDFORD: readonly string[] = [
  "Grawl Necklaces", "Baked Husks", "Skeletal Limbs", "Unnatural Seeds",
  "Enchanted Lodestones", "Skale Fins", "Icy Lodestones", "Gargoyle Skulls",
  "Dull Carapaces", "Baked Husks", "Red Iris Flowers", "Spider Legs", "Skeletal Limbs",
  "Charr Carvings", "Enchanted Lodestones", "Grawl Necklaces", "Icy Lodestones",
  "Worn Belts", "Gargoyle Skulls", "Unnatural Seeds", "Skale Fins", "Red Iris Flowers",
  "Enchanted Lodestones", "Skeletal Limbs", "Charr Carvings", "Spider Legs",
  "Baked Husks", "Gargoyle Skulls", "Unnatural Seeds", "Icy Lodestones",
  "Grawl Necklaces", "Enchanted Lodestones", "Worn Belts", "Dull Carapaces",
  "Spider Legs", "Gargoyle Skulls", "Icy Lodestones", "Unnatural Seeds", "Worn Belts",
  "Grawl Necklaces", "Baked Husks", "Skeletal Limbs", "Red Iris Flowers",
  "Charr Carvings", "Skale Fins", "Dull Carapaces", "Enchanted Lodestones",
  "Charr Carvings", "Spider Legs", "Red Iris Flowers", "Worn Belts", "Dull Carapaces",
];

// Category order here is the order of every `activities` list.
const ROTATIONS: readonly Rotation[] = [
  { category: "zaishenMission", label: "Zaishen Mission", anchor: utc("2011-03-03T16:00:00Z"), entries: ZAISHEN_MISSION },
  { category: "zaishenBounty", label: "Zaishen Bounty", anchor: utc("2009-06-11T16:00:00Z"), entries: ZAISHEN_BOUNTY },
  { category: "zaishenCombat", label: "Zaishen Combat", anchor: utc("2026-10-30T16:00:00Z"), entries: ZAISHEN_COMBAT },
  { category: "zaishenVanquish", label: "Zaishen Vanquish", anchor: utc("2017-02-15T16:00:00Z"), entries: ZAISHEN_VANQUISH },
  { category: "shiningBlade", label: "Shining Blade", anchor: utc("2026-10-30T16:00:00Z"), entries: SHINING_BLADE },
  { category: "vanguardQuest", label: "Vanguard Quest", anchor: utc("2026-11-03T16:00:00Z"), entries: VANGUARD_QUEST },
  // Sandford changes nine hours before the quests, so his list is anchored to
  // its own 07:00 UTC boundary.
  { category: "nicholasSandford", label: "Nicholas Sandford", anchor: utc("2026-07-01T07:00:00Z"), entries: NICHOLAS_SANDFORD },
];

function entryAt(rotation: Rotation, at: number): DailyActivity {
  const days = Math.floor((at - rotation.anchor) / DAY_MS);
  const length = rotation.entries.length;
  const title = rotation.entries[((days % length) + length) % length];
  if (title === undefined) throw new Error(`Empty rotation: ${rotation.category}`);
  return { category: rotation.category, label: rotation.label, title };
}

/** Start of the 16:00 UTC rotation day containing `at`. */
function dayStart(at: number): number {
  const reset = QUEST_RESET_HOUR_UTC * HOUR_MS;
  return Math.floor((at - reset) / DAY_MS) * DAY_MS + reset;
}

/**
 * Sandford changes at 07:00 UTC, inside the 16:00 day, so a day cannot hold
 * one fixed item for him. Each day reports the item active at `sandfordAt`:
 * the caller's own instant for the first day, the day's 16:00 start for later
 * days (the item that is current when that day's quests change).
 */
function buildDay(startsAt: number, sandfordAt: number): DailyDay {
  return {
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + DAY_MS),
    activities: ROTATIONS.map((rotation) =>
      entryAt(rotation, rotation.category === "nicholasSandford" ? sandfordAt : startsAt)),
  };
}

/** The rotation day that contains `at`. Activities in the category order above. */
export function dailyDayAt(at: Date): DailyDay {
  return buildDay(dayStart(at.getTime()), at.getTime());
}

/** `count` consecutive rotation days starting with the one that contains `at`. */
export function dailyDaysFrom(at: Date, count: number): readonly DailyDay[] {
  const first = dayStart(at.getTime());
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) =>
    index === 0 ? dailyDayAt(at) : buildDay(first + index * DAY_MS, first + index * DAY_MS));
}
