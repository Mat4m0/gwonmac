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

function stableFloat(value) {
  return Number.isFinite(value) ? value : 0;
}

function agentKind(type) {
  if ((type & 0x400) !== 0) return "Item";
  if ((type & 0x200) !== 0) return "Gadget";
  if ((type & 0xdb) !== 0) return "Living";
  return "Unknown";
}

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
    playerX: stableFloat(view.getFloat32(32, true)),
    playerY: stableFloat(view.getFloat32(36, true)),
    targetId: view.getUint32(40, true),
    targetType: view.getUint32(44, true),
    targetX: stableFloat(view.getFloat32(48, true)),
    targetY: stableFloat(view.getFloat32(52, true)),
    distance: stableFloat(view.getFloat32(56, true)),
    rangeBand: view.getUint32(60, true),
  };
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== MAGIC
    || abi !== TOOLBOX_SNAPSHOT_ABI
    || byteLength !== TOOLBOX_SNAPSHOT_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
  ) {
    return Object.freeze({ status: "waiting", reason: "snapshot" });
  }
  if ((flags & FLAGS.loading) !== 0) {
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
  const targetValid = (flags & FLAGS.target) !== 0;
  return Object.freeze({
    status: "ready",
    ...state,
    instanceName: INSTANCE_NAMES[state.instanceType] ?? "Unknown",
    targetValid,
    targetKind: targetValid ? agentKind(state.targetType) : "None",
    rangeName: RANGE_NAMES[state.rangeBand] ?? "Unknown",
  });
}
