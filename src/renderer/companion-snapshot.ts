/**
 * Decoders for the companion kernel's general game, cursor, toolbox, and party
 * records. Feature-specific records live beside their owning capability.
 *
 * Shared memory is untrusted input here. Every record is checked against its
 * magic, its ABI and its declared size, and each field is re-validated against
 * the property the kernel claims to have enforced — coordinates for finiteness
 * and range, agent types against the accepted bit patterns, flags against the
 * known set. A decoder that agreed with the writer by construction would be
 * evidence of nothing.
 *
 * The `*_ABI` and `*_BYTES` constants are the contract with the kernel. A
 * layout change has to move both sides, so a mismatched pair decodes to a
 * refusal instead of to plausible numbers.
 */
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import { COMPANION_ABI } from "../shared/companion-abi.js";

export const COMPANION_SNAPSHOT_ABI = COMPANION_ABI.snapshot.abi;
export const COMPANION_SNAPSHOT_BYTES = COMPANION_ABI.snapshot.bytes;

const MAGIC = 0x42545747;
const INSTANCE_NAMES = Object.freeze(["Outpost", "Explorable", "Loading"]);
const RANGE_NAMES = Object.freeze([
  "None",
  "Adjacent",
  "Nearby",
  "Area",
  "Earshot",
  "Spellcast",
  "Spirit",
  "Compass",
  "Beyond compass",
]);
const FLAGS = Object.freeze({
  ready: 1 << 0,
  player: 1 << 1,
  target: 1 << 2,
  loading: 1 << 3,
  xunlaiObserved: 1 << 4,
  xunlaiAllowed: 1 << 5,
});
const KNOWN_FLAGS =
  FLAGS.ready | FLAGS.player | FLAGS.target | FLAGS.loading
  | FLAGS.xunlaiObserved | FLAGS.xunlaiAllowed;

function validCoordinate(value: number) {
  return Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

/*
 * The kernel publishes a target only when its type word carries one of these
 * bits (`valid_agent_type`, lib.rs). The decoder distrusts shared memory and
 * checks the same property independently rather than trusting the writer.
 */
const AGENT_TYPE_BITS = 0x400 | 0x200 | 0xdb;

/**
 * Only the Living pattern has been certified against a live target — the
 * readiness register in `docs/enhancement-development.md` still lists
 * hostile/item/gadget as the next proof — so every other accepted word is
 * published as `agentTypeBits` under a kind that claims nothing. Naming a
 * value the client has not certified is how a guess becomes a fact.
 */
function agentKind(bits: number) {
  return (bits & 0xdb) !== 0 ? "Living" : "Unknown";
}

export function readCompanionSnapshot(buffer: ArrayBuffer, pointer: number) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_SNAPSHOT_BYTES > buffer.byteLength
  ) {
    return Object.freeze({ status: "waiting", reason: "memory" });
  }
  const view = new DataView(buffer, pointer, COMPANION_SNAPSHOT_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" });
  }
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const byteLength = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const instanceAndRegion = view.getUint32(24, true);
  const playRegion = instanceAndRegion >>> 8;
  const state = {
    sequence: firstSequence,
    tickCount: view.getUint32(16, true),
    mapId: view.getUint32(20, true),
    instanceType: instanceAndRegion & 0xff,
    playRegion: playRegion === 1 ? "pve" as const
      : playRegion === 2 ? "pvp" as const
        : "unknown" as const,
    playerId: view.getUint32(28, true),
    playerX: view.getFloat32(32, true),
    playerY: view.getFloat32(36, true),
    targetId: view.getUint32(40, true),
    agentTypeBits: view.getUint32(44, true),
    targetX: view.getFloat32(48, true),
    targetY: view.getFloat32(52, true),
    distance: view.getFloat32(56, true),
    rangeBand: view.getUint32(60, true),
  };
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== MAGIC
    || abi !== COMPANION_SNAPSHOT_ABI
    || byteLength !== COMPANION_SNAPSHOT_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~KNOWN_FLAGS) !== 0
    || (
      (flags & FLAGS.xunlaiAllowed) !== 0
      && (flags & FLAGS.xunlaiObserved) === 0
    )
  ) {
    return Object.freeze({ status: "waiting", reason: "snapshot" });
  }
  if ((flags & FLAGS.loading) !== 0) {
    if (flags !== FLAGS.loading) {
      return Object.freeze({ status: "waiting", reason: "corrupt" });
    }
    return Object.freeze({
      status: "waiting",
      reason: "loading",
      sequence: secondSequence,
      tickCount: state.tickCount,
    });
  }
  if ((flags & (FLAGS.ready | FLAGS.player)) !== (FLAGS.ready | FLAGS.player)) {
    return Object.freeze({
      status: "waiting",
      reason: "game",
      sequence: secondSequence,
      tickCount: state.tickCount,
    });
  }
  if (
    state.mapId === 0
    || state.mapId > 2_000
    || state.instanceType > 1
    || playRegion > 2
    || state.playerId === 0
    || !validCoordinate(state.playerX)
    || !validCoordinate(state.playerY)
  ) {
    return Object.freeze({ status: "waiting", reason: "corrupt" });
  }
  const targetValid = (flags & FLAGS.target) !== 0;
  if (
    targetValid
      ? state.targetId === 0
        || (state.agentTypeBits & AGENT_TYPE_BITS) === 0
        || !validCoordinate(state.targetX)
        || !validCoordinate(state.targetY)
        || !Number.isFinite(state.distance)
        || state.distance < 0
        || state.rangeBand < 1
        || state.rangeBand >= RANGE_NAMES.length
      : state.targetId !== 0
        || state.agentTypeBits !== 0
        || state.targetX !== 0
        || state.targetY !== 0
        || state.distance !== 0
        || state.rangeBand !== 0
  ) {
    return Object.freeze({ status: "waiting", reason: "corrupt" });
  }
  return Object.freeze({
    status: "ready",
    ...state,
    xunlaiAccess: (flags & FLAGS.xunlaiObserved) === 0
      ? null
      : (flags & FLAGS.xunlaiAllowed) !== 0,
    instanceName: INSTANCE_NAMES[state.instanceType] ?? "Unknown",
    targetValid,
    targetKind: targetValid ? agentKind(state.agentTypeBits) : "None",
    rangeName: RANGE_NAMES[state.rangeBand] ?? "None",
  });
}

/** The decoder-owned, discriminated game-state contract used by consumers. */
export type CompanionSnapshot = ReturnType<typeof readCompanionSnapshot>;

/** The exact state an observer may publish outside the installer. */
export type PublishedCompanionState =
  | CompanionSnapshot
  | Readonly<{ status: "unsupported" }>
  | Readonly<{ status: "error"; reason: string }>;

/* The cursor bitmap lives in its own region: the core snapshot is full, and
   4 KB of pixels do not belong in a per-frame read. */
export const COMPANION_CURSOR_ABI = COMPANION_ABI.cursor.abi;
export const COMPANION_CURSOR_BYTES = COMPANION_ABI.cursor.bytes;

const CURSOR_MAGIC = 0x43545747;
const CURSOR_EDGE = 32;
const CURSOR_PIXEL_OFFSET = 64;
const CURSOR_PIXEL_BYTES = CURSOR_EDGE * CURSOR_EDGE * 4;
const CURSOR_FLAGS = Object.freeze({
  valid: 1 << 0,
  hidden: 1 << 1,
  unsupported: 1 << 2,
});
const KNOWN_CURSOR_FLAGS =
  CURSOR_FLAGS.valid | CURSOR_FLAGS.hidden | CURSOR_FLAGS.unsupported;

function cursorView(buffer: ArrayBuffer, pointer: number) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_CURSOR_BYTES > buffer.byteLength
  ) {
    return null;
  }
  return new DataView(buffer, pointer, COMPANION_CURSOR_BYTES);
}

/**
 * Header-only read for the per-frame change check. Never touches the payload.
 */
export function readCompanionCursorHeader(buffer: ArrayBuffer, pointer: number) {
  const view = cursorView(buffer, pointer);
  if (view === null) {
    return Object.freeze({ status: "waiting", reason: "memory" });
  }
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" });
  }
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const byteLength = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const generation = view.getUint32(16, true);
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const hotspotX = view.getUint32(28, true);
  const hotspotY = view.getUint32(32, true);
  const pixelHash = view.getUint32(36, true);
  let reserved = 0;
  for (let offset = 40; offset < CURSOR_PIXEL_OFFSET; offset += 4) {
    reserved |= view.getUint32(offset, true);
  }
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== CURSOR_MAGIC
    || abi !== COMPANION_CURSOR_ABI
    || byteLength !== COMPANION_CURSOR_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~KNOWN_CURSOR_FLAGS) !== 0
    || reserved !== 0
  ) {
    return Object.freeze({ status: "waiting", reason: "cursor" });
  }
  // Unsupported is a terminal state, not a modifier: it must stand alone.
  if (
    (flags & CURSOR_FLAGS.unsupported) !== 0
    && flags !== CURSOR_FLAGS.unsupported
  ) {
    return Object.freeze({ status: "waiting", reason: "corrupt" });
  }
  if ((flags & CURSOR_FLAGS.valid) === 0) {
    // The kernel clears CURSOR_VALID header-only, so the stale geometry it
    // leaves behind is not validated. Hidden is meaningless without a cursor.
    if ((flags & CURSOR_FLAGS.hidden) !== 0) {
      return Object.freeze({ status: "waiting", reason: "corrupt" });
    }
    return Object.freeze({
      status: "invalid",
      reason: flags === CURSOR_FLAGS.unsupported ? "unsupported" : "cursor",
      generation,
      flags,
      hotspotX: 0,
      hotspotY: 0,
      pixelHash: 0,
      hidden: false,
    });
  }
  if (
    generation === 0
    || width !== CURSOR_EDGE
    || height !== CURSOR_EDGE
    || hotspotX >= CURSOR_EDGE
    || hotspotY >= CURSOR_EDGE
  ) {
    return Object.freeze({ status: "waiting", reason: "corrupt" });
  }
  return Object.freeze({
    status: "ready",
    generation,
    flags,
    hotspotX,
    hotspotY,
    pixelHash,
    hidden: (flags & CURSOR_FLAGS.hidden) !== 0,
  });
}

/**
 * Full seqlock read: the header and a private copy of the RGBA payload from
 * one publish. Null when the region is torn, malformed, or carries no cursor.
 */
export function readCompanionCursorPixels(buffer: ArrayBuffer, pointer: number) {
  const view = cursorView(buffer, pointer);
  if (view === null) return null;
  const firstSequence = view.getUint32(8, true);
  const header = readCompanionCursorHeader(buffer, pointer);
  if (header.status !== "ready") return null;
  const pixels = new Uint8ClampedArray(
    new Uint8Array(buffer, pointer + CURSOR_PIXEL_OFFSET, CURSOR_PIXEL_BYTES),
  );
  if ((firstSequence & 1) !== 0 || view.getUint32(8, true) !== firstSequence) {
    return null;
  }
  return Object.freeze({ ...header, pixels });
}

export const COMPANION_TOOLBOX_ABI = COMPANION_ABI.toolbox.abi;
export const COMPANION_TOOLBOX_BYTES = COMPANION_ABI.toolbox.bytes;

const TOOLBOX_MAGIC = 0x58545747;
const TOOLBOX_HERO_AVAILABLE = 1 << 0;
/*
 * The kernel completed a party walk on a live game for this publication.
 * Its absence is the difference between "you have no heroes" and "nobody
 * looked" — during a map load the second is true, and without this bit the
 * two arrive as identical bytes.
 */
const TOOLBOX_PARTY_OBSERVED = 1 << 1;
const KNOWN_TOOLBOX_FLAGS = TOOLBOX_HERO_AVAILABLE | TOOLBOX_PARTY_OBSERVED;

function readCompanionToolboxSequence(
  buffer: ArrayBuffer,
  pointer: number,
): number | null {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_TOOLBOX_BYTES > buffer.byteLength
  ) {
    return null;
  }
  const view = new DataView(buffer, pointer, 12);
  const first = view.getUint32(8, true);
  if (
    (first & 1) !== 0
    || view.getUint32(0, true) !== TOOLBOX_MAGIC
    || view.getUint16(4, true) !== COMPANION_TOOLBOX_ABI
    || view.getUint16(6, true) !== COMPANION_TOOLBOX_BYTES
    || view.getUint32(8, true) !== first
  ) {
    return null;
  }
  return first;
}

export function readCompanionToolbox(buffer: ArrayBuffer, pointer: number) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_TOOLBOX_BYTES > buffer.byteLength
  ) {
    return Object.freeze({ status: "waiting", reason: "memory" });
  }
  const view = new DataView(buffer, pointer, COMPANION_TOOLBOX_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" });
  }
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const byteLength = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const state = {
    playerChatCount: view.getUint32(16, true),
    cursorEventCount: view.getUint32(20, true),
    heroCount: view.getUint32(24, true),
    firstHeroId: view.getUint32(28, true),
    firstHeroAgentId: view.getUint32(32, true),
  };
  let reserved = 0;
  for (let offset = 36; offset < COMPANION_TOOLBOX_BYTES; offset += 4) {
    reserved |= view.getUint32(offset, true);
  }
  const secondSequence = view.getUint32(8, true);
  const heroAvailable = (flags & TOOLBOX_HERO_AVAILABLE) !== 0;
  const partyObserved = (flags & TOOLBOX_PARTY_OBSERVED) !== 0;
  if (
    magic !== TOOLBOX_MAGIC
    || abi !== COMPANION_TOOLBOX_ABI
    || byteLength !== COMPANION_TOOLBOX_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~KNOWN_TOOLBOX_FLAGS) !== 0
    || reserved !== 0
    // A hero cannot be available in a party nobody read. Checked here rather
    // than trusted: the kernel enforces it by construction, which is exactly
    // why agreeing with it by construction would prove nothing.
    || (heroAvailable && !partyObserved)
    || (heroAvailable
      ? state.heroCount < 1
        || state.heroCount > 7
        || state.firstHeroId < 1
        || state.firstHeroId > 39
      : state.heroCount !== 0
        || state.firstHeroId !== 0
        || state.firstHeroAgentId !== 0)
  ) {
    return Object.freeze({ status: "waiting", reason: "toolbox" });
  }
  return Object.freeze({
    status: "ready",
    sequence: secondSequence,
    heroAvailable,
    partyObserved,
    ...state,
  });
}

export type CompanionToolboxState = ReturnType<typeof readCompanionToolbox>;

export function readChangedCompanionToolbox(
  buffer: ArrayBuffer,
  pointer: number,
  previousSequence: number | null,
) {
  const sequence = readCompanionToolboxSequence(buffer, pointer);
  if (sequence !== null && sequence === previousSequence) {
    return Object.freeze({ changed: false as const, sequence });
  }
  const state = readCompanionToolbox(buffer, pointer);
  return Object.freeze({
    changed: true as const,
    sequence: state.status === "ready" ? state.sequence : null,
    state,
  });
}

/**
 * Publication sequence protects the read; the decoded fields own identity.
 * Ignoring sequence here makes an accidental redundant kernel publication
 * harmless instead of turning it into a renderer update.
 */
export function sameCompanionToolboxState(
  previous: CompanionToolboxState | null,
  next: CompanionToolboxState,
) {
  if (previous === null) return false;
  if (previous.status !== "ready" || next.status !== "ready") {
    return previous.status !== "ready"
      && next.status !== "ready"
      && previous.reason === next.reason;
  }
  return previous.playerChatCount === next.playerChatCount
    && previous.cursorEventCount === next.cursorEventCount
    && previous.heroAvailable === next.heroAvailable
    && previous.partyObserved === next.partyObserved
    && previous.heroCount === next.heroCount
    && previous.firstHeroId === next.firstHeroId
    && previous.firstHeroAgentId === next.firstHeroAgentId;
}

/**
 * The full party projection: who is in the party, with what, and which heroes
 * the account owns.
 *
 * Its shape is the toolbox region's argument taken to its conclusion. Every
 * field the kernel read carries a flag saying so, because a zero level and an
 * unread level are the same word and eight zero skill ids are a legal bar. The
 * decoder therefore reports absence rather than substituting a default, and
 * re-derives every implication it can check instead of trusting the writer
 * that enforced it.
 */
export const COMPANION_PARTY_ABI = COMPANION_ABI.party.abi;
export const COMPANION_PARTY_BYTES = COMPANION_ABI.party.bytes;

const PARTY_MAGIC = 0x50545747;
const PARTY_SLOT_COUNT = 8;
const PARTY_SLOT_BYTES = 96;
const PARTY_FIXED_HEADER_BYTES = 64;
const ACCOUNT_HERO_SLOTS = 40;
const PARTY_HEADER_BYTES = PARTY_FIXED_HEADER_BYTES + ACCOUNT_HERO_SLOTS * 4;
const PARTY_SKILL_SLOTS = 8;
/** Five attributes from a primary profession plus four from a secondary. */
const PARTY_ATTRIBUTE_SLOTS = 9;
const SKILL_UNLOCK_WORDS = 70;
const SKILL_UNLOCK_HEADER = PARTY_HEADER_BYTES + PARTY_SLOT_COUNT * PARTY_SLOT_BYTES;
const ACCOUNT_SKILL_WORDS_AT = SKILL_UNLOCK_HEADER;
const CHARACTER_SKILL_WORDS_AT = ACCOUNT_SKILL_WORDS_AT + 4;
const ACCOUNT_SKILLS_AT = CHARACTER_SKILL_WORDS_AT + 4;
const CHARACTER_SKILLS_AT = ACCOUNT_SKILLS_AT + SKILL_UNLOCK_WORDS * 4;
/** The highest attribute id the client defines. */
const ATTRIBUTE_ID_MAX = 44;
/** The highest rank the client's own cumulative cost table can buy. */
const ATTRIBUTE_RANK_MAX = 12;

const PARTY_FLAGS = Object.freeze({
  roster: 1 << 0,
  unlock: 1 << 1,
  outpost: 1 << 2,
  hardMode: 1 << 3,
  accountSkills: 1 << 4,
  characterSkills: 1 << 5,
});
const KNOWN_PARTY_FLAGS =
  PARTY_FLAGS.roster | PARTY_FLAGS.unlock | PARTY_FLAGS.outpost
  | PARTY_FLAGS.hardMode | PARTY_FLAGS.accountSkills
  | PARTY_FLAGS.characterSkills;
const SLOT_FLAGS = Object.freeze({
  occupied: 1 << 0,
  professions: 1 << 1,
  behaviour: 1 << 2,
  skills: 1 << 3,
  attributes: 1 << 4,
});
const KNOWN_SLOT_FLAGS =
  SLOT_FLAGS.occupied | SLOT_FLAGS.professions | SLOT_FLAGS.behaviour
  | SLOT_FLAGS.skills | SLOT_FLAGS.attributes;

/** `hero_id`s the account owns, as the kernel's two bitmaps decode. */
function unlockedHeroes(known: bigint, unlocked: bigint): number[] {
  const heroes: number[] = [];
  for (let id = 1; id <= 63; id += 1) {
    const bit = 1n << BigInt(id);
    if ((known & bit) !== 0n && (unlocked & bit) !== 0n) heroes.push(id);
  }
  return heroes;
}

function unlockedSkills(
  view: DataView,
  at: number,
  words: number,
): number[] {
  const skills: number[] = [];
  for (let word = 0; word < words; word += 1) {
    const value = view.getUint32(at + word * 4, true);
    for (let bit = 0; bit < 32; bit += 1) {
      if (((value >>> bit) & 1) !== 0) skills.push(word * 32 + bit);
    }
  }
  return skills;
}

function hasOnlyZeroWords(
  view: DataView,
  at: number,
  from: number,
): boolean {
  for (let word = from; word < SKILL_UNLOCK_WORDS; word += 1) {
    if (view.getUint32(at + word * 4, true) !== 0) return false;
  }
  return true;
}

type AccountProfessionRow = Readonly<{
  hero: number;
  professions: readonly [number, number];
}>;

type AccountProfessionRowResult =
  | Readonly<{ status: "accepted"; row: AccountProfessionRow | null }>
  | Readonly<{ status: "refused" }>;

/** Reads and validates one fixed account-profession row. */
function readAccountProfessionRow(
  view: DataView,
  hero: number,
): AccountProfessionRowResult {
  const packed = view.getUint32(PARTY_FIXED_HEADER_BYTES + hero * 4, true);
  if (packed === 0) return Object.freeze({ status: "accepted", row: null });
  const primary = packed & 0xff;
  const secondary = (packed >>> 8) & 0xff;
  if (
    hero === 0
    || primary < 1
    || primary > 10
    || secondary > 10
    || (packed >>> 16) !== 0
  ) return Object.freeze({ status: "refused" });
  return Object.freeze({
    status: "accepted",
    row: Object.freeze({
      hero,
      professions: Object.freeze([primary, secondary] as const),
    }),
  });
}

type PartySlot = NonNullable<
  NonNullable<ToolboxObservation["party"]>["slots"]
>[number];

type PartySlotRowResult =
  | Readonly<{ status: "accepted"; slot: PartySlot; heroId: number }>
  | Readonly<{ status: "refused" }>;

/** Reads and validates one fixed party slot without deciding cross-slot invariants. */
function readPartySlotRow(view: DataView, index: number): PartySlotRowResult {
  const at = PARTY_HEADER_BYTES + index * PARTY_SLOT_BYTES;
  const heroId = view.getUint32(at, true);
  const agentId = view.getUint32(at + 4, true);
  const professions = view.getUint32(at + 8, true);
  const level = view.getUint32(at + 12, true);
  const behaviour = view.getUint32(at + 16, true);
  const slotFlags = view.getUint32(at + 20, true);
  const disabled = view.getUint32(at + 24, true);
  const skills: number[] = [];
  for (let skill = 0; skill < PARTY_SKILL_SLOTS; skill += 1) {
    skills.push(view.getUint32(at + 28 + skill * 4, true));
  }
  const attributes: Array<readonly [number, number]> = [];
  const attributeIds = new Set<number>();
  for (let entry = 0; entry < PARTY_ATTRIBUTE_SLOTS; entry += 1) {
    const packed = view.getUint32(at + 60 + entry * 4, true);
    const rank = (packed >>> 8) & 0xff;
    const id = packed & 0xff;
    if (rank === 0) {
      if (packed !== 0) return Object.freeze({ status: "refused" });
      continue;
    }
    if (
      id > ATTRIBUTE_ID_MAX
      || rank > ATTRIBUTE_RANK_MAX
      || (packed >>> 16) !== 0
      || attributeIds.has(id)
    ) return Object.freeze({ status: "refused" });
    attributeIds.add(id);
    attributes.push(Object.freeze([id, rank]));
  }
  if ((slotFlags & ~KNOWN_SLOT_FLAGS) !== 0) {
    return Object.freeze({ status: "refused" });
  }
  const occupied = (slotFlags & SLOT_FLAGS.occupied) !== 0;
  if (occupied) {
    if (index === 0) {
      if (heroId !== 0 || agentId === 0 || (slotFlags & SLOT_FLAGS.behaviour) !== 0) {
        return Object.freeze({ status: "refused" });
      }
    } else if (heroId < 1 || heroId > 39) {
      return Object.freeze({ status: "refused" });
    }
    if ((slotFlags & SLOT_FLAGS.behaviour) !== 0 && behaviour > 2) {
      return Object.freeze({ status: "refused" });
    }
    if ((slotFlags & SLOT_FLAGS.skills) !== 0 && disabled > 0xff) {
      return Object.freeze({ status: "refused" });
    }
    if ((slotFlags & SLOT_FLAGS.professions) !== 0) {
      const primary = professions & 0xff;
      const secondary = (professions >>> 8) & 0xff;
      if (primary < 1 || primary > 10 || secondary > 10) {
        return Object.freeze({ status: "refused" });
      }
    }
    if (
      ((slotFlags & SLOT_FLAGS.professions) === 0 && professions !== 0)
      || ((slotFlags & SLOT_FLAGS.behaviour) === 0 && behaviour !== 0)
      || (
        (slotFlags & SLOT_FLAGS.skills) === 0
        && (disabled !== 0 || skills.some((skill) => skill !== 0))
      )
      || ((slotFlags & SLOT_FLAGS.attributes) === 0 && attributes.length !== 0)
    ) return Object.freeze({ status: "refused" });
  } else if (
    heroId !== 0 || agentId !== 0 || professions !== 0 || level !== 0
    || behaviour !== 0 || disabled !== 0 || slotFlags !== 0
    || skills.some((skill) => skill !== 0)
    || attributes.length !== 0
  ) return Object.freeze({ status: "refused" });

  return Object.freeze({
    status: "accepted",
    heroId,
    slot: Object.freeze({
      index,
      occupied,
      hero: occupied && index !== 0 ? heroId : null,
      agentId: occupied ? agentId : null,
      level: occupied && level !== 0 ? level : null,
      professions: (slotFlags & SLOT_FLAGS.professions) !== 0
        ? Object.freeze([professions & 0xff, (professions >>> 8) & 0xff])
        : null,
      behaviour: (slotFlags & SLOT_FLAGS.behaviour) !== 0 ? behaviour : null,
      skills: (slotFlags & SLOT_FLAGS.skills) !== 0 ? Object.freeze(skills) : null,
      disabled: (slotFlags & SLOT_FLAGS.skills) !== 0 ? disabled : null,
      attributes: (slotFlags & SLOT_FLAGS.attributes) !== 0
        ? Object.freeze(attributes)
        : null,
    }),
  });
}

export function readCompanionParty(buffer: ArrayBuffer, pointer: number) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_PARTY_BYTES > buffer.byteLength
  ) {
    return Object.freeze({ status: "waiting", reason: "memory" });
  }
  const view = new DataView(buffer, pointer, COMPANION_PARTY_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" });
  }
  const magic = view.getUint32(0, true);
  const abiAndSize = view.getUint32(4, true);
  const flags = view.getUint32(12, true);
  const generation = view.getUint32(16, true);
  const slotCount = view.getUint32(20, true);
  const unlockedLow = view.getUint32(24, true);
  const unlockedHigh = view.getUint32(28, true);
  const knownLow = view.getUint32(32, true);
  const knownHigh = view.getUint32(36, true);
  const playRegionValue = view.getUint32(40, true);
  const hardModeValue = view.getUint32(44, true);
  const directProfessions = view.getUint32(48, true);
  const attributeIdsLow = view.getUint32(52, true);
  const attributeIdsHigh = view.getUint32(56, true);
  const professionSources = view.getUint32(60, true);
  const accountSkillWords = view.getUint32(ACCOUNT_SKILL_WORDS_AT, true);
  const characterSkillWords = view.getUint32(CHARACTER_SKILL_WORDS_AT, true);
  const accountSkillsObserved = (flags & PARTY_FLAGS.accountSkills) !== 0;
  const characterSkillsObserved = (flags & PARTY_FLAGS.characterSkills) !== 0;
  let malformed = false;
  const playerProfessionProbe = Object.freeze({
    statePrimary: directProfessions & 0xff,
    stateSecondary: (directProfessions >>> 8) & 0xff,
    attributeIdsLow,
    attributeIdsHigh,
    stateRowObserved: (professionSources & 1) !== 0,
    stateAccepted: (professionSources & 2) !== 0,
    attributeRowObserved: (professionSources & 4) !== 0,
  });
  const accountProfessions: AccountProfessionRow[] = [];
  let accountProfessionBits = 0n;
  for (let hero = 0; hero < ACCOUNT_HERO_SLOTS; hero += 1) {
    const result = readAccountProfessionRow(view, hero);
    if (result.status === "refused") {
      malformed = true;
      continue;
    }
    if (result.row !== null) {
      accountProfessionBits |= 1n << BigInt(hero);
      accountProfessions.push(result.row);
    }
  }

  const slots: PartySlot[] = [];
  let occupied = 0;
  const seen = new Set<number>();
  for (let index = 0; index < PARTY_SLOT_COUNT; index += 1) {
    const result = readPartySlotRow(view, index);
    if (result.status === "refused") {
      malformed = true;
      continue;
    }
    const { slot, heroId } = result;
    if (slot.occupied) {
      occupied += 1;
      if (index !== 0) {
        if (seen.has(heroId)) malformed = true;
        seen.add(heroId);
      }
    }
    slots.push(slot);
  }

  const secondSequence = view.getUint32(8, true);
  const rosterObserved = (flags & PARTY_FLAGS.roster) !== 0;
  const unlockObserved = (flags & PARTY_FLAGS.unlock) !== 0;
  const hardModeObserved = (flags & PARTY_FLAGS.hardMode) !== 0;
  if (
    magic !== PARTY_MAGIC
    || abiAndSize !== ((COMPANION_PARTY_BYTES << 16) | COMPANION_PARTY_ABI)
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~KNOWN_PARTY_FLAGS) !== 0
    || playRegionValue > 2
    || hardModeValue > 1
    || (directProfessions >>> 16) !== 0
    || (attributeIdsHigh >>> 13) !== 0
    || (professionSources & ~7) !== 0
    || accountSkillWords > SKILL_UNLOCK_WORDS
    || characterSkillWords > SKILL_UNLOCK_WORDS
    || malformed
    || slotCount !== Math.max(0, occupied - (slots[0]?.occupied ? 1 : 0))
    || (rosterObserved && !slots[0]?.occupied)
    // Nothing may be occupied, and no hero owned, in a party nobody read.
    || (!rosterObserved && (occupied !== 0 || slotCount !== 0))
    // Where the party is standing is something the walk read. A record nobody
    // walked cannot claim an outpost.
    || (!rosterObserved && (flags & PARTY_FLAGS.outpost) !== 0)
    || (!rosterObserved && hardModeObserved)
    || (!hardModeObserved && hardModeValue !== 0)
    // A blocked or unknown region publishes policy only. No optional party
    // graph is walked there.
    || (playRegionValue !== 1 && (rosterObserved || unlockObserved))
    || (playRegionValue !== 1 && (accountSkillsObserved || characterSkillsObserved))
    || (!unlockObserved && (knownLow !== 0 || knownHigh !== 0))
    || (!unlockObserved && accountProfessions.length !== 0)
    || (!accountSkillsObserved && accountSkillWords !== 0)
    || (!characterSkillsObserved && characterSkillWords !== 0)
    || !hasOnlyZeroWords(view, ACCOUNT_SKILLS_AT, accountSkillWords)
    || !hasOnlyZeroWords(view, CHARACTER_SKILLS_AT, characterSkillWords)
    // A hero cannot be unlocked without that having been decided.
    || (unlockedLow & ~knownLow) !== 0
    || (unlockedHigh & ~knownHigh) !== 0
    || (accountProfessionBits & ~(
      (BigInt(unlockedHigh) << 32n) | BigInt(unlockedLow)
    )) !== 0n
  ) {
    return Object.freeze({ status: "waiting", reason: "party" });
  }
  return Object.freeze({
    status: "ready",
    sequence: secondSequence,
    generation,
    rosterObserved,
    unlockObserved,
    playRegion: playRegionValue === 1 ? "pve" as const
      : playRegionValue === 2 ? "pvp" as const
        : "unknown" as const,
    hardMode: hardModeObserved ? hardModeValue === 1 : null,
    inOutpost: rosterObserved ? (flags & PARTY_FLAGS.outpost) !== 0 : null,
    slotCount,
    slots: Object.freeze(slots),
    unlocked: unlockObserved
      ? Object.freeze(unlockedHeroes(
          (BigInt(knownHigh) << 32n) | BigInt(knownLow),
          (BigInt(unlockedHigh) << 32n) | BigInt(unlockedLow),
        ))
      : null,
    accountProfessions: unlockObserved
      ? Object.freeze(accountProfessions)
      : null,
    accountSkills: accountSkillsObserved
      ? Object.freeze({
          knownThrough: accountSkillWords * 32,
          unlocked: Object.freeze(unlockedSkills(
            view,
            ACCOUNT_SKILLS_AT,
            accountSkillWords,
          )),
        })
      : null,
    characterSkills: characterSkillsObserved
      ? Object.freeze({
          knownThrough: characterSkillWords * 32,
          unlocked: Object.freeze(unlockedSkills(
            view,
            CHARACTER_SKILLS_AT,
            characterSkillWords,
          )),
        })
      : null,
    playerProfessionProbe,
  });
}

export type CompanionPartyState = ReturnType<typeof readCompanionParty>;

/** The party sequence alone, for the frames where nothing has been published. */
function readCompanionPartySequence(
  buffer: ArrayBuffer,
  pointer: number,
): number | null {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_PARTY_BYTES > buffer.byteLength
  ) {
    return null;
  }
  const view = new DataView(buffer, pointer, 12);
  const first = view.getUint32(8, true);
  if (
    (first & 1) !== 0
    || view.getUint32(0, true) !== PARTY_MAGIC
    || view.getUint32(4, true) !== ((COMPANION_PARTY_BYTES << 16) | COMPANION_PARTY_ABI)
    || view.getUint32(8, true) !== first
  ) {
    return null;
  }
  return first;
}

/**
 * The party, decoded only when the kernel has published since it was last read.
 *
 * The counterpart of `readChangedCompanionToolbox`, and needed for the same
 * reason it is: 544 bytes and 64 skill ids are not worth re-deriving sixty
 * times a second to discover nothing moved.
 *
 * It exists at all because the party was originally re-read on the *toolbox*
 * sequence, which counts a different thing. Editing a hero's skill bar changes
 * no scalar the toolbox summary carries, so the panel kept showing — and
 * capture kept saving — the bar from before the edit.
 */
export function readChangedCompanionParty(
  buffer: ArrayBuffer,
  pointer: number,
  previousSequence: number | null,
) {
  const sequence = readCompanionPartySequence(buffer, pointer);
  if (sequence !== null && sequence === previousSequence) {
    return Object.freeze({ changed: false as const, sequence });
  }
  const state = readCompanionParty(buffer, pointer);
  return Object.freeze({
    changed: true as const,
    sequence: state.status === "ready" ? state.sequence : null,
    state,
  });
}
