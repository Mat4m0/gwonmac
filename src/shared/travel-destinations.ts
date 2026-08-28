/**
 * Owns the canonical reviewed Travel catalogue.
 * Exposes the map-id allowlist used by certification and the UI.
 */

import { PIKEN_SQUARE_PRE_SEARING_MAP_ID } from "./travel-map-id.js";

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
 * Every reviewed destination that the normal four-word travel command can
 * reach. The catalogue stays available before game observation; character
 * unlock state is not guessed. The Deep and Urgoz's Warren are absent because
 * they use passage-scroll UI instead of this command path.
 */
export const TRAVEL_DESTINATIONS: readonly TravelDestination[] = Object.freeze([
  // Prophecies — pre-Searing
  destination(148, "Ascalon City (pre-Searing)", "Prophecies", ["pre ascalon"]),
  destination(164, "Ashford Abbey", "Prophecies"),
  destination(165, "Foible's Fair", "Prophecies"),
  destination(166, "Fort Ranik (pre-Searing)", "Prophecies", ["pre ranik"]),
  destination(163, "The Barradin Estate", "Prophecies", ["barradin estate"]),
  destination(PIKEN_SQUARE_PRE_SEARING_MAP_ID, "Piken Square (pre-Searing)", "Prophecies", ["pre piken"]),

  // Prophecies — towns and outposts
  destination(81, "Ascalon City", "Prophecies", ["ac", "ascalon"]),
  destination(55, "Lion's Arch", "Prophecies", ["la", "lions arch"]),
  destination(20, "Droknar's Forge", "Prophecies", ["droks", "droknars"]),
  destination(49, "Henge of Denravi", "Prophecies", ["denravi"]),
  destination(109, "The Amnoon Oasis", "Prophecies", ["amnoon"]),
  destination(85, "Ascalon Arena", "Prophecies"),
  destination(133, "Beacon's Perch", "Prophecies", ["beacons"]),
  destination(136, "Beetletun", "Prophecies"),
  destination(57, "Bergen Hot Springs", "Prophecies", ["bergen"]),
  destination(155, "Camp Rankor", "Prophecies"),
  destination(159, "Copperhammer Mines", "Prophecies", ["copperhammer"]),
  destination(206, "Deldrimor War Camp", "Prophecies", ["deldrimor"]),
  destination(154, "Destiny's Gorge", "Prophecies", ["destinys gorge"]),
  destination(140, "Druid's Overlook", "Prophecies", ["druids overlook"]),
  destination(35, "Ember Light Camp", "Prophecies"),
  destination(137, "Fishermen's Haven", "Prophecies", ["fishermens haven"]),
  destination(135, "Frontier Gate", "Prophecies"),
  destination(36, "Grendich Courthouse", "Prophecies", ["grendich"]),
  destination(152, "Heroes' Audience", "Prophecies", ["heroes audience"]),
  destination(132, "Ice Tooth Cave", "Prophecies"),
  destination(141, "Maguuma Stade", "Prophecies"),
  destination(157, "Marhan's Grotto", "Prophecies", ["marhans"]),
  destination(40, "Piken Square", "Prophecies", ["piken"]),
  destination(158, "Port Sledge", "Prophecies"),
  destination(142, "Quarrel Falls", "Prophecies"),
  destination(39, "Sardelac Sanitarium", "Prophecies", ["sardelac"]),
  destination(153, "Seeker's Passage", "Prophecies", ["seekers passage"]),
  destination(131, "Serenity Temple", "Prophecies"),
  destination(181, "Shiverpeak Arena", "Prophecies"),
  destination(138, "Temple of the Ages", "Prophecies", ["toa"]),
  destination(82, "Tomb of the Primeval Kings", "Prophecies", ["topk", "tomb"]),
  destination(156, "The Granite Citadel", "Prophecies", ["granite"]),
  destination(139, "Ventari's Refuge", "Prophecies", ["ventaris"]),
  destination(134, "Yak's Bend", "Prophecies", ["yaks"]),

  // Prophecies — mission outposts
  destination(123, "Abaddon's Mouth", "Prophecies", ["abaddons mouth"]),
  destination(38, "Augury Rock", "Prophecies", ["augury"]),
  destination(12, "Aurora Glade", "Prophecies"),
  destination(10, "Bloodstone Fen", "Prophecies"),
  destination(25, "Borlis Pass", "Prophecies"),
  destination(15, "D'Alessio Seaboard", "Prophecies", ["dalessio"]),
  destination(16, "Divinity Coast", "Prophecies"),
  destination(116, "Dunes of Despair", "Prophecies"),
  destination(118, "Elona Reach", "Prophecies"),
  destination(29, "Fort Ranik", "Prophecies"),
  destination(14, "Gates of Kryta", "Prophecies"),
  destination(124, "Hell's Precipice", "Prophecies", ["hells precipice"]),
  destination(22, "Ice Caves of Sorrow", "Prophecies"),
  destination(24, "Iron Mines of Moladune", "Prophecies"),
  destination(32, "Nolani Academy", "Prophecies"),
  destination(122, "Ring of Fire", "Prophecies"),
  destination(73, "Riverside Province", "Prophecies"),
  destination(30, "Ruins of Surmia", "Prophecies"),
  destination(19, "Sanctum Cay", "Prophecies"),
  destination(120, "The Dragon's Lair", "Prophecies", ["dragons lair"]),
  destination(21, "The Frost Gate", "Prophecies"),
  destination(28, "The Great Northern Wall", "Prophecies", ["great northern wall"]),
  destination(11, "The Wilds", "Prophecies"),
  destination(117, "Thirsty River", "Prophecies"),
  destination(23, "Thunderhead Keep", "Prophecies"),

  // Factions — towns and outposts
  destination(194, "Kaineng Center", "Factions", ["kc", "kaineng"]),
  destination(242, "Shing Jea Monastery", "Factions", ["shing jea", "sjm"]),
  destination(77, "House zu Heltzer", "Factions", ["hzh"]),
  destination(193, "Cavalon", "Factions"),
  destination(388, "Aspenwood Gate — Kurzick", "Factions", ["aspenwood gate kurzick"]),
  destination(389, "Aspenwood Gate — Luxon", "Factions", ["aspenwood gate luxon"]),
  destination(288, "Bai Paasu Reach", "Factions"),
  destination(286, "Brauer Academy", "Factions"),
  destination(278, "Breaker Hollow", "Factions"),
  destination(287, "Durheim Archives", "Factions"),
  destination(350, "Eredon Terrace", "Factions"),
  destination(277, "Harvest Temple", "Factions"),
  destination(390, "Jade Flats — Kurzick", "Factions", ["jade flats kurzick"]),
  destination(391, "Jade Flats — Luxon", "Factions", ["jade flats luxon"]),
  destination(279, "Leviathan Pits", "Factions"),
  destination(129, "Lutgardis Conservatory", "Factions", ["lutgardis"]),
  destination(283, "Maatu Keep", "Factions", ["maatu"]),
  destination(251, "Ran Musu Gardens", "Factions", ["ran musu"]),
  destination(349, "Saint Anjeka's Shrine", "Factions", ["saint anjekas"]),
  destination(289, "Seafarer's Rest", "Factions", ["seafarers rest"]),
  destination(250, "Seitung Harbor", "Factions"),
  destination(51, "Senji's Corner", "Factions", ["senjis"]),
  destination(243, "Shing Jea Arena", "Factions"),
  destination(348, "Tanglewood Copse", "Factions"),
  destination(303, "The Marketplace", "Factions", ["marketplace"]),
  destination(249, "Tsumei Village", "Factions"),
  destination(130, "Vasburg Armory", "Factions"),
  destination(284, "Zin Ku Corridor", "Factions"),

  // Factions — mission and challenge outposts
  destination(272, "Altrumm Ruins", "Factions"),
  destination(230, "Amatz Basin", "Factions"),
  destination(218, "Arborstone", "Factions"),
  destination(219, "Boreas Seabed", "Factions"),
  destination(274, "Dragon's Throat", "Factions", ["dragons throat"]),
  destination(294, "Fort Aspenwood — Kurzick", "Factions", ["fa kurzick", "fa"]),
  destination(293, "Fort Aspenwood — Luxon", "Factions", ["fa luxon"]),
  destination(224, "Gyala Hatchery", "Factions"),
  destination(226, "Imperial Sanctum", "Factions"),
  destination(214, "Minister Cho's Estate", "Factions", ["minister chos"]),
  destination(216, "Nahpui Quarter", "Factions"),
  destination(225, "Raisu Palace", "Factions"),
  destination(220, "Sunjiang District", "Factions"),
  destination(217, "Tahnnakai Temple", "Factions"),
  destination(234, "The Aurios Mines", "Factions", ["aurios"]),
  destination(222, "The Eternal Grove", "Factions", ["eternal grove"]),
  destination(296, "The Jade Quarry — Kurzick", "Factions", ["jq kurzick", "jq"]),
  destination(295, "The Jade Quarry — Luxon", "Factions", ["jq luxon"]),
  destination(298, "Unwaking Waters — Kurzick", "Factions", ["unwaking kurzick"]),
  destination(297, "Unwaking Waters — Luxon", "Factions", ["unwaking luxon"]),
  destination(292, "Vizunah Square — Foreign Quarter", "Factions", ["vizunah foreign", "vs foreign"]),
  destination(291, "Vizunah Square — Local Quarter", "Factions", ["vizunah local", "vs local"]),
  destination(213, "Zen Daijun", "Factions"),
  destination(273, "Zos Shivros Channel", "Factions", ["zos shivros"]),

  // Factions — hidden competitive outposts
  destination(335, "Etnaran Keys — Luxon", "Factions", ["etnaran luxon"]),
  destination(336, "Etnaran Keys — Kurzick", "Factions", ["etnaran kurzick"]),
  destination(331, "Grenz Frontier — Luxon", "Factions", ["grenz luxon"]),
  destination(332, "Grenz Frontier — Kurzick", "Factions", ["grenz kurzick"]),
  destination(337, "Kaanai Canyon — Luxon", "Factions", ["kaanai luxon"]),
  destination(338, "Kaanai Canyon — Kurzick", "Factions", ["kaanai kurzick"]),
  destination(328, "Saltspray Beach — Luxon", "Factions", ["saltspray luxon"]),
  destination(329, "Saltspray Beach — Kurzick", "Factions", ["saltspray kurzick"]),
  destination(333, "The Ancestral Lands — Luxon", "Factions", ["ancestral lands luxon"]),
  destination(334, "The Ancestral Lands — Kurzick", "Factions", ["ancestral lands kurzick"]),

  // Nightfall — towns and outposts
  destination(449, "Kamadan, Jewel of Istan", "Nightfall", ["kama", "kamadan"]),
  destination(387, "Sunspear Sanctuary", "Nightfall", ["sunspear"]),
  destination(414, "The Kodash Bazaar", "Nightfall", ["kodash"]),
  destination(450, "Gate of Torment", "Nightfall"),
  destination(398, "Basalt Grotto", "Nightfall"),
  destination(457, "Beknur Harbor", "Nightfall"),
  destination(438, "Bone Palace", "Nightfall"),
  destination(376, "Camp Hojanu", "Nightfall"),
  destination(479, "Champion's Dawn", "Nightfall", ["champions dawn"]),
  destination(393, "Chantry of Secrets", "Nightfall", ["chantry"]),
  destination(469, "Gate of Fear", "Nightfall"),
  destination(473, "Gate of Secrets", "Nightfall"),
  destination(559, "Gate of the Nightfallen Lands", "Nightfall", ["nightfallen lands"]),
  destination(403, "Honur Hill", "Nightfall"),
  destination(489, "Kodlonu Hamlet", "Nightfall"),
  destination(442, "Lair of the Forgotten", "Nightfall"),
  destination(396, "Mihanu Township", "Nightfall"),
  destination(497, "Sunspear Arena", "Nightfall"),
  destination(431, "Sunspear Great Hall", "Nightfall"),
  destination(502, "The Astralarium", "Nightfall"),
  destination(440, "The Mouth of Torment", "Nightfall"),
  destination(378, "Wehhan Terraces", "Nightfall"),
  destination(407, "Yahnur Market", "Nightfall"),
  destination(381, "Yohlon Haven", "Nightfall"),

  // Nightfall — mission and challenge outposts
  destination(496, "Abaddon's Gate", "Nightfall", ["abaddons gate"]),
  destination(492, "Blacktide Den", "Nightfall"),
  destination(544, "Chahbek Village", "Nightfall"),
  destination(493, "Consulate Docks", "Nightfall", ["consulate"]),
  destination(554, "Dajkah Inlet", "Nightfall"),
  destination(434, "Dasha Vestibule", "Nightfall"),
  destination(433, "Dzagonur Bastion", "Nightfall"),
  destination(474, "Gate of Anguish (Domain of Anguish)", "Nightfall", ["doa", "goa", "tdp", "domain of anguish"]),
  destination(478, "Gate of Desolation", "Nightfall"),
  destination(495, "Gate of Madness", "Nightfall"),
  destination(494, "Gate of Pain", "Nightfall"),
  destination(435, "Grand Court of Sebelkeh", "Nightfall", ["sebelkeh"]),
  destination(476, "Jennur's Horde", "Nightfall", ["jennurs"]),
  destination(491, "Jokanur Diggings", "Nightfall"),
  destination(424, "Kodonur Crossroads", "Nightfall"),
  destination(427, "Moddok Crevice", "Nightfall"),
  destination(477, "Nundu Bay", "Nightfall"),
  destination(426, "Pogahn Passage", "Nightfall"),
  destination(545, "Remains of Sahlahja", "Nightfall", ["sahlahja"]),
  destination(425, "Rilohn Refuge", "Nightfall"),
  destination(480, "Ruins of Morah", "Nightfall"),
  destination(555, "The Shadow Nexus", "Nightfall", ["shadow nexus"]),
  destination(428, "Tihark Orchard", "Nightfall"),
  destination(421, "Venta Cemetery", "Nightfall"),

  // Eye of the North
  destination(642, "Eye of the North", "Eye of the North", ["eotn"]),
  destination(640, "Rata Sum", "Eye of the North", ["rata"]),
  destination(624, "Vlox's Falls", "Eye of the North", ["vlox"]),
  destination(675, "Boreal Station", "Eye of the North", ["boreal"]),
  destination(638, "Gadd's Encampment", "Eye of the North", ["gadds"]),
  destination(639, "Umbral Grotto", "Eye of the North", ["umbral"]),
  destination(641, "Tarnished Haven", "Eye of the North", ["tarnished"]),
  destination(643, "Sifhalla", "Eye of the North"),
  destination(644, "Gunnar's Hold", "Eye of the North", ["gunnars"]),
  destination(645, "Olafstead", "Eye of the North"),
  destination(648, "Doomlore Shrine", "Eye of the North", ["doomlore"]),
  destination(650, "Longeye's Ledge", "Eye of the North", ["longeyes"]),
  destination(652, "Central Transfer Chamber", "Eye of the North", ["ctc"]),

  // Battle Isles and seasonal competitive outposts
  destination(857, "Embark Beach", "Battle Isles", ["embark"]),
  destination(248, "Great Temple of Balthazar", "Battle Isles", ["gtob"]),
  destination(188, "Random Arenas", "Battle Isles", ["ra"]),
  destination(330, "Heroes' Ascent", "Battle Isles", ["ha"]),
  destination(796, "Codex Arena", "Battle Isles", ["codex"]),
  destination(721, "Costume Brawl", "Battle Isles"),
  destination(368, "Dragon Arena", "Battle Isles"),
  destination(467, "Rollerbeetle Racing", "Battle Isles", ["rollerbeetle"]),
  destination(281, "Zaishen Challenge", "Battle Isles", ["zc"]),
  destination(282, "Zaishen Elite", "Battle Isles", ["ze"]),
  destination(795, "Zaishen Menagerie", "Battle Isles", ["menagerie"]),
]);

const PRE_SEARING_MAP_IDS: readonly number[] = Object.freeze([
  148, 164, 165, 166, 163, PIKEN_SQUARE_PRE_SEARING_MAP_ID,
]);

/**
 * Returns the destination group that is useful around the current outpost.
 * Cross-campaign unlocks (especially the Battle Isles) must not make a small
 * early-game catalogue look large. Pre-Searing is kept separate from the rest
 * of Prophecies because its characters cannot cross the Searing boundary.
 */
export function travelBrowseScope(currentMapId: number): readonly TravelDestination[] {
  const current = travelDestination(currentMapId);
  if (current === null) return [];
  const preSearing = PRE_SEARING_MAP_IDS.includes(currentMapId);
  return TRAVEL_DESTINATIONS.filter((candidate) =>
    preSearing
      ? PRE_SEARING_MAP_IDS.includes(candidate.mapId)
      : candidate.campaign === current.campaign
        && !PRE_SEARING_MAP_IDS.includes(candidate.mapId)
  );
}

export function travelDestination(mapId: number): TravelDestination | null {
  return TRAVEL_DESTINATIONS.find((candidate) => candidate.mapId === mapId) ?? null;
}
