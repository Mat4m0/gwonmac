/**
 * The client's own skill table, read out of the player's own client build.
 *
 * Roughly 3,400 records of 164 bytes, indexed by skill id, sitting in the
 * WASM's static data. Every skill the game knows, with the profession,
 * attribute, elite flag and costs the build library needs — read from the
 * binary the player is actually running, so it can never drift from it.
 *
 * ## Why this is found rather than pinned
 *
 * The table's address is build-specific, exactly like the `Layout` offsets in
 * `src/companion-kernel/`. But unlike those, it does not need live evidence to
 * locate: the table has a *shape* no other data in the binary has, and
 * `findSkillTable` searches for that shape rather than trusting a constant. A
 * new ArenaNet build moves the table and this still finds it — which is also
 * why it is unbothered by the Enhancement transform shifting the segment.
 *
 * The signature is composite on purpose. Any one field is noise — a scan for
 * "plausible icon file ids" alone returned 2,559 false windows, one of which
 * looked convincing until its records were printed. Four weak fields together
 * are specific: ids ascending, campaign small, profession within range, and
 * attribute either a real attribute or the sentinel.
 *
 * The scan runs once per client build, behind the memo in `skill-catalogue.ts`.
 */

/** GWCA's `Skill`, `static_assert(sizeof(Skill) == 0xa4)`. */
export const SKILL_RECORD_BYTES = 164;

const FIELD = {
  skillId: 0x00,
  campaign: 0x08,
  type: 0x0c,
  special: 0x10,
  profession: 0x28,
  attribute: 0x29,
  title: 0x2a,
  pvpReplacement: 0x2c,
  equipType: 0x33,
  overcast: 0x34,
  energy: 0x35,
  health: 0x36,
  adrenaline: 0x38,
  activation: 0x3c,
  aftercast: 0x40,
  duration0: 0x44,
  duration15: 0x48,
  recharge: 0x4c,
  skillArguments: 0x58,
  scale0: 0x5c,
  scale15: 0x60,
  bonusScale0: 0x64,
  bonusScale15: 0x68,
  iconFileId: 0x8c,
  iconFileId2: 0x90,
  iconFileIdHiRes: 0x94,
  name: 0x98,
  concise: 0x9c,
  description: 0xa0,
} as const;

/** `special & 0x4`. The client's own test, and what draws the corner marker. */
const ELITE = 0x4;
/** The byte at 0x34 is meaningful only for skills carrying this flag. */
const HAS_OVERCAST = 0x1;
/** `Skill::IsPlayable()`: unset means a player can equip the record. */
const NOT_PLAYABLE = 0x02000000;
const PVP = 0x00400000;
const PVE = 0x00080000;

export interface SkillRecord {
  readonly id: number;
  readonly campaign: number;
  readonly type: number;
  readonly elite: boolean;
  readonly playable: boolean;
  readonly pvp: boolean;
  readonly pve: boolean;
  readonly profession: number;
  readonly attribute: number;
  readonly title: number;
  readonly pvpReplacement: number;
  readonly equipType: number;
  readonly overcast: number;
  readonly energyCost: number;
  readonly healthCost: number;
  readonly adrenalineCost: number;
  readonly activationSeconds: number;
  readonly aftercastSeconds: number;
  readonly duration0: number;
  readonly duration15: number;
  readonly rechargeSeconds: number;
  readonly skillArguments: number;
  readonly scale0: number;
  readonly scale15: number;
  readonly bonusScale0: number;
  readonly bonusScale15: number;
  /** Archive file id of the 32×32 icon, or 0 for the handful that have none. */
  readonly iconFileId: number;
  readonly iconFileIdHiRes: number;
  /** String id, not text. Resolving it is a separate table this does not read. */
  readonly nameStringId: number;
  /** Localized concise-description string id from the client skill record. */
  readonly conciseStringId: number;
  /** Localized full-description string id from the client skill record. */
  readonly descriptionStringId: number;
}

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function parseSkillRecord(bytes: Uint8Array, at: number): SkillRecord {
  const data = view(bytes);
  const special = data.getUint32(at + FIELD.special, true);
  return {
    id: data.getUint32(at + FIELD.skillId, true),
    campaign: data.getUint32(at + FIELD.campaign, true),
    type: data.getUint32(at + FIELD.type, true),
    elite: (special & ELITE) !== 0,
    playable: (special & NOT_PLAYABLE) === 0,
    pvp: (special & PVP) !== 0,
    pve: (special & PVE) !== 0,
    profession: bytes[at + FIELD.profession]!,
    attribute: bytes[at + FIELD.attribute]!,
    title: data.getUint16(at + FIELD.title, true),
    pvpReplacement: data.getUint32(at + FIELD.pvpReplacement, true),
    equipType: bytes[at + FIELD.equipType]!,
    overcast: (special & HAS_OVERCAST) !== 0 ? bytes[at + FIELD.overcast]! : 0,
    energyCost: decodeEnergyCost(bytes[at + FIELD.energy]!),
    healthCost: bytes[at + FIELD.health]!,
    adrenalineCost: data.getUint32(at + FIELD.adrenaline, true),
    activationSeconds: data.getFloat32(at + FIELD.activation, true),
    aftercastSeconds: data.getFloat32(at + FIELD.aftercast, true),
    duration0: data.getUint32(at + FIELD.duration0, true),
    duration15: data.getUint32(at + FIELD.duration15, true),
    rechargeSeconds: data.getUint32(at + FIELD.recharge, true),
    skillArguments: data.getUint32(at + FIELD.skillArguments, true),
    scale0: data.getUint32(at + FIELD.scale0, true),
    scale15: data.getUint32(at + FIELD.scale15, true),
    bonusScale0: data.getUint32(at + FIELD.bonusScale0, true),
    bonusScale15: data.getUint32(at + FIELD.bonusScale15, true),
    iconFileId: data.getUint32(at + FIELD.iconFileId, true),
    iconFileIdHiRes: data.getUint32(at + FIELD.iconFileIdHiRes, true),
    nameStringId: data.getUint32(at + FIELD.name, true),
    conciseStringId: data.getUint32(at + FIELD.concise, true),
    descriptionStringId: data.getUint32(at + FIELD.description, true),
  };
}

/** The client stores the two non-literal energy costs as compact sentinels. */
export function decodeEnergyCost(encoded: number): number {
  if (encoded === 11) return 15;
  if (encoded === 12) return 25;
  return encoded;
}

/** The ten playable professions, plus 0 for "common to everyone". */
const MAX_PROFESSION = 10;
/** Attributes run to 44; 255 and a few high values are "no attribute". */
const MAX_ATTRIBUTE = 44;
const NO_ATTRIBUTE = 255;
/** Core, Prophecies, Factions, Nightfall, Eye of the North, and slack. */
const MAX_CAMPAIGN = 8;
/** Comfortably above the real count; a larger id means this is not the table. */
const MAX_SKILL_ID = 4000;

/**
 * How many consecutive records from `at` satisfy the signature.
 *
 * Returns a count rather than a boolean so the caller can rank candidates: the
 * real table produces a run of thousands, and coincidences die within a few.
 */
export function signatureRun(
  bytes: Uint8Array,
  at: number,
  limit: number,
): number {
  const data = view(bytes);
  let previous = -1;
  for (let i = 0; i < limit; i++) {
    const record = at + i * SKILL_RECORD_BYTES;
    if (record + SKILL_RECORD_BYTES > bytes.byteLength) return i;
    const id = data.getUint32(record + FIELD.skillId, true);
    // Ascending, not merely distinct: the table is ordered by id.
    if (id <= previous || id > MAX_SKILL_ID) return i;
    if (data.getUint32(record + FIELD.campaign, true) > MAX_CAMPAIGN) return i;
    if (bytes[record + FIELD.profession]! > MAX_PROFESSION) return i;
    const attribute = bytes[record + FIELD.attribute]!;
    if (attribute > MAX_ATTRIBUTE && attribute !== NO_ATTRIBUTE) return i;
    previous = id;
  }
  return limit;
}

export interface SkillTable {
  /** Byte offset of record 0 within the client binary. */
  readonly at: number;
  readonly skills: readonly SkillRecord[];
}

/** How long a run has to be before a match is believed. */
const CONFIDENT_RUN = 60;

/**
 * Locate and read the skill table in a client binary, or `null`.
 *
 * Two passes. The first finds any position holding a confident run; the second
 * walks backwards to record 0 and forwards to the end, because the run that was
 * found starts wherever the scan happened to land, not at skill id 0.
 */
export function findSkillTable(binary: Uint8Array): SkillTable | null {
  let found = -1;
  for (let at = 0; at + SKILL_RECORD_BYTES * 8 < binary.byteLength; at++) {
    if (signatureRun(binary, at, CONFIDENT_RUN) >= CONFIDENT_RUN) {
      found = at;
      break;
    }
  }
  if (found < 0) return null;

  // The table is indexed by skill id, so record 0 sits exactly `id` records
  // before whatever was found. Derived rather than searched: walking backwards
  // by signature would stop at the first record that happens to fail it.
  const data = view(binary);
  const idAtFound = data.getUint32(found + FIELD.skillId, true);
  const start = found - idAtFound * SKILL_RECORD_BYTES;
  if (start < 0 || data.getUint32(start + FIELD.skillId, true) !== 0) return null;

  const skills: SkillRecord[] = [];
  for (let index = 0; ; index++) {
    const at = start + index * SKILL_RECORD_BYTES;
    if (at + SKILL_RECORD_BYTES > binary.byteLength) break;
    // The table ends where the id stops matching the index.
    if (data.getUint32(at + FIELD.skillId, true) !== index) break;
    skills.push(parseSkillRecord(binary, at));
  }
  return { at: start, skills };
}
