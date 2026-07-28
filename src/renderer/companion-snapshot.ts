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
const KNOWN_FLAGS = FLAGS.ready | FLAGS.player | FLAGS.target | FLAGS.loading;

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
    !(buffer instanceof ArrayBuffer) ||
    !Number.isInteger(pointer) ||
    pointer < 0 ||
    pointer + COMPANION_SNAPSHOT_BYTES > buffer.byteLength
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
    magic !== MAGIC ||
    abi !== COMPANION_SNAPSHOT_ABI ||
    byteLength !== COMPANION_SNAPSHOT_BYTES ||
    firstSequence !== secondSequence ||
    (secondSequence & 1) !== 0 ||
    (flags & ~KNOWN_FLAGS) !== 0
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
    state.mapId === 0 ||
    state.mapId > 2_000 ||
    state.instanceType > 1 ||
    state.playerId === 0 ||
    !validCoordinate(state.playerX) ||
    !validCoordinate(state.playerY)
  ) {
    return Object.freeze({ status: "waiting", reason: "corrupt" });
  }
  const targetValid = (flags & FLAGS.target) !== 0;
  if (
    targetValid
      ? state.targetId === 0 ||
        (state.agentTypeBits & AGENT_TYPE_BITS) === 0 ||
        !validCoordinate(state.targetX) ||
        !validCoordinate(state.targetY) ||
        !Number.isFinite(state.distance) ||
        state.distance < 0 ||
        state.rangeBand < 1 ||
        state.rangeBand >= RANGE_NAMES.length
      : state.targetId !== 0 ||
        state.agentTypeBits !== 0 ||
        state.targetX !== 0 ||
        state.targetY !== 0 ||
        state.distance !== 0 ||
        state.rangeBand !== 0
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

export const COMPANION_TEAM_ABI = 5;
export const COMPANION_TEAM_BYTES = 1328;

const TEAM_MAGIC = 0x4d545747;
const TEAM_READY = 1 << 0;
const TEAM_HARD_MODE = 1 << 1;
const TEAM_MEMBER_SLOTS = 8;
const TEAM_MEMBER_OFFSET = 48;
const TEAM_MEMBER_BYTES = 160;
const TEAM_ATTRIBUTE_SLOTS = 12;
const TEAM_SKILL_SLOTS = 8;
const PLAYER_BEHAVIOR = 0xffff_ffff;

const MEMBER = Object.freeze({
  agentId: 0,
  heroId: 4,
  primary: 8,
  secondary: 12,
  behavior: 16,
  disabledSkills: 20,
  attributeCount: 24,
  level: 28,
  attributeIds: 32,
  attributeRanks: 80,
  skills: 128,
});

function validAttributeId(id: number) {
  return id <= 44 && (id < 26 || id > 28);
}

function readTeamMember(view: DataView, index: number) {
  const base = TEAM_MEMBER_OFFSET + index * TEAM_MEMBER_BYTES;
  const word = (offset: number) => view.getUint32(base + offset, true);
  const attributeCount = word(MEMBER.attributeCount);
  const attributeIds = Array.from({ length: TEAM_ATTRIBUTE_SLOTS }, (_, slot) =>
    word(MEMBER.attributeIds + slot * 4),
  );
  const attributeRanks = Array.from(
    { length: TEAM_ATTRIBUTE_SLOTS },
    (_, slot) => word(MEMBER.attributeRanks + slot * 4),
  );
  return {
    agentId: word(MEMBER.agentId),
    heroId: word(MEMBER.heroId),
    primary: word(MEMBER.primary),
    secondary: word(MEMBER.secondary),
    behavior: word(MEMBER.behavior),
    disabledSkills: word(MEMBER.disabledSkills),
    attributeCount,
    level: word(MEMBER.level),
    attributeIds,
    attributeRanks,
    skills: Array.from({ length: TEAM_SKILL_SLOTS }, (_, slot) =>
      word(MEMBER.skills + slot * 4),
    ),
  };
}

function emptyTeamMember(member: ReturnType<typeof readTeamMember>) {
  return (
    member.agentId === 0 &&
    member.heroId === 0 &&
    member.primary === 0 &&
    member.secondary === 0 &&
    member.behavior === 0 &&
    member.disabledSkills === 0 &&
    member.attributeCount === 0 &&
    member.level === 0 &&
    member.attributeIds.every((id) => id === 0) &&
    member.attributeRanks.every((rank) => rank === 0) &&
    member.skills.every((id) => id === 0)
  );
}

/**
 * Decode the one canonical live-team region. The kernel has already joined
 * four WorldContext arrays by AgentID; this boundary independently checks the
 * complete fixed record before exposing domain values to reconciliation.
 */
export function readCompanionTeam(buffer: ArrayBuffer, pointer: number) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    !Number.isInteger(pointer) ||
    pointer < 0 ||
    pointer + COMPANION_TEAM_BYTES > buffer.byteLength
  ) {
    return Object.freeze({ status: "waiting", reason: "memory" });
  }
  const view = new DataView(buffer, pointer, COMPANION_TEAM_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" });
  }
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const byteLength = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const tickCount = view.getUint32(16, true);
  const memberCount = view.getUint32(20, true);
  const command = Object.freeze({
    id: view.getUint32(24, true),
    status: view.getUint32(28, true),
    phase: view.getUint32(32, true),
    completedSteps: view.getUint32(36, true),
    error: view.getUint32(40, true),
    warnings: view.getUint32(44, true),
  });
  const members = Array.from({ length: TEAM_MEMBER_SLOTS }, (_, index) =>
    readTeamMember(view, index),
  );
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== TEAM_MAGIC ||
    abi !== COMPANION_TEAM_ABI ||
    byteLength !== COMPANION_TEAM_BYTES ||
    firstSequence !== secondSequence ||
    (secondSequence & 1) !== 0 ||
    (flags & ~(TEAM_READY | TEAM_HARD_MODE)) !== 0 ||
    memberCount > TEAM_MEMBER_SLOTS ||
    command.status > 3 ||
    command.phase > 19 ||
    command.completedSteps > 60 ||
    command.error > 7 ||
    command.warnings > 1 ||
    (command.status === 0 &&
      (command.id !== 0 ||
        command.phase !== 0 ||
        command.completedSteps !== 0 ||
        command.error !== 0 ||
        command.warnings !== 0)) ||
    (command.status === 1 &&
      (command.id === 0 ||
        command.phase < 1 ||
        command.phase > 18 ||
        command.error !== 0)) ||
    (command.status === 2 &&
      (command.id === 0 ||
        command.phase !== 19 ||
        command.error !== 0)) ||
    (command.status === 3 && (command.id === 0 || command.error === 0))
  ) {
    return Object.freeze({ status: "waiting", reason: "team" });
  }
  if ((flags & TEAM_READY) === 0) {
    if (
      memberCount !== 0 ||
      members.some((member) => !emptyTeamMember(member))
    ) {
      return Object.freeze({ status: "waiting", reason: "corrupt" });
    }
    return Object.freeze({
      status: "waiting",
      reason: "game",
      sequence: secondSequence,
      tickCount,
      command,
    });
  }
  if (
    memberCount < 1 ||
    members.slice(memberCount).some((member) => !emptyTeamMember(member))
  ) {
    return Object.freeze({ status: "waiting", reason: "corrupt" });
  }
  const active = members.slice(0, memberCount);
  for (const [index, member] of active.entries()) {
    const ids = member.attributeIds.slice(0, member.attributeCount);
    const ranks = member.attributeRanks.slice(0, member.attributeCount);
    if (
      member.agentId === 0 ||
      member.primary < 1 ||
      member.primary > 10 ||
      member.secondary > 10 ||
      member.secondary === member.primary ||
      member.disabledSkills > 0xff ||
      member.attributeCount > TEAM_ATTRIBUTE_SLOTS ||
      member.level < 1 ||
      member.level > 20 ||
      ids.some((id) => !validAttributeId(id)) ||
      new Set(ids).size !== ids.length ||
      ranks.some((rank) => rank < 1 || rank > 12) ||
      member.attributeIds.slice(member.attributeCount).some((id) => id !== 0) ||
      member.attributeRanks
        .slice(member.attributeCount)
        .some((rank) => rank !== 0) ||
      (index === 0
        ? member.heroId !== 0 || member.behavior !== PLAYER_BEHAVIOR
        : member.heroId < 1 || member.heroId > 39 || member.behavior > 2)
    ) {
      return Object.freeze({ status: "waiting", reason: "corrupt" });
    }
  }
  if (
    new Set(active.map((member) => member.agentId)).size !== active.length ||
    new Set(active.slice(1).map((member) => member.heroId)).size !==
      active.length - 1
  ) {
    return Object.freeze({ status: "waiting", reason: "corrupt" });
  }
  const frozenMembers = Object.freeze(
    active.map((member) =>
      Object.freeze({
        agentId: member.agentId,
        heroId: member.heroId,
        primary: member.primary,
        secondary: member.secondary,
        behavior: member.behavior,
        disabledSkills: member.disabledSkills,
        level: member.level,
        attributes: Object.freeze(
          member.attributeIds
            .slice(0, member.attributeCount)
            .map((id, index) =>
              Object.freeze({ id, rank: member.attributeRanks[index]! }),
            ),
        ),
        skills: Object.freeze(member.skills),
      }),
    ),
  );
  const heroes = Object.freeze(frozenMembers.slice(1));
  return Object.freeze({
    status: "ready",
    sequence: secondSequence,
    tickCount,
    hardMode: (flags & TEAM_HARD_MODE) !== 0,
    command,
    members: frozenMembers,
    player: frozenMembers[0]!,
    heroes,
    heroIds: Object.freeze(heroes.map((member) => member.heroId)),
    heroAgentIds: Object.freeze(heroes.map((member) => member.agentId)),
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
    !(buffer instanceof ArrayBuffer) ||
    !Number.isInteger(pointer) ||
    pointer < 0 ||
    pointer + COMPANION_CURSOR_BYTES > buffer.byteLength
  ) {
    return null;
  }
  return new DataView(buffer, pointer, COMPANION_CURSOR_BYTES);
}

/**
 * Header-only read for the per-frame change check. Never touches the payload.
 */
export function readCompanionCursorHeader(
  buffer: ArrayBuffer,
  pointer: number,
) {
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
    magic !== CURSOR_MAGIC ||
    abi !== COMPANION_CURSOR_ABI ||
    byteLength !== COMPANION_CURSOR_BYTES ||
    firstSequence !== secondSequence ||
    (secondSequence & 1) !== 0 ||
    (flags & ~KNOWN_CURSOR_FLAGS) !== 0 ||
    reserved !== 0
  ) {
    return Object.freeze({ status: "waiting", reason: "cursor" });
  }
  // Unsupported is a terminal state, not a modifier: it must stand alone.
  if (
    (flags & CURSOR_FLAGS.unsupported) !== 0 &&
    flags !== CURSOR_FLAGS.unsupported
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
    generation === 0 ||
    width !== CURSOR_EDGE ||
    height !== CURSOR_EDGE ||
    hotspotX >= CURSOR_EDGE ||
    hotspotY >= CURSOR_EDGE
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
export function readCompanionCursorPixels(
  buffer: ArrayBuffer,
  pointer: number,
) {
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
