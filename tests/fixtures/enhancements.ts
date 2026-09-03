import { readFile } from "node:fs/promises";
import {
  COMPANION_ABI,
  COMPANION_DISPATCH_KINDS,
  COMPANION_FEATURE_BITS,
} from "../../src/shared/companion-abi.ts";
import {
  readCompanionCursorHeader,
  readCompanionCursorPixels,
  readChangedCompanionParty,
  readChangedCompanionToolbox,
  readCompanionSnapshot,
  readCompanionToolbox,
  sameCompanionToolboxState,
  COMPANION_SNAPSHOT_ABI,
  COMPANION_SNAPSHOT_BYTES,
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  COMPANION_TOOLBOX_BYTES,
  COMPANION_PARTY_BYTES,
  readCompanionParty,
} from "../../src/renderer/companion-snapshot.ts";
import {
  COMPANION_SKILL_COOLDOWN_BYTES,
  readCompanionSkillSlots,
  readCompanionSkillCooldowns,
  COMPANION_SKILL_SLOT_BYTES,
} from "../../src/renderer/companion-skill-snapshot.ts";
import { readCompanionFriends } from "../../src/renderer/companion-friend-snapshot.ts";
import {
  COMPANION_PLAY_REGION_BYTES,
  readCompanionPlayRegion,
} from "../../src/renderer/companion-play-region-snapshot.ts";
import {
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_LAYOUT_WORD_COUNT,
} from "../../src/shared/enhancement-contracts.ts";
import {
  ENHANCEMENT_CONFIG_FIELDS,
  ENHANCEMENT_LAYOUT_FIELDS,
} from "../../src/shared/enhancement-config.ts";

// Every read returns a discriminated union: `reason` belongs to the members
// that rejected the region, the decoded fields to the members that accepted
// it. Narrowing through the helpers below keeps each assertion pointed at the
// member it is about — a read that lands on the wrong one now fails by name
// instead of quietly comparing `undefined`.
export type SnapshotRead = ReturnType<typeof readCompanionSnapshot>;
export type CursorHeaderRead = ReturnType<typeof readCompanionCursorHeader>;
export type CursorPixelsRead = ReturnType<typeof readCompanionCursorPixels>;
export type ToolboxRead = ReturnType<typeof readCompanionToolbox>;

export function decoded(read: SnapshotRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a decoded snapshot, got ${JSON.stringify(read)}`);
  }
  return read;
}

export function rejected(read: SnapshotRead) {
  if (read.status === "ready") {
    throw new Error("expected a rejected snapshot, got a decoded one");
  }
  return read.reason;
}

export function readyCursor(read: CursorHeaderRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a published cursor, got ${JSON.stringify(read)}`);
  }
  return read;
}

// "invalid" is not "waiting": it carries the cleared geometry the renderer is
// expected to keep reading, so it narrows separately from the members that are
// nothing but a reason.
export function invalidCursor(read: CursorHeaderRead) {
  if (read.status !== "invalid") {
    throw new Error(`expected an invalidated cursor, got ${JSON.stringify(read)}`);
  }
  return read;
}

export function cursorReason(read: CursorHeaderRead) {
  if (read.status === "ready") {
    throw new Error("expected a rejected cursor header, got a published one");
  }
  return read.reason;
}

export function publishedPixels(read: CursorPixelsRead) {
  if (read === null) throw new Error("the kernel published no cursor bitmap");
  return read;
}

export function readyParty(read: ReturnType<typeof readCompanionParty>) {
  if (read.status !== "ready") {
    throw new Error(`expected a party region, got ${JSON.stringify(read)}`);
  }
  return read;
}

export function readyToolbox(read: ToolboxRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a toolbox snapshot, got ${JSON.stringify(read)}`);
  }
  return read;
}

export const MAGIC = 0x42545747;
export const FEATURE_NATIVE_CURSOR = COMPANION_FEATURE_BITS.nativeCursor;
export const FEATURE_GAME_SNAPSHOT = COMPANION_FEATURE_BITS.gameSnapshot;
export const FEATURE_TOOLBOX_FOUNDATION =
  COMPANION_FEATURE_BITS.toolboxFoundation;
export const FEATURE_TARGET_OBSERVATION =
  COMPANION_FEATURE_BITS.targetObservation;
export const FEATURE_SKILL_SLOT_GEOMETRY =
  COMPANION_FEATURE_BITS.skillSlotGeometry;
export const FEATURE_SKILL_COOLDOWN_OBSERVATION =
  COMPANION_FEATURE_BITS.skillCooldownObservation;
export const FEATURE_PLAY_REGION_OBSERVATION =
  COMPANION_FEATURE_BITS.playRegionObservation;
export { COMPANION_PLAY_REGION_BYTES };
export const ALL_FEATURES = FEATURE_NATIVE_CURSOR
  | FEATURE_GAME_SNAPSHOT
  | FEATURE_TARGET_OBSERVATION
  | FEATURE_PLAY_REGION_OBSERVATION;

export interface SnapshotOverrides {
  sequence?: number;
  flags?: number;
  tickCount?: number;
  mapId?: number;
  instanceType?: number;
  playRegion?: number;
  playerId?: number;
  playerX?: number;
  playerY?: number;
  targetId?: number;
  targetType?: number;
  targetX?: number;
  targetY?: number;
  distance?: number;
  rangeBand?: number;
}

export function snapshot(overrides: SnapshotOverrides = {}) {
  const buffer = new ArrayBuffer(COMPANION_SNAPSHOT_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, COMPANION_SNAPSHOT_ABI, true);
  view.setUint16(6, COMPANION_SNAPSHOT_BYTES, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  const flags = overrides.flags ?? (7 | 1 << 6);
  const hasPlayer = (flags & 2) !== 0;
  const hasTarget = (flags & 4) !== 0;
  view.setUint32(12, flags, true);
  view.setUint32(16, overrides.tickCount ?? 40, true);
  view.setUint32(20, overrides.mapId ?? (hasPlayer ? 133 : 0), true);
  view.setUint32(
    24,
    (overrides.instanceType ?? 0) | ((overrides.playRegion ?? 1) << 8),
    true,
  );
  view.setUint32(28, overrides.playerId ?? (hasPlayer ? 7 : 0), true);
  view.setFloat32(32, overrides.playerX ?? (hasPlayer ? -9827.3 : 0), true);
  view.setFloat32(36, overrides.playerY ?? (hasPlayer ? 34130.2 : 0), true);
  view.setUint32(40, overrides.targetId ?? (hasTarget ? 9 : 0), true);
  view.setUint32(44, overrides.targetType ?? (hasTarget ? 0xdb : 0), true);
  view.setFloat32(48, overrides.targetX ?? (hasTarget ? -9700 : 0), true);
  view.setFloat32(52, overrides.targetY ?? (hasTarget ? 34100 : 0), true);
  view.setFloat32(56, overrides.distance ?? (hasTarget ? 130.8 : 0), true);
  view.setUint32(60, overrides.rangeBand ?? (hasTarget ? 1 : 0), true);
  return buffer;
}

export const CURSOR_MAGIC = 0x43545747;
export const CURSOR_VALID = 1 << 0;
export const CURSOR_HIDDEN = 1 << 1;
export const CURSOR_UNSUPPORTED = 1 << 2;
export const CURSOR_EDGE = 32;
export const CURSOR_WORDS = CURSOR_EDGE * CURSOR_EDGE;
export const CURSOR_PIXEL_BYTES = CURSOR_WORDS * 4;
// Field offsets of the cursor region, version 1.
export const CURSOR = Object.freeze({
  magic: 0,
  abi: 4,
  byteLength: 6,
  sequence: 8,
  flags: 12,
  generation: 16,
  width: 20,
  height: 24,
  hotspotX: 28,
  hotspotY: 32,
  pixelHash: 36,
  reserved: 40,
  pixels: 64,
});

export interface CursorOverrides {
  magic?: number;
  abi?: number;
  byteLength?: number;
  sequence?: number;
  flags?: number;
  generation?: number;
  width?: number;
  height?: number;
  hotspotX?: number;
  hotspotY?: number;
  pixelHash?: number;
  reservedWord?: number;
  reservedIndex?: number;
}

export function cursorRegion(overrides: CursorOverrides = {}) {
  const buffer = new ArrayBuffer(COMPANION_CURSOR_BYTES);
  const view = new DataView(buffer);
  view.setUint32(CURSOR.magic, overrides.magic ?? CURSOR_MAGIC, true);
  view.setUint16(CURSOR.abi, overrides.abi ?? COMPANION_CURSOR_ABI, true);
  view.setUint16(
    CURSOR.byteLength,
    overrides.byteLength ?? COMPANION_CURSOR_BYTES,
    true,
  );
  view.setUint32(CURSOR.sequence, overrides.sequence ?? 2, true);
  view.setUint32(CURSOR.flags, overrides.flags ?? CURSOR_VALID, true);
  view.setUint32(CURSOR.generation, overrides.generation ?? 1, true);
  view.setUint32(CURSOR.width, overrides.width ?? CURSOR_EDGE, true);
  view.setUint32(CURSOR.height, overrides.height ?? CURSOR_EDGE, true);
  view.setUint32(CURSOR.hotspotX, overrides.hotspotX ?? 3, true);
  view.setUint32(CURSOR.hotspotY, overrides.hotspotY ?? 4, true);
  view.setUint32(CURSOR.pixelHash, overrides.pixelHash ?? 0x1357_9bdf, true);
  if (overrides.reservedWord !== undefined) {
    view.setUint32(
      CURSOR.reserved + 4 * (overrides.reservedIndex ?? 0),
      overrides.reservedWord,
      true,
    );
  }
  for (let index = 0; index < CURSOR_WORDS; index += 1) {
    view.setUint32(CURSOR.pixels + index * 4, 0xff20_4060, true);
  }
  return buffer;
}

// FNV-1a over the source BGRA words, computed independently of the kernel.
export function fnv1a(words: Uint32Array) {
  let hash = 0x811c_9dc5;
  for (const word of words) hash = Math.imul(hash ^ word, 0x0100_0193);
  return hash >>> 0;
}

// BGRA -> RGBA: keep alpha and green, swap red and blue.
export function expectedRgba(words: Uint32Array) {
  const bytes = new Uint8ClampedArray(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((word, index) => {
    const rgba =
      (word & 0xff00_ff00) | ((word >>> 16) & 0xff) | ((word & 0xff) << 16);
    view.setUint32(index * 4, rgba >>> 0, true);
  });
  return bytes;
}

export const ADDRESSES = Object.freeze({
  snapshot: 0x1000,
  config: 0x1100,
  contextRoot: 0x2000,
  contexts: 0x2100,
  game: 0x2200,
  character: 0x2300,
  agentArray: 0x2400,
  agentBuffer: 0x2500,
  player: 0x2600,
  target: 0x2800,
  manualTargetId: 0x2a00,
  automaticTargetId: 0x2a04,
  cursor: 0x4000,
  colorBuffer: 0x6000,
  activeArt: 0x8000,
  softwareModel: 0x8004,
  showCount: 0x8008,
  art: 0x8100,
  handle: 0x8200,
  textureView: 0x8300,
  texture: 0x8400,
  toolbox: 0x9000,
  party: 0xa800,
  skillSlots: 0xc000,
  skillCooldowns: 0xc100,
  playRegion: 0xc200,
  characterList: 0xc300,
  friends: 0x5_0000,
  friendRoot: 0x5_4000,
  friendArray: 0x5_4100,
  friendRecord: 0x5_4200,
  characterArrayPointer: 0xd600,
  characterArrayCount: 0xd604,
  selectedCharacterName: 0xd608,
  characterRecordBuffer: 0x4_0000,
  partyContext: 0xa000,
  partyInfo: 0xa100,
  heroBuffer: 0xa200,
  account: 0xb000,
  accountSkillBuffer: 0xb400,
  characterSkillBuffer: 0xb600,
  world: 0x1_0000,
  heroFlagBuffer: 0x1_1000,
  heroInfoBuffer: 0x1_2000,
  professionStateBuffer: 0x1_2800,
  skillbarBuffer: 0x1_3000,
  attributeBuffer: 0x1_4000,
  playerRecordBuffer: 0x1_5000,
  travelUnlockBuffer: 0x1_6000,
  areaInfo: 0x20_0000,
  frameArrayGlobal: 0x21_0000,
  frameCountGlobal: 0x21_0004,
  frameTable: 0x21_1000,
  frameBuffer: 0x21_2000,
  companionRuntime: 0x30_0000,
});

/**
 * The party-detail offsets, exactly as certified against build 38,797.
 *
 * Written out rather than imported from `enhancement-builds.ts`: the fixture
 * has to be able to disagree with the shipped table, or it is checking that
 * the kernel reads the words it was given rather than that it reads them
 * correctly.
 */
export const DETAIL = Object.freeze({
  heroLevel: 0x14,
  partyPlayers: 0x04, partyHenchmen: 0x14, partyFlag: 0x14,
  accountContextSlot: 10, accountUnlockedSkills: 0x124,
  worldContext: 0x2c,
  heroFlags: 0x584, flagStride: 0x24,
  flagHeroId: 0x00, flagAgentId: 0x04, flagBehavior: 0x0c,
  heroInfo: 0x594, infoStride: 0x9c,
  infoHeroId: 0x00, infoAgentId: 0x04, infoLevel: 0x08,
  infoPrimary: 0x0c, infoSecondary: 0x10, infoAppearance: 0x48,
  skillbars: 0x6f0, skillbarStride: 0xbc,
  skillbarAgentId: 0x00, skillbarSkills: 0x04,
  skillSlotStride: 0x14, skillSlotId: 0x0c, skillbarDisabled: 0xa4,
  attributes: 0xac, attributeStride: 0x43c,
  attributeAgentId: 0x00, attributeEntries: 0x04,
  attributeEntryStride: 0x14, attributeEntryId: 0x00, attributeEntryRank: 0x04,
  professionStates: 0x6bc, professionStateStride: 0x14,
  characterSkills: 0x710,
  players: 0x80c, playerStride: 0x50,
  playerAgentId: 0x00, playerAccessFlags: 0x34, playerNumber: 0x38,
  areaInfoType: 0x08,
});
export const PARTY_DIRTY_MESSAGES = Object.freeze([
  0x1000_0038,
  0x1000_0039,
  0x1000_008c,
  0x1000_0098,
  0x1000_00c2,
  0x1000_0111,
  0x1000_011e,
  0x1000_011f,
  0x1000_0124,
  0x1000_0126,
] as const);
/**
 * Where the party-detail block starts, derived rather than written as `36`.
 *
 * That literal is exactly the shape of the bug `MESSAGE_CONFIG_START` below
 * records: the messages were written as a flat continuation of the address
 * words, the layout grew, and they silently stayed a full detail block short of
 * where the kernel reads them.
 */
export const DETAIL_CONFIG_START = ENHANCEMENT_LAYOUT_FIELDS.indexOf("heroLevel");
export const POLICY_CONFIG_START = ENHANCEMENT_LAYOUT_FIELDS.indexOf("areaInfo");
export const PLAYER_CONFIG_START = ENHANCEMENT_LAYOUT_FIELDS.indexOf("worldProfessionStates");
export const XUNLAI_CONFIG_START = ENHANCEMENT_LAYOUT_FIELDS.indexOf("worldPlayers");
export const SKILL_CONFIG_START = ENHANCEMENT_LAYOUT_FIELDS.indexOf("frameArray");
export const COOLDOWN_CONFIG_START = ENHANCEMENT_LAYOUT_FIELDS.indexOf(
  "skillSlotRecharge",
);

export function setConfigField(
  config: Uint32Array,
  key: (typeof ENHANCEMENT_LAYOUT_FIELDS)[number],
  value: number,
): void {
  const index = ENHANCEMENT_LAYOUT_FIELDS.indexOf(key);
  if (index < 0) throw new Error(`unknown Enhancement config field ${key}`);
  config[index] = value;
}

/** Installs only the observation and player-skillbar words cooldown owns. */
export function installPlayerSkillbarConfig(config: Uint32Array): void {
  const seeded = config.slice();
  const owners = new Set([
    "play-region", "observation", "player-skillbar", "skill-cooldown",
  ]);
  config.fill(0);
  ENHANCEMENT_CONFIG_FIELDS.forEach((field, index) => {
    if (owners.has(field.owner)) config[index] = seeded[index]!;
  });
  setConfigField(config, "worldContext", DETAIL.worldContext);
  setConfigField(config, "worldSkillbars", DETAIL.skillbars);
  setConfigField(config, "skillbarStride", DETAIL.skillbarStride);
  setConfigField(config, "skillbarAgentId", DETAIL.skillbarAgentId);
  setConfigField(config, "skillbarSkills", DETAIL.skillbarSkills);
  setConfigField(config, "skillSlotStride", DETAIL.skillSlotStride);
  setConfigField(config, "skillSlotRecharge", 0x08);
}

/** Installs a bounded skillbar array without any Party/detail tables. */
export function installPlayerSkillbarGraph(
  view: DataView,
  agentIds: readonly number[] = [7],
): void {
  view.setUint32(ADDRESSES.world + DETAIL.skillbars, ADDRESSES.skillbarBuffer, true);
  view.setUint32(ADDRESSES.world + DETAIL.skillbars + 4, agentIds.length, true);
  view.setUint32(ADDRESSES.world + DETAIL.skillbars + 8, agentIds.length, true);
  agentIds.forEach((agentId, index) => {
    const row = ADDRESSES.skillbarBuffer + index * DETAIL.skillbarStride;
    view.setUint32(row + DETAIL.skillbarAgentId, agentId, true);
  });
}
export const PLAYER_RECORD_INDEX = 42;
export const PLAYER_RECORD_ADDRESS =
  ADDRESSES.playerRecordBuffer + PLAYER_RECORD_INDEX * DETAIL.playerStride;
export const CONFIG_WORDS = ENHANCEMENT_CONFIG_WORD_COUNT;
export const CONFIG_BYTES = CONFIG_WORDS * 4;
export const MESSAGE_CONFIG_START = ENHANCEMENT_LAYOUT_WORD_COUNT;
export const TEXTURE_KEY = 0x6772_7478;

export interface KernelOverrides {
  features?: number;
  snapshotPointer?: number;
  snapshotSize?: number;
  configPointer?: number;
  configSize?: number;
  cursorPointer?: number;
  cursorSize?: number;
  toolboxPointer?: number;
  partyPointer?: number;
  partySize?: number;
  skillSlotPointer?: number;
  skillSlotSize?: number;
  skillCooldownPointer?: number;
  skillCooldownSize?: number;
  playRegionPointer?: number;
  playRegionSize?: number;
  characterListPointer?: number;
  characterListSize?: number;
  friendPointer?: number;
  friendSize?: number;
  friendRoot?: number;
  toolboxSize?: number;
}

/**
 * A `.wasm` binary carries its signatures nowhere TypeScript can read them, so
 * `WebAssembly.Exports` is `Record<string, ExportValue>` and this is the one
 * dynamic boundary in the file. The `typeof` checks prove the two exports are
 * callable; the arities come from `src/companion-kernel/lib.rs`, and every
 * call below is checked against these declarations rather than against
 * `Function`.
 */
export type KernelInit = (
  snapshotPointer: number,
  snapshotSize: number,
  configPointer: number,
  configSize: number,
  cursorPointer: number,
  cursorSize: number,
  toolboxPointer: number,
  toolboxSize: number,
  partyPointer: number,
  partySize: number,
  skillSlotPointer: number,
  skillSlotSize: number,
  skillCooldownPointer: number,
  skillCooldownSize: number,
  playRegionPointer: number,
  playRegionSize: number,
  characterListPointer: number,
  characterListSize: number,
  friendPointer: number,
  friendSize: number,
  friendRoot: number,
  features: number,
) => number;
export type KernelDispatch = (
  kind: number,
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
) => void;

export function kernelExports(exports: WebAssembly.Exports) {
  const init = exports["companion_init"];
  const dispatch = exports["companion_dispatch"];
  if (
    typeof init !== "function"
    || typeof dispatch !== "function"
  ) {
    throw new Error("companion-kernel.wasm did not export its foundation ABI");
  }
  return {
    init: init as KernelInit,
    dispatch: dispatch as KernelDispatch,
  };
}

export async function createKernel(
  /** Write the party-detail and attribute words. Zero otherwise, which is what
   *  the kernel reads as "not certified, do not traverse". */
  { partyDetail = false }: { partyDetail?: boolean } = {},
) {
  const bytes = await readFile("build/renderer/companion-kernel.wasm");
  const memory = new WebAssembly.Memory({ initial: 256 });
  const view = new DataView(memory.buffer);
  const immutableI32 = (value: number) => new WebAssembly.Global(
    { value: "i32", mutable: false },
    value,
  );
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      memory,
      __indirect_function_table: new WebAssembly.Table({
        initial: 0,
        maximum: 0,
        element: "anyfunc",
      }),
      __memory_base: immutableI32(ADDRESSES.companionRuntime),
      __stack_pointer: new WebAssembly.Global(
        { value: "i32", mutable: true },
        ADDRESSES.companionRuntime + 65_536,
      ),
      __table_base: immutableI32(0),
    },
  });
  const exports = kernelExports(instance.exports);
  const config = new Uint32Array(memory.buffer, ADDRESSES.config, CONFIG_WORDS);
  // Address words first: core, cursor, then the first-owned-hero party chain.
  // The party-detail words after them stay zero — these fixtures exercise
  // the walk that does not read them, and zero is what the kernel treats as
  // "not certified, do not traverse".
  config.set([
    ADDRESSES.contextRoot, ADDRESSES.agentArray,
    ADDRESSES.manualTargetId, ADDRESSES.automaticTargetId,
    6, 0x44, 0x198, 0x19c,
    0x234, 0x23c, 0x2ac, 0x2c, 0x74, 0x78, 0x9c, 0xf4, 0xf6,
    ADDRESSES.activeArt, ADDRESSES.softwareModel, ADDRESSES.showCount,
    ADDRESSES.colorBuffer,
    0x00, 0x0c, 0x08, 0x00, 0x08, 0x0c, 0x14, 0x18,
    0x4c, 0x54, 0x24, 0x18, 0x00, 0x04, 0x08,
  ]);
  // The detail words stay zero unless asked for: zero is what the kernel reads
  // as "not certified, do not traverse", and most of these fixtures exercise
  // the walk that stops at the roster.
  if (partyDetail) {
    config.set([
      DETAIL.heroLevel, DETAIL.partyPlayers, DETAIL.partyHenchmen, DETAIL.partyFlag,
      DETAIL.accountContextSlot, DETAIL.accountUnlockedSkills,
      DETAIL.worldContext,
      DETAIL.heroFlags, DETAIL.flagStride,
      DETAIL.flagHeroId, DETAIL.flagAgentId, DETAIL.flagBehavior,
      DETAIL.heroInfo, DETAIL.infoStride,
      DETAIL.infoHeroId, DETAIL.infoAgentId, DETAIL.infoLevel,
      DETAIL.infoPrimary, DETAIL.infoSecondary, DETAIL.infoAppearance,
      DETAIL.skillbars, DETAIL.skillbarStride,
      DETAIL.skillbarAgentId, DETAIL.skillbarSkills,
      DETAIL.skillSlotStride, DETAIL.skillSlotId, DETAIL.skillbarDisabled,
      DETAIL.attributes, DETAIL.attributeStride,
      DETAIL.attributeAgentId, DETAIL.attributeEntries,
      DETAIL.attributeEntryStride, DETAIL.attributeEntryId,
      DETAIL.attributeEntryRank,
    ], DETAIL_CONFIG_START);
  }
  config.set([ADDRESSES.areaInfo, 883, 0x7c, 0x10], POLICY_CONFIG_START);
  config.set(
    [DETAIL.professionStates, DETAIL.professionStateStride, DETAIL.characterSkills],
    PLAYER_CONFIG_START,
  );
  config.set([
    DETAIL.players, DETAIL.playerStride, DETAIL.playerAgentId,
    DETAIL.playerAccessFlags, DETAIL.playerNumber, DETAIL.areaInfoType,
  ], XUNLAI_CONFIG_START);
  config.set([
    ADDRESSES.frameArrayGlobal, ADDRESSES.frameCountGlobal,
    0x1c8, 0xb8, 0xbc, 0xd8, 0x104, 0x108,
    0x10c, 0x110, 0x114, 0x118, 0x128, 0x18c,
  ], SKILL_CONFIG_START);
  config[ENHANCEMENT_LAYOUT_FIELDS.indexOf("worldUnlockedMaps")] = 0x60c;
  config[ENHANCEMENT_LAYOUT_FIELDS.indexOf("characterUuid")] = 0x64;
  // Placed at the boundary rather than appended to the literal above. Written
  // as one flat list, the messages sat directly after the party chain — and
  // when the layout grew they silently stayed there, a full detail block short of
  // where the kernel now reads them, and every init refused.
  config.set(
    [0x1000_0082, 0x1000_01a3, 0x1000_01a4, ...PARTY_DIRTY_MESSAGES],
    MESSAGE_CONFIG_START,
  );
  return {
    instance,
    memory,
    view,
    config,
    init: (overrides: KernelOverrides = {}) => {
      const features = overrides.features ?? ALL_FEATURES;
      return exports.init(
        overrides.snapshotPointer
          ?? ((features & FEATURE_GAME_SNAPSHOT) !== 0
            ? ADDRESSES.snapshot
            : 0),
        overrides.snapshotSize
          ?? ((features & FEATURE_GAME_SNAPSHOT) !== 0 ? 64 : 0),
        overrides.configPointer ?? ADDRESSES.config,
        overrides.configSize ?? CONFIG_BYTES,
        overrides.cursorPointer
          ?? ((features & FEATURE_NATIVE_CURSOR) !== 0
            ? ADDRESSES.cursor
            : 0),
        overrides.cursorSize
          ?? ((features & FEATURE_NATIVE_CURSOR) !== 0
            ? COMPANION_CURSOR_BYTES
            : 0),
        overrides.toolboxPointer
          ?? ((features & FEATURE_TOOLBOX_FOUNDATION) !== 0
            ? ADDRESSES.toolbox
            : 0),
        overrides.toolboxSize
          ?? ((features & FEATURE_TOOLBOX_FOUNDATION) !== 0
            ? COMPANION_TOOLBOX_BYTES
            : 0),
        overrides.partyPointer
          ?? ((features & FEATURE_TOOLBOX_FOUNDATION) !== 0
            ? ADDRESSES.party
            : 0),
        overrides.partySize
          ?? ((features & FEATURE_TOOLBOX_FOUNDATION) !== 0
            ? COMPANION_PARTY_BYTES
            : 0),
        overrides.skillSlotPointer
          ?? ((features & FEATURE_SKILL_SLOT_GEOMETRY) !== 0
            ? ADDRESSES.skillSlots
            : 0),
        overrides.skillSlotSize
          ?? ((features & FEATURE_SKILL_SLOT_GEOMETRY) !== 0
            ? COMPANION_SKILL_SLOT_BYTES
            : 0),
        overrides.skillCooldownPointer
          ?? ((features & FEATURE_SKILL_COOLDOWN_OBSERVATION) !== 0
            ? ADDRESSES.skillCooldowns
            : 0),
        overrides.skillCooldownSize
          ?? ((features & FEATURE_SKILL_COOLDOWN_OBSERVATION) !== 0
            ? COMPANION_SKILL_COOLDOWN_BYTES
            : 0),
        overrides.playRegionPointer
          ?? ((features & FEATURE_PLAY_REGION_OBSERVATION) !== 0
            ? ADDRESSES.playRegion
            : 0),
        overrides.playRegionSize
          ?? ((features & FEATURE_PLAY_REGION_OBSERVATION) !== 0
            ? COMPANION_PLAY_REGION_BYTES
            : 0),
        overrides.characterListPointer ?? 0,
        overrides.characterListSize ?? 0,
        overrides.friendPointer
          ?? ((features & COMPANION_FEATURE_BITS.friendObservation) !== 0 ? ADDRESSES.friends : 0),
        overrides.friendSize
          ?? ((features & COMPANION_FEATURE_BITS.friendObservation) !== 0 ? COMPANION_ABI.friends.bytes : 0),
        overrides.friendRoot ?? 0,
        features,
      );
    },
    tick: (skillBarFrameId = 0, skillTimer = 0) => exports.dispatch(
      COMPANION_DISPATCH_KINDS.tick,
      123,
      skillBarFrameId,
      skillTimer,
      0,
      0,
    ),
    cursorEvent: (...args: number[]) =>
      exports.dispatch(
        COMPANION_DISPATCH_KINDS.cursor,
        args[0] ?? 1,
        args[1] ?? 2,
        args[2] ?? 3,
        args[3] ?? 4,
        args[4] ?? 5,
      ),
    uiEvent: (message: number, wparam: number, lparam: number) =>
      exports.dispatch(
        COMPANION_DISPATCH_KINDS.ui,
        message,
        wparam,
        lparam,
        0,
        0,
      ),
    friendLifecycle: (event: number, request = 0, connection = 0, success = 0) =>
      exports.dispatch(COMPANION_DISPATCH_KINDS.friendLifecycle, event, request, connection, success, 0),
    friends: () => readCompanionFriends(memory.buffer, ADDRESSES.friends),
    activeFeatures: (features: number) =>
      exports.dispatch(
        COMPANION_DISPATCH_KINDS.activeFeatures,
        features,
        0,
        0,
        0,
        0,
      ),
    toolbox: () => readCompanionToolbox(memory.buffer, ADDRESSES.toolbox),
    party: () => readCompanionParty(memory.buffer, ADDRESSES.party),
    skillSlots: () => readCompanionSkillSlots(memory.buffer, ADDRESSES.skillSlots),
    skillCooldowns: () =>
      readCompanionSkillCooldowns(memory.buffer, ADDRESSES.skillCooldowns),
    playRegion: () => readCompanionPlayRegion(memory.buffer, ADDRESSES.playRegion),
    field: (offset: number) => view.getUint32(ADDRESSES.cursor + offset, true),
    header: () => readCompanionCursorHeader(memory.buffer, ADDRESSES.cursor),
    published: () => readCompanionCursorPixels(memory.buffer, ADDRESSES.cursor),
    payload: () => {
      const bytes = new Uint8ClampedArray(CURSOR_PIXEL_BYTES);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = view.getUint8(ADDRESSES.cursor + CURSOR.pixels + index);
      }
      return bytes;
    },
  };
}

export function installGameGraph(view: DataView) {
  view.setUint32(ADDRESSES.contextRoot, ADDRESSES.contexts, true);
  view.setUint32(ADDRESSES.contexts + 24, ADDRESSES.game, true);
  view.setUint32(
    ADDRESSES.contexts + DETAIL.accountContextSlot * 4,
    ADDRESSES.account,
    true,
  );
  view.setUint32(ADDRESSES.game + 0x44, ADDRESSES.character, true);
  view.setUint32(ADDRESSES.character + 0x198, 133, true);
  view.setUint32(ADDRESSES.character + 0x19c, 0, true);
  view.setUint32(ADDRESSES.character + 0x234, 133, true);
  view.setUint32(ADDRESSES.character + 0x23c, 0, true);
  view.setUint32(ADDRESSES.character + 0x2ac, 42, true);
  view.setUint32(ADDRESSES.character + 0x64, 0x0403_0201, true);
  view.setUint32(ADDRESSES.character + 0x68, 0x0807_0605, true);
  view.setUint32(ADDRESSES.character + 0x6c, 0x0c0b_0a09, true);
  view.setUint32(ADDRESSES.character + 0x70, 0x100f_0e0d, true);
  const area = ADDRESSES.areaInfo + 133 * 0x7c;
  view.setUint32(area + 0x00, 1, true);
  view.setUint32(area + 0x04, 0, true);
  view.setUint32(area + 0x08, 0, true);
  view.setUint32(area + 0x0c, 13, true);
  view.setUint32(area + 0x10, 0, true);
  view.setUint32(ADDRESSES.agentArray, ADDRESSES.agentBuffer, true);
  view.setUint32(ADDRESSES.agentArray + 4, 16, true);
  view.setUint32(ADDRESSES.agentArray + 8, 10, true);
  view.setUint32(ADDRESSES.agentBuffer + 7 * 4, ADDRESSES.player, true);
  view.setUint32(ADDRESSES.agentBuffer + 9 * 4, ADDRESSES.target, true);
  view.setUint32(ADDRESSES.player + 0x2c, 7, true);
  view.setFloat32(ADDRESSES.player + 0x74, 10, true);
  view.setFloat32(ADDRESSES.player + 0x78, 20, true);
  view.setUint32(ADDRESSES.player + 0x9c, 0xdb, true);
  view.setUint16(ADDRESSES.player + 0xf4, 42, true);
  view.setUint16(ADDRESSES.player + 0xf6, 0x3000, true);
  view.setUint8(ADDRESSES.player + 0x10a, 3);
  view.setUint8(ADDRESSES.player + 0x10b, 5);
  view.setUint32(ADDRESSES.target + 0x2c, 9, true);
  view.setFloat32(ADDRESSES.target + 0x74, 110, true);
  view.setFloat32(ADDRESSES.target + 0x78, 20, true);
  view.setUint32(ADDRESSES.target + 0x9c, 0xdb, true);
  view.setUint32(ADDRESSES.manualTargetId, 9, true);
  view.setUint32(ADDRESSES.game + 0x4c, ADDRESSES.partyContext, true);
  view.setUint32(ADDRESSES.game + DETAIL.worldContext, ADDRESSES.world, true);
  view.setUint32(ADDRESSES.world + 0x60c, ADDRESSES.travelUnlockBuffer, true);
  view.setUint32(ADDRESSES.world + 0x610, 28, true);
  view.setUint32(ADDRESSES.world + 0x614, 28, true);
  view.setUint32(
    ADDRESSES.travelUnlockBuffer + Math.floor(133 / 32) * 4,
    1 << (133 % 32),
    true,
  );
  view.setUint32(ADDRESSES.world + DETAIL.players, ADDRESSES.playerRecordBuffer, true);
  view.setUint32(ADDRESSES.world + DETAIL.players + 4, 64, true);
  view.setUint32(ADDRESSES.world + DETAIL.players + 8, PLAYER_RECORD_INDEX + 1, true);
  view.setUint32(
    PLAYER_RECORD_ADDRESS + DETAIL.playerAgentId,
    7,
    true,
  );
  view.setUint32(
    PLAYER_RECORD_ADDRESS + DETAIL.playerAccessFlags,
    0,
    true,
  );
  view.setUint32(
    PLAYER_RECORD_ADDRESS + DETAIL.playerNumber,
    PLAYER_RECORD_INDEX,
    true,
  );
  view.setUint32(ADDRESSES.partyContext + 0x54, ADDRESSES.partyInfo, true);
  view.setUint32(ADDRESSES.partyInfo + 0x24, ADDRESSES.heroBuffer, true);
  view.setUint32(ADDRESSES.partyInfo + 0x28, 2, true);
  view.setUint32(ADDRESSES.partyInfo + 0x2c, 2, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x00, 77, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x04, 42, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x08, 1, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x18, 88, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x1c, 99, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x20, 2, true);
}

/** Install one visible SkillBar parent and its eight visible slot children. */
export function installSkillBarGraph(view: DataView, parentId = 1) {
  const frameBytes = 0x1c8;
  const frame = (id: number) => ADDRESSES.frameBuffer + id * frameBytes;
  view.setUint32(ADDRESSES.frameArrayGlobal, ADDRESSES.frameTable, true);
  view.setUint32(ADDRESSES.frameCountGlobal, 10, true);
  for (let id = 1; id <= 9; id += 1) {
    view.setUint32(ADDRESSES.frameTable + id * 4, frame(id), true);
    view.setUint32(frame(id) + 0xbc, id, true);
    view.setUint32(frame(id) + 0x18c, 0x4, true);
  }
  for (let slot = 0; slot < 8; slot += 1) {
    const child = frame(slot + 2);
    const left = 100 + slot * 52;
    view.setUint32(child + 0xb8, slot, true);
    view.setUint32(child + 0x128, frame(parentId) + 0x128, true);
    view.setFloat32(child + 0x104, 800, true);
    view.setFloat32(child + 0x108, 600, true);
    view.setFloat32(child + 0x10c, left, true);
    view.setFloat32(child + 0x110, 20, true);
    view.setFloat32(child + 0x114, left + 48, true);
    view.setFloat32(child + 0x118, 68, true);
  }
}

/** Add a second visible frame that claims slot zero of the installed bar. */
export function installDuplicateSkillSlot(
  view: DataView,
  parentId = 1,
  visible = true,
) {
  const id = 10;
  const frameBytes = 0x1c8;
  const frame = (frameId: number) => ADDRESSES.frameBuffer + frameId * frameBytes;
  const duplicate = frame(id);
  view.setUint32(ADDRESSES.frameCountGlobal, id + 1, true);
  view.setUint32(ADDRESSES.frameTable + id * 4, duplicate, true);
  view.setUint32(duplicate + 0xbc, id, true);
  view.setUint32(duplicate + 0x18c, visible ? 0x4 : 0x204, true);
  view.setUint32(duplicate + 0xb8, 0, true);
  view.setUint32(duplicate + 0x128, frame(parentId) + 0x128, true);
  view.setFloat32(duplicate + 0x104, 800, true);
  view.setFloat32(duplicate + 0x108, 600, true);
  view.setFloat32(duplicate + 0x10c, 100, true);
  view.setFloat32(duplicate + 0x110, 20, true);
  view.setFloat32(duplicate + 0x114, 148, true);
  view.setFloat32(duplicate + 0x118, 68, true);
}

/**
 * Everything hanging off `WorldContext`, for the two heroes `installGameGraph`
 * puts in the party.
 *
 * Only hero 1 at agent 77 is *ours*: hero 2 at agent 88 belongs to player 99,
 * and the owner filter drops it. Its rows are installed anyway, and every
 * assertion below checks it stayed out — a fixture in which the foreign hero
 * has no data cannot show that the filter did anything.
 *
 * The attribute rows are modelled on the live readings, anomaly included. The
 * client's array is sparse and indexed by attribute id, and the reference
 * struct pads well past the highest real id (44) — indices 51-53 on a running
 * client hold values that decode as perfectly plausible ranks. One of them is
 * reproduced here, because a fixture that only contains well-formed data
 * cannot show that the walk rejects anything.
 */
export function installPartyDetailGraph(view: DataView) {
  const array = (at: number, buffer: number, size: number) => {
    view.setUint32(at, buffer, true);
    view.setUint32(at + 4, size, true);
    view.setUint32(at + 8, size, true);
  };
  view.setUint32(ADDRESSES.game + DETAIL.worldContext, ADDRESSES.world, true);

  array(
    ADDRESSES.account + DETAIL.accountUnlockedSkills,
    ADDRESSES.accountSkillBuffer,
    70,
  );
  array(
    ADDRESSES.world + DETAIL.characterSkills,
    ADDRESSES.characterSkillBuffer,
    70,
  );
  for (const id of [202, 216, 249]) {
    const word = Math.floor(id / 32);
    const bit = 1 << (id % 32);
    const at = ADDRESSES.accountSkillBuffer + word * 4;
    view.setUint32(at, view.getUint32(at, true) | bit, true);
  }
  for (const id of [202, 216]) {
    const word = Math.floor(id / 32);
    const bit = 1 << (id % 32);
    const at = ADDRESSES.characterSkillBuffer + word * 4;
    view.setUint32(at, view.getUint32(at, true) | bit, true);
  }

  array(ADDRESSES.world + DETAIL.heroFlags, ADDRESSES.heroFlagBuffer, 2);
  for (const [index, [heroId, agentId, behaviour]] of [
    [1, 77, 1],
    [2, 88, 2],
  ].entries()) {
    const at = ADDRESSES.heroFlagBuffer + index * DETAIL.flagStride;
    view.setUint32(at + DETAIL.flagHeroId, heroId as number, true);
    view.setUint32(at + DETAIL.flagAgentId, agentId as number, true);
    view.setUint32(at + DETAIL.flagBehavior, behaviour as number, true);
  }

  array(ADDRESSES.world + DETAIL.heroInfo, ADDRESSES.heroInfoBuffer, 2);
  for (const [index, [heroId, agentId, primary, secondary]] of [
    [1, 77, 1, 2],
    [2, 88, 5, 3],
  ].entries()) {
    const at = ADDRESSES.heroInfoBuffer + index * DETAIL.infoStride;
    view.setUint32(at + DETAIL.infoHeroId, heroId as number, true);
    view.setUint32(at + DETAIL.infoAgentId, agentId as number, true);
    view.setUint32(at + DETAIL.infoLevel, 20, true);
    view.setUint32(at + DETAIL.infoPrimary, primary as number, true);
    view.setUint32(at + DETAIL.infoSecondary, secondary as number, true);
  }

  array(
    ADDRESSES.world + DETAIL.professionStates,
    ADDRESSES.professionStateBuffer,
    3,
  );
  for (const [index, [agentId, primary, secondary]] of [
    [77, 1, 2],
    [88, 5, 3],
    [7, 3, 5],
  ].entries()) {
    const at = ADDRESSES.professionStateBuffer
      + index * DETAIL.professionStateStride;
    view.setUint32(at, agentId as number, true);
    view.setUint32(at + 4, primary as number, true);
    view.setUint32(at + 8, secondary as number, true);
  }

  array(ADDRESSES.world + DETAIL.skillbars, ADDRESSES.skillbarBuffer, 3);
  for (const [index, agentId] of [77, 88, 7].entries()) {
    const at = ADDRESSES.skillbarBuffer + index * DETAIL.skillbarStride;
    view.setUint32(at + DETAIL.skillbarAgentId, agentId, true);
    for (let slot = 0; slot < 8; slot += 1) {
      view.setUint32(
        at + DETAIL.skillbarSkills + slot * DETAIL.skillSlotStride + DETAIL.skillSlotId,
        100 + index * 10 + slot,
        true,
      );
    }
    view.setUint32(at + DETAIL.skillbarDisabled, index === 0 ? 0b101 : 0, true);
  }

  array(ADDRESSES.world + DETAIL.attributes, ADDRESSES.attributeBuffer, 3);
  const rows: readonly (readonly [number, readonly (readonly [number, number])[]])[] = [
    // A Warrior/Ranger: every Warrior attribute, and the Ranger ones except
    // Expertise (23), which is the Ranger *primary* and so unavailable.
    [77, [[17, 7], [18, 0], [19, 12], [20, 0], [21, 0], [22, 0], [24, 3], [25, 0]]],
    [88, [[0, 0], [1, 2], [2, 0], [3, 5], [13, 0], [14, 10], [15, 0]]],
    [7, [[13, 0], [14, 10], [15, 0], [16, 8], [1, 3], [2, 0], [3, 0]]],
  ];
  for (const [index, [agentId, entries]] of rows.entries()) {
    const at = ADDRESSES.attributeBuffer + index * DETAIL.attributeStride;
    view.setUint32(at + DETAIL.attributeAgentId, agentId, true);
    for (let id = 0; id <= 44; id += 1) {
      const slot = at + DETAIL.attributeEntries + id * DETAIL.attributeEntryStride;
      view.setUint32(slot + DETAIL.attributeEntryId, 0xffff_ffff, true);
    }
    for (const [id, rank] of entries) {
      const slot = at + DETAIL.attributeEntries + id * DETAIL.attributeEntryStride;
      view.setUint32(slot + DETAIL.attributeEntryId, id, true);
      view.setUint32(slot + DETAIL.attributeEntryRank, rank, true);
    }
    // The padding past id 44, as a live client actually holds it: index 53
    // reads `id=8 base=8`, which is Air Magic at rank 8 — on a Warrior.
    const padding = at + DETAIL.attributeEntries + 53 * DETAIL.attributeEntryStride;
    view.setUint32(padding + DETAIL.attributeEntryId, 8, true);
    view.setUint32(padding + DETAIL.attributeEntryRank, 8, true);
  }
}

// s_activeArt -> art -> handle -> view -> GrTex2d, exactly the chain the
// kernel walks to prove the colour buffer really came from a 32x32 texture.
export function installCursorGraph(
  view: DataView,
  { hotspotX = 0, hotspotY = 0 }: { hotspotX?: number; hotspotY?: number } = {},
) {
  view.setUint32(ADDRESSES.activeArt, ADDRESSES.art, true);
  view.setUint32(ADDRESSES.softwareModel, 0, true);
  view.setInt32(ADDRESSES.showCount, 0, true);
  view.setUint32(ADDRESSES.art + 0x00, hotspotX, true);
  view.setUint32(ADDRESSES.art + 0x04, hotspotY, true);
  view.setUint32(ADDRESSES.art + 0x0c, ADDRESSES.handle, true);
  view.setUint32(ADDRESSES.handle + 0x00, ADDRESSES.textureView, true);
  view.setUint32(ADDRESSES.handle + 0x08, TEXTURE_KEY, true);
  view.setUint32(ADDRESSES.textureView + 0x08, ADDRESSES.texture, true);
  view.setUint32(ADDRESSES.texture + 0x0c, 10, true);
  view.setUint32(ADDRESSES.texture + 0x14, CURSOR_EDGE, true);
  view.setUint32(ADDRESSES.texture + 0x18, CURSOR_EDGE, true);
}

// Fills the game's fixed BGRA readback buffer. Word 0 is pinned so one exact
// pixel proves the byte order; the rest varies with the seed.
export function paintCursor(view: DataView, seed: number) {
  const words = new Uint32Array(CURSOR_WORDS);
  for (let index = 0; index < CURSOR_WORDS; index += 1) {
    words[index] =
      index % 4 === 3 ? 0 : (0xff00_0000 | ((seed * 7919 + index * 31) & 0xff_ffff)) >>> 0;
  }
  words[0] = 0xff11_2233;
  words.forEach((word, index) => {
    view.setUint32(ADDRESSES.colorBuffer + index * 4, word, true);
  });
  return words;
}

export {
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  COMPANION_PARTY_BYTES,
  COMPANION_TOOLBOX_BYTES,
  readChangedCompanionParty,
  readChangedCompanionToolbox,
  readCompanionCursorHeader,
  readCompanionCursorPixels,
  readCompanionParty,
  readCompanionSnapshot,
  readCompanionToolbox,
  sameCompanionToolboxState,
};
