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

export const COMPANION_TOOLBOX_ABI = 2;
export const COMPANION_TOOLBOX_BYTES = 64;

const TOOLBOX_MAGIC = 0x58545747;
const TOOLBOX_HERO_AVAILABLE = 1 << 0;

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
  if (
    magic !== TOOLBOX_MAGIC
    || abi !== COMPANION_TOOLBOX_ABI
    || byteLength !== COMPANION_TOOLBOX_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~TOOLBOX_HERO_AVAILABLE) !== 0
    || reserved !== 0
    || state.panelState > 2
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
    ...state,
  });
}
