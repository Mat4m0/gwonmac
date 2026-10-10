/**
 * Synthetic progress for the Hub browser fixture. The map ids and names are
 * the repository's own catalogues; the AreaInfo fields (type, flags, region,
 * world-map position) are invented, so no game-file data ships here.
 */
import { guildWarsMapName } from '../../../src/shared/guild-wars-map-names';
import { TRAVEL_DESTINATIONS } from '../../../src/shared/travel';
import type { AreaRow, GameProgressState, ProgressBits } from '../../../src/shared/game-progress';

const MISSION = 5;
const EXPLORABLE = 2;
const VANQUISHABLE = 0x1000_0000;

type Campaign = Readonly<{ game: 1 | 2 | 3 | 4; continent: number; missions: readonly (readonly [string, number])[]; areas: readonly (readonly [string, number])[] }>;

/** [name, region] pairs; region ids follow `REGION_NAMES` in game-progress.ts. */
const CAMPAIGNS: readonly Campaign[] = [
  { game: 1, continent: 0,
    missions: [['The Great Northern Wall', 2], ['Fort Ranik', 2], ['Ruins of Surmia', 2], ['Nolani Academy', 2], ['Borlis Pass', 3], ['The Frost Gate', 3], ['Gates of Kryta', 0], ['DAlessio Seaboard', 0], ['Divinity Coast', 0], ['The Wilds', 1], ['Bloodstone Fen', 1], ['Aurora Glade', 1], ['Riverside Province', 0], ['Sanctum Cay', 0], ['Dunes of Despair', 5], ['Thirsty River', 5], ['Elona Reach', 5], ['Augury Rock', 5]],
    areas: [['Old Ascalon', 2], ['Diessa Lowlands', 2], ['Regent Valley', 2], ['Kessex Peak', 0], ['Talmark Wilderness', 0], ['Scoundrels Rise', 0], ['North Kryta Province', 0], ['Mamnoon Lagoon', 1], ['Sage Lands', 1], ['Dry Top', 1], ['Prophets Path', 5], ['Salt Flats', 5], ['Lornars Pass', 3], ['Dreadnoughts Drift', 3]] },
  { game: 2, continent: 1,
    missions: [['Minister Chos Estate', 11], ['Zen Daijun', 11], ['Nahpui Quarter', 8], ['Tahnnakai Temple', 8], ['Arborstone', 9], ['Boreas Seabed', 10], ['Sunjiang District', 8], ['The Eternal Grove', 9], ['Gyala Hatchery', 10], ['Unwaking Waters', 10], ['Raisu Palace', 8], ['Imperial Sanctum', 8]],
    areas: [['Haiju Lagoon', 11], ['Jaya Bluffs', 11], ['Kinya Province', 11], ['Panjiang Peninsula', 11], ['Saoshang Trail', 11], ['Sunqua Vale', 11], ['Bukdek Byway', 8], ['Pongmei Valley', 8], ['Ferndale', 9], ['Morostav Trail', 9], ['Archipelagos', 10], ['Maishang Hills', 10]] },
  { game: 3, continent: 2,
    missions: [['Chahbek Village', 15], ['Jokanur Diggings', 15], ['Blacktide Den', 15], ['Consulate Docks', 15], ['Venta Cemetery', 12], ['Kodonur Crossroads', 12], ['Pogahn Passage', 12], ['Rilohn Refuge', 12], ['Moddok Crevice', 12], ['Tihark Orchard', 13], ['Dasha Vestibule', 13], ['Dzagonur Bastion', 13], ['Grand Court of Sebelkeh', 13], ['Jennurs Horde', 14], ['Nundu Bay', 13]],
    areas: [['Zehlon Reach', 15], ['Lahtenda Bog', 15], ['Mehtani Keys', 15], ['Plains of Jarin', 15], ['Cliffs of Dohjok', 15], ['Fahranur, the First City', 15], ['Issnur Isles', 15], ['Arkjok Ward', 12], ['Sunward Marches', 12], ['Gandara, the Moon Fortress', 12], ['Vehtendi Valley', 13], ['Forum Highlands', 13]] },
  { game: 4, continent: 0,
    missions: [],
    areas: [['Ice Cliff Chasms', 19], ['Norrhart Domains', 19], ['Drakkar Lake', 19], ['Varajar Fells', 19], ['Bjora Marches', 19], ['Jaga Moraine', 19], ['Grothmar Wardowns', 20], ['Sacnoth Valley', 20], ['Dalada Uplands', 20], ['Alcazia Tangle', 17], ['Magus Stones', 17], ['Riven Earth', 17], ['Arbor Bay', 17], ['Sparkfly Swamp', 17], ['Verdant Cascades', 17]] },
];

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
/** Map ids by name, from the repository's map identifiers. The catalogue names a few places twice; the first wins. */
const ids = (() => {
  const byName = new Map<string, number>();
  for (let mapId = 1; mapId < 900; mapId += 1) {
    const name = key(guildWarsMapName(mapId).replace(/ (outpost|mission)$/iu, ''));
    if (!name.startsWith('unknown map') && !byName.has(name)) byName.set(name, mapId);
  }
  return byName;
})();

function rows(): AreaRow[] {
  const out = new Map<number, AreaRow>();
  const add = (mapId: number, game: number, continent: number, region: number, type: number, flags: number, thumbnail: boolean, index: number) => {
    // Positions spread each region over its own patch of the invented world map.
    out.set(mapId, { mapId, campaign: game, continent, region, type, flags, thumbnail, nameId: 10_000 + mapId, x: region * 1_000 + (index % 5) * 150, y: region * 600 + Math.floor(index / 5) * 150 });
  };
  for (const campaign of CAMPAIGNS) {
    campaign.missions.forEach(([name, region], index) => {
      const mapId = ids.get(key(name));
      if (mapId !== undefined) add(mapId, campaign.game, campaign.continent, region, MISSION, 0, true, index);
    });
    campaign.areas.forEach(([name, region], index) => {
      const mapId = ids.get(key(name));
      if (mapId !== undefined) add(mapId, campaign.game, campaign.continent, region, EXPLORABLE, VANQUISHABLE, false, index + 3);
    });
  }
  const games = { Prophecies: 1, Factions: 2, Nightfall: 3, 'Eye of the North': 4 } as const;
  TRAVEL_DESTINATIONS.forEach((destination, index) => {
    if (out.has(destination.mapId) || !(destination.campaign in games)) return;
    const game = games[destination.campaign as keyof typeof games];
    const campaign = CAMPAIGNS[game - 1]!;
    add(destination.mapId, game, campaign.continent, game === 4 ? 19 : [2, 8, 15][game - 1]!, 4, 0, false, index % 20);
  });
  return [...out.values()].sort((a, b) => a.mapId - b.mapId);
}

function bits(mapIds: Iterable<number>): ProgressBits {
  const words = Array.from({ length: 28 }, () => 0);
  for (const mapId of mapIds) words[mapId >>> 5]! |= 1 << (mapId & 31);
  return words.map(word => word >>> 0);
}

/** A character about halfway through Tyria and Cantha and early in Elona. */
export function progressFixture(mapId: number): GameProgressState {
  const areas = rows();
  const of = (game: number, type: number) => areas.filter(row => row.campaign === game && row.type === type).map(row => row.mapId);
  const every = (list: readonly number[], keep: number) => list.filter((_, index) => index % keep !== keep - 1);
  const missions = [...of(1, MISSION), ...of(2, MISSION), ...of(3, MISSION).slice(0, 5)];
  const completed = every(missions, 4);
  const bonus = every(completed, 3);
  const completedHm = completed.slice(0, 6);
  const bonusHm = completedHm.slice(0, 3);
  const vanquished = [...every(of(1, EXPLORABLE), 2), ...of(2, EXPLORABLE).slice(0, 4), ...of(4, EXPLORABLE).slice(0, 2)];
  return {
    status: 'ready', sequence: 2, mapId, characterKey: '00000000000000aa',
    missions: { completed: bits(completed), bonus: bits(bonus), completedHm: bits(completedHm), bonusHm: bits(bonusHm) },
    vanquished: bits(vanquished),
    cartographer: [72.4, 41.5, 18.9],
    areas,
  };
}
