export const TOOLBOX_SNAPSHOT_ABI = 1;
export const TOOLBOX_SNAPSHOT_BYTES = 64;

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

/** @param {number} value */
function validCoordinate(value) {
  return Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

/** @param {number} type */
function agentKind(type) {
  if ((type & 0x400) !== 0) return "Item";
  if ((type & 0x200) !== 0) return "Gadget";
  if ((type & 0xdb) !== 0) return "Living";
  return null;
}

/**
 * @param {ArrayBuffer} buffer
 * @param {number} pointer
 */
export function readToolboxSnapshot(buffer, pointer) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + TOOLBOX_SNAPSHOT_BYTES > buffer.byteLength
  ) {
    return Object.freeze({ status: "waiting", reason: "memory" });
  }
  const view = new DataView(buffer, pointer, TOOLBOX_SNAPSHOT_BYTES);
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
    targetType: view.getUint32(44, true),
    targetX: view.getFloat32(48, true),
    targetY: view.getFloat32(52, true),
    distance: view.getFloat32(56, true),
    rangeBand: view.getUint32(60, true),
  };
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== MAGIC
    || abi !== TOOLBOX_SNAPSHOT_ABI
    || byteLength !== TOOLBOX_SNAPSHOT_BYTES
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
  const targetKind = agentKind(state.targetType);
  if (
    targetValid
      ? state.targetId === 0
        || targetKind === null
        || !validCoordinate(state.targetX)
        || !validCoordinate(state.targetY)
        || !Number.isFinite(state.distance)
        || state.distance < 0
        || state.rangeBand < 1
        || state.rangeBand >= RANGE_NAMES.length
      : state.targetId !== 0
        || state.targetType !== 0
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
    targetKind: targetValid ? (targetKind ?? "None") : "None",
    rangeName: RANGE_NAMES[state.rangeBand] ?? "None",
  });
}

/* The cursor bitmap lives in its own region: the core snapshot is full, and
   4 KB of pixels do not belong in a per-frame read. */
export const TOOLBOX_CURSOR_ABI = 1;
export const TOOLBOX_CURSOR_BYTES = 4160;

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

/**
 * @param {ArrayBuffer} buffer
 * @param {number} pointer
 */
function cursorView(buffer, pointer) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + TOOLBOX_CURSOR_BYTES > buffer.byteLength
  ) {
    return null;
  }
  return new DataView(buffer, pointer, TOOLBOX_CURSOR_BYTES);
}

/**
 * Header-only read for the per-frame change check. Never touches the payload.
 * @param {ArrayBuffer} buffer
 * @param {number} pointer
 */
export function readToolboxCursorHeader(buffer, pointer) {
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
    || abi !== TOOLBOX_CURSOR_ABI
    || byteLength !== TOOLBOX_CURSOR_BYTES
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
 * @param {ArrayBuffer} buffer
 * @param {number} pointer
 */
export function readToolboxCursorPixels(buffer, pointer) {
  const view = cursorView(buffer, pointer);
  if (view === null) return null;
  const firstSequence = view.getUint32(8, true);
  const header = readToolboxCursorHeader(buffer, pointer);
  if (header.status !== "ready") return null;
  const pixels = new Uint8ClampedArray(
    new Uint8Array(buffer, pointer + CURSOR_PIXEL_OFFSET, CURSOR_PIXEL_BYTES),
  );
  if ((firstSequence & 1) !== 0 || view.getUint32(8, true) !== firstSequence) {
    return null;
  }
  return Object.freeze({ ...header, pixels });
}
