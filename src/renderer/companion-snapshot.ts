/**
 * The decoders for the three fixed-layout records the companion kernel
 * publishes into shared memory: the game snapshot, the cursor, and the toolbox
 * state.
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
export const COMPANION_SNAPSHOT_ABI = 1;
export const COMPANION_SNAPSHOT_BYTES = 64;

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
});
const KNOWN_FLAGS =
  FLAGS.ready | FLAGS.player | FLAGS.target | FLAGS.loading;

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
  const state = {
    sequence: firstSequence,
    tickCount: view.getUint32(16, true),
    mapId: view.getUint32(20, true),
    instanceType: view.getUint32(24, true),
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
    instanceName: INSTANCE_NAMES[state.instanceType] ?? "Unknown",
    targetValid,
    targetKind: targetValid ? agentKind(state.agentTypeBits) : "None",
    rangeName: RANGE_NAMES[state.rangeBand] ?? "None",
  });
}

/* The cursor bitmap lives in its own region: the core snapshot is full, and
   4 KB of pixels do not belong in a per-frame read. */
export const COMPANION_CURSOR_ABI = 1;
export const COMPANION_CURSOR_BYTES = 4160;

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

export const COMPANION_TOOLBOX_ABI = 3;
export const COMPANION_TOOLBOX_BYTES = 64;

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
    panelState: view.getUint32(36, true),
  };
  let reserved = 0;
  for (let offset = 40; offset < COMPANION_TOOLBOX_BYTES; offset += 4) {
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
    || state.panelState > 2
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
    && previous.firstHeroAgentId === next.firstHeroAgentId
    && previous.panelState === next.panelState;
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
export const COMPANION_PARTY_ABI = 1;
export const COMPANION_PARTY_BYTES = 544;

const PARTY_MAGIC = 0x50545747;
const PARTY_SLOT_COUNT = 8;
const PARTY_SLOT_BYTES = 60;
const PARTY_HEADER_BYTES = 64;
const PARTY_SKILL_SLOTS = 8;

const PARTY_FLAGS = Object.freeze({ roster: 1 << 0, unlock: 1 << 1 });
const KNOWN_PARTY_FLAGS = PARTY_FLAGS.roster | PARTY_FLAGS.unlock;
const SLOT_FLAGS = Object.freeze({
  occupied: 1 << 0,
  professions: 1 << 1,
  behaviour: 1 << 2,
  skills: 1 << 3,
});
const KNOWN_SLOT_FLAGS =
  SLOT_FLAGS.occupied | SLOT_FLAGS.professions | SLOT_FLAGS.behaviour
  | SLOT_FLAGS.skills;

/** `hero_id`s the account owns, as the kernel's two bitmaps decode. */
function unlockedHeroes(known: bigint, unlocked: bigint): number[] {
  const heroes: number[] = [];
  for (let id = 1; id <= 63; id += 1) {
    const bit = 1n << BigInt(id);
    if ((known & bit) !== 0n && (unlocked & bit) !== 0n) heroes.push(id);
  }
  return heroes;
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
  let reserved = 0;
  for (let at = 40; at < PARTY_HEADER_BYTES; at += 4) {
    reserved |= view.getUint32(at, true);
  }

  const slots: Array<Record<string, unknown>> = [];
  let occupied = 0;
  let malformed = false;
  const seen = new Set<number>();
  for (let index = 0; index < PARTY_SLOT_COUNT; index += 1) {
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
    const isOccupied = (slotFlags & SLOT_FLAGS.occupied) !== 0;
    if ((slotFlags & ~KNOWN_SLOT_FLAGS) !== 0) malformed = true;
    if (isOccupied) {
      occupied += 1;
      // Slot 0 is the player, who is never a hero, and a hero cannot hold two
      // positions at once. Both are enforced by the writer; agreeing with it by
      // construction would prove nothing, so they are checked again here.
      if (index === 0 || heroId < 1 || heroId > 39 || seen.has(heroId)) {
        malformed = true;
      }
      seen.add(heroId);
      if ((slotFlags & SLOT_FLAGS.behaviour) !== 0 && behaviour > 2) malformed = true;
      if ((slotFlags & SLOT_FLAGS.skills) !== 0 && disabled > 0xff) malformed = true;
      if ((slotFlags & SLOT_FLAGS.professions) !== 0) {
        const primary = professions & 0xff;
        const secondary = (professions >>> 8) & 0xff;
        if (primary < 1 || primary > 10 || secondary > 10) malformed = true;
      }
    } else if (
      heroId !== 0 || agentId !== 0 || professions !== 0 || level !== 0
      || behaviour !== 0 || disabled !== 0 || slotFlags !== 0
      || skills.some((skill) => skill !== 0)
    ) {
      // An empty slot carrying values is a torn write, not an empty slot.
      malformed = true;
    }
    slots.push(Object.freeze({
      index,
      occupied: isOccupied,
      hero: isOccupied ? heroId : null,
      agentId: isOccupied ? agentId : null,
      level: isOccupied && level !== 0 ? level : null,
      professions: (slotFlags & SLOT_FLAGS.professions) !== 0
        ? Object.freeze([professions & 0xff, (professions >>> 8) & 0xff])
        : null,
      behaviour: (slotFlags & SLOT_FLAGS.behaviour) !== 0 ? behaviour : null,
      skills: (slotFlags & SLOT_FLAGS.skills) !== 0
        ? Object.freeze(skills)
        : null,
      disabled: (slotFlags & SLOT_FLAGS.skills) !== 0 ? disabled : null,
    }));
  }

  const secondSequence = view.getUint32(8, true);
  const rosterObserved = (flags & PARTY_FLAGS.roster) !== 0;
  const unlockObserved = (flags & PARTY_FLAGS.unlock) !== 0;
  if (
    magic !== PARTY_MAGIC
    || abiAndSize !== ((COMPANION_PARTY_BYTES << 16) | COMPANION_PARTY_ABI)
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~KNOWN_PARTY_FLAGS) !== 0
    || reserved !== 0
    || malformed
    || slotCount !== occupied
    // Nothing may be occupied, and no hero owned, in a party nobody read.
    || (!rosterObserved && (occupied !== 0 || slotCount !== 0))
    || (!unlockObserved && (knownLow !== 0 || knownHigh !== 0))
    // A hero cannot be unlocked without that having been decided.
    || (unlockedLow & ~knownLow) !== 0
    || (unlockedHigh & ~knownHigh) !== 0
  ) {
    return Object.freeze({ status: "waiting", reason: "party" });
  }
  return Object.freeze({
    status: "ready",
    sequence: secondSequence,
    generation,
    rosterObserved,
    unlockObserved,
    slotCount,
    slots: Object.freeze(slots),
    unlocked: unlockObserved
      ? Object.freeze(unlockedHeroes(
          (BigInt(knownHigh) << 32n) | BigInt(knownLow),
          (BigInt(unlockedHigh) << 32n) | BigInt(unlockedLow),
        ))
      : null,
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
