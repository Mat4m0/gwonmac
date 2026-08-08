import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  readCompanionCursorHeader,
  readCompanionCursorPixels,
  readChangedCompanionParty,
  readChangedCompanionToolbox,
  readCompanionSnapshot,
  readCompanionToolbox,
  sameCompanionToolboxState,
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  COMPANION_TOOLBOX_BYTES,
  COMPANION_PARTY_BYTES,
  readCompanionParty,
} from "../../src/renderer/companion-snapshot.ts";
import {
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_LAYOUT_WORD_COUNT,
} from "../../src/shared/contracts.ts";
import {
  ENHANCEMENT_ATTRIBUTE_LAYOUT_FIELDS,
  ENHANCEMENT_MAP_POLICY_LAYOUT_FIELDS,
  ENHANCEMENT_PARTY_DETAIL_LAYOUT_FIELDS,
} from "../../src/main/certification/enhancement-builds.ts";

// Every read returns a discriminated union: `reason` belongs to the members
// that rejected the region, the decoded fields to the members that accepted
// it. Narrowing through the helpers below keeps each assertion pointed at the
// member it is about — a read that lands on the wrong one now fails by name
// instead of quietly comparing `undefined`.
type SnapshotRead = ReturnType<typeof readCompanionSnapshot>;
type CursorHeaderRead = ReturnType<typeof readCompanionCursorHeader>;
type CursorPixelsRead = ReturnType<typeof readCompanionCursorPixels>;
type ToolboxRead = ReturnType<typeof readCompanionToolbox>;

function decoded(read: SnapshotRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a decoded snapshot, got ${JSON.stringify(read)}`);
  }
  return read;
}

function rejected(read: SnapshotRead) {
  if (read.status === "ready") {
    throw new Error("expected a rejected snapshot, got a decoded one");
  }
  return read.reason;
}

function readyCursor(read: CursorHeaderRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a published cursor, got ${JSON.stringify(read)}`);
  }
  return read;
}

// "invalid" is not "waiting": it carries the cleared geometry the renderer is
// expected to keep reading, so it narrows separately from the members that are
// nothing but a reason.
function invalidCursor(read: CursorHeaderRead) {
  if (read.status !== "invalid") {
    throw new Error(`expected an invalidated cursor, got ${JSON.stringify(read)}`);
  }
  return read;
}

function cursorReason(read: CursorHeaderRead) {
  if (read.status === "ready") {
    throw new Error("expected a rejected cursor header, got a published one");
  }
  return read.reason;
}

function publishedPixels(read: CursorPixelsRead) {
  if (read === null) throw new Error("the kernel published no cursor bitmap");
  return read;
}

function readyParty(read: ReturnType<typeof readCompanionParty>) {
  if (read.status !== "ready") {
    throw new Error(`expected a party region, got ${JSON.stringify(read)}`);
  }
  return read;
}

function readyToolbox(read: ToolboxRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a toolbox snapshot, got ${JSON.stringify(read)}`);
  }
  return read;
}

const MAGIC = 0x42545747;
const FEATURE_NATIVE_CURSOR = 1 << 0;
const FEATURE_TARGET_READOUT = 1 << 1;
const FEATURE_TOOLBOX_FOUNDATION = 1 << 2;
const ALL_FEATURES = FEATURE_NATIVE_CURSOR | FEATURE_TARGET_READOUT;

interface SnapshotOverrides {
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

function snapshot(overrides: SnapshotOverrides = {}) {
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, 2, true);
  view.setUint16(6, 64, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  const flags = overrides.flags ?? 7;
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

const CURSOR_MAGIC = 0x43545747;
const CURSOR_VALID = 1 << 0;
const CURSOR_HIDDEN = 1 << 1;
const CURSOR_UNSUPPORTED = 1 << 2;
const CURSOR_EDGE = 32;
const CURSOR_WORDS = CURSOR_EDGE * CURSOR_EDGE;
const CURSOR_PIXEL_BYTES = CURSOR_WORDS * 4;
// Field offsets of the cursor region, version 1.
const CURSOR = Object.freeze({
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

interface CursorOverrides {
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

function cursorRegion(overrides: CursorOverrides = {}) {
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
function fnv1a(words: Uint32Array) {
  let hash = 0x811c_9dc5;
  for (const word of words) hash = Math.imul(hash ^ word, 0x0100_0193);
  return hash >>> 0;
}

// BGRA -> RGBA: keep alpha and green, swap red and blue.
function expectedRgba(words: Uint32Array) {
  const bytes = new Uint8ClampedArray(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((word, index) => {
    const rgba =
      (word & 0xff00_ff00) | ((word >>> 16) & 0xff) | ((word & 0xff) << 16);
    view.setUint32(index * 4, rgba >>> 0, true);
  });
  return bytes;
}

const ADDRESSES = Object.freeze({
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
  partyContext: 0xa000,
  partyInfo: 0xa100,
  heroBuffer: 0xa200,
  world: 0x1_0000,
  heroFlagBuffer: 0x1_1000,
  heroInfoBuffer: 0x1_2000,
  skillbarBuffer: 0x1_3000,
  attributeBuffer: 0x1_4000,
  areaInfo: 0x20_0000,
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
const DETAIL = Object.freeze({
  heroLevel: 0x14,
  partyPlayers: 0x04, partyHenchmen: 0x14, partyFlag: 0x14,
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
});
const PARTY_DIRTY_MESSAGES = Object.freeze([
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
 * words, the layout grew, and they silently stayed twenty-five words short of
 * where the kernel reads them.
 */
const DETAIL_CONFIG_START = ENHANCEMENT_LAYOUT_WORD_COUNT
  - ENHANCEMENT_PARTY_DETAIL_LAYOUT_FIELDS.length
  - ENHANCEMENT_ATTRIBUTE_LAYOUT_FIELDS.length
  - ENHANCEMENT_MAP_POLICY_LAYOUT_FIELDS.length;
const POLICY_CONFIG_START = ENHANCEMENT_LAYOUT_WORD_COUNT
  - ENHANCEMENT_MAP_POLICY_LAYOUT_FIELDS.length;
const CONFIG_WORDS = ENHANCEMENT_CONFIG_WORD_COUNT;
const CONFIG_BYTES = CONFIG_WORDS * 4;
const MESSAGE_CONFIG_START = ENHANCEMENT_LAYOUT_WORD_COUNT;
const TEXTURE_KEY = 0x6772_7478;

interface KernelOverrides {
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
type KernelInit = (
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
  features: number,
) => number;
type KernelDispatch = (
  kind: number,
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
) => void;

function kernelExports(exports: WebAssembly.Exports) {
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

async function createKernel(
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
  // The 25 party-detail words after them stay zero — these fixtures exercise
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
  // Placed at the boundary rather than appended to the literal above. Written
  // as one flat list, the messages sat directly after the party chain — and
  // when the layout grew they silently stayed there, twenty-five words short of
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
          ?? ((features & FEATURE_TARGET_READOUT) !== 0
            ? ADDRESSES.snapshot
            : 0),
        overrides.snapshotSize
          ?? ((features & FEATURE_TARGET_READOUT) !== 0 ? 64 : 0),
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
        features,
      );
    },
    tick: () => exports.dispatch(0, 123, 0, 0, 0, 0),
    cursorEvent: (...args: number[]) =>
      exports.dispatch(1, args[0] ?? 1, args[1] ?? 2, args[2] ?? 3,
        args[3] ?? 4, args[4] ?? 5),
    uiEvent: (message: number, wparam: number, lparam: number) =>
      exports.dispatch(2, message, wparam, lparam, 0, 0),
    activeFeatures: (features: number) =>
      exports.dispatch(3, features, 0, 0, 0, 0),
    toolbox: () => readCompanionToolbox(memory.buffer, ADDRESSES.toolbox),
    party: () => readCompanionParty(memory.buffer, ADDRESSES.party),
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

function installGameGraph(view: DataView) {
  view.setUint32(ADDRESSES.contextRoot, ADDRESSES.contexts, true);
  view.setUint32(ADDRESSES.contexts + 24, ADDRESSES.game, true);
  view.setUint32(ADDRESSES.game + 0x44, ADDRESSES.character, true);
  view.setUint32(ADDRESSES.character + 0x198, 133, true);
  view.setUint32(ADDRESSES.character + 0x19c, 0, true);
  view.setUint32(ADDRESSES.character + 0x234, 133, true);
  view.setUint32(ADDRESSES.character + 0x23c, 0, true);
  view.setUint32(ADDRESSES.character + 0x2ac, 42, true);
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
  view.setUint32(ADDRESSES.target + 0x2c, 9, true);
  view.setFloat32(ADDRESSES.target + 0x74, 110, true);
  view.setFloat32(ADDRESSES.target + 0x78, 20, true);
  view.setUint32(ADDRESSES.target + 0x9c, 0xdb, true);
  view.setUint32(ADDRESSES.manualTargetId, 9, true);
  view.setUint32(ADDRESSES.game + 0x4c, ADDRESSES.partyContext, true);
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
function installPartyDetailGraph(view: DataView) {
  const array = (at: number, buffer: number, size: number) => {
    view.setUint32(at, buffer, true);
    view.setUint32(at + 4, size, true);
    view.setUint32(at + 8, size, true);
  };
  view.setUint32(ADDRESSES.game + DETAIL.worldContext, ADDRESSES.world, true);

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
function installCursorGraph(
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
function paintCursor(view: DataView, seed: number) {
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

describe("Companion snapshot ABI", () => {
  it("decodes stable player and target state", () => {
    const state = decoded(readCompanionSnapshot(snapshot(), 0));
    assert.equal(state.status, "ready");
    assert.equal(state.mapId, 133);
    assert.equal(state.instanceName, "Outpost");
    assert.equal(state.playerId, 7);
    assert.equal(state.targetId, 9);
    assert.equal(state.targetKind, "Living");
    assert.equal(state.rangeName, "Adjacent");
  });

  it("rejects torn, incompatible, loading, and absent-target snapshots", () => {
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ sequence: 3 }), 0)),
      "writing",
    );
    const corrupt = snapshot();
    new DataView(corrupt).setUint16(4, 1, true);
    assert.equal(rejected(readCompanionSnapshot(corrupt, 0)), "snapshot");
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ flags: 8 }), 0)),
      "loading",
    );
    const noTarget = decoded(readCompanionSnapshot(snapshot({ flags: 3 }), 0));
    assert.equal(noTarget.status, "ready");
    assert.equal(noTarget.targetValid, false);
  });

  it("rejects unknown flags, invalid identities, bands, and non-finite values", () => {
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ flags: 0x10 }), 0)),
      "snapshot",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ playerId: 0 }), 0)),
      "corrupt",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ rangeBand: 9 }), 0)),
      "corrupt",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ distance: Number.NaN }), 0)),
      "corrupt",
    );
  });
});

describe("Companion cursor region ABI", () => {
  it("decodes a published cursor and its RGBA payload", () => {
    const region = cursorRegion();
    const header = readyCursor(readCompanionCursorHeader(region, 0));
    assert.equal(header.status, "ready");
    assert.equal(header.generation, 1);
    assert.equal(header.flags, CURSOR_VALID);
    assert.equal(header.hotspotX, 3);
    assert.equal(header.hotspotY, 4);
    assert.equal(header.pixelHash, 0x1357_9bdf);
    assert.equal(header.hidden, false);

    const full = publishedPixels(readCompanionCursorPixels(region, 0));
    assert.equal(full.status, "ready");
    assert.equal(full.pixels.length, CURSOR_PIXEL_BYTES);
    assert.deepEqual([...full.pixels.slice(0, 4)], [0x60, 0x40, 0x20, 0xff]);
    // The copy is private: mutating the region must not reach it.
    new DataView(region).setUint32(CURSOR.pixels, 0, true);
    assert.equal(full.pixels[0], 0x60);
  });

  it("reports hidden and non-cursor states without inventing geometry", () => {
    const hidden = readyCursor(
      readCompanionCursorHeader(
        cursorRegion({ flags: CURSOR_VALID | CURSOR_HIDDEN }),
        0,
      ),
    );
    assert.equal(hidden.status, "ready");
    assert.equal(hidden.hidden, true);

    const cleared = invalidCursor(
      readCompanionCursorHeader(cursorRegion({ flags: 0 }), 0),
    );
    assert.equal(cleared.status, "invalid");
    assert.equal(cleared.reason, "cursor");
    assert.deepEqual(
      [cleared.hotspotX, cleared.hotspotY, cleared.pixelHash],
      [0, 0, 0],
    );
    assert.equal(readCompanionCursorPixels(cursorRegion({ flags: 0 }), 0), null);

    const unsupported = invalidCursor(
      readCompanionCursorHeader(cursorRegion({ flags: CURSOR_UNSUPPORTED }), 0),
    );
    assert.equal(unsupported.status, "invalid");
    assert.equal(unsupported.reason, "unsupported");
  });

  it("rejects a torn, foreign, or malformed cursor region", () => {
    const reason = (overrides: CursorOverrides) =>
      cursorReason(readCompanionCursorHeader(cursorRegion(overrides), 0));
    assert.equal(reason({ magic: MAGIC }), "cursor");
    assert.equal(reason({ abi: 2 }), "cursor");
    assert.equal(reason({ byteLength: 64 }), "cursor");
    assert.equal(reason({ sequence: 3 }), "writing");
    assert.equal(reason({ flags: 0x8 }), "cursor");
    assert.equal(reason({ reservedWord: 1, reservedIndex: 5 }), "cursor");
    assert.equal(reason({ width: 64 }), "corrupt");
    assert.equal(reason({ height: 16 }), "corrupt");
    assert.equal(reason({ hotspotX: CURSOR_EDGE }), "corrupt");
    assert.equal(reason({ hotspotY: 99 }), "corrupt");
    assert.equal(reason({ generation: 0 }), "corrupt");
    // Hidden is meaningless without a cursor; unsupported must stand alone.
    assert.equal(reason({ flags: CURSOR_HIDDEN }), "corrupt");
    assert.equal(reason({ flags: CURSOR_HIDDEN | CURSOR_UNSUPPORTED }), "corrupt");
    assert.equal(reason({ flags: CURSOR_VALID | CURSOR_UNSUPPORTED }), "corrupt");
    assert.equal(
      reason({ flags: CURSOR_VALID | CURSOR_HIDDEN | CURSOR_UNSUPPORTED }),
      "corrupt",
    );
    assert.equal(readCompanionCursorPixels(cursorRegion({ sequence: 3 }), 0), null);

    assert.equal(
      cursorReason(readCompanionCursorHeader(new ArrayBuffer(64), 0)),
      "memory",
    );
    assert.equal(cursorReason(readCompanionCursorHeader(cursorRegion(), 4)), "memory");
    assert.equal(readCompanionCursorPixels(cursorRegion(), -4), null);
  });
});

describe("Companion kernel", () => {
  it("returns from adversarial callback scalars without panicking", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    installCursorGraph(kernel.view);
    paintCursor(kernel.view, 1);
    assert.equal(
      kernel.init({
        features:
          FEATURE_NATIVE_CURSOR
          | FEATURE_TARGET_READOUT
          | FEATURE_TOOLBOX_FOUNDATION,
      }),
      1,
    );
    const exportedDispatch = kernel.instance.exports.companion_dispatch;
    assert.equal(typeof exportedDispatch, "function");
    const dispatch = exportedDispatch as CallableFunction;
    for (const kind of [0, 1, 2, 3, 0x7fff_ffff, 0xffff_ffff]) {
      assert.doesNotThrow(() => dispatch(
        kind,
        0xffff_ffff,
        0x8000_0000,
        0x7fff_ffff,
        0xffff_ffff,
        0x8000_0000,
      ));
    }
  });

  it("publishes a checked snapshot after a game tick", async () => {
    const kernel = await createKernel();
    const { view, config, instance } = kernel;
    installGameGraph(view);

    assert.equal(kernel.init({ snapshotPointer: 0xffff_fffc }), 0);
    assert.equal(kernel.init({ snapshotSize: 63 }), 0);
    assert.equal(kernel.init({ configSize: CONFIG_BYTES - 4 }), 0);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    const state = decoded(
      readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(state.status, "ready");
    assert.equal(state.tickCount, 1);
    assert.equal(state.playerId, 7);
    assert.equal(state.targetId, 9);
    assert.ok(Math.abs(state.distance - 100) < 0.1);
    assert.equal(state.rangeName, "Adjacent");

    const boundaries: [distance: number, band: number][] = [
      [166, 1],
      [166.25, 2],
      [252.25, 3],
      [322.25, 4],
      [1_012.25, 5],
      [1_248.25, 6],
      [2_500.25, 7],
      [5_000.25, 8],
    ];
    for (const [distance, band] of boundaries) {
      view.setFloat32(ADDRESSES.target + 0x74, 10 + distance, true);
      kernel.tick();
      assert.equal(
        decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
          .rangeBand,
        band,
      );
    }

    view.setUint32(ADDRESSES.manualTargetId, 0, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .targetValid,
      false,
    );

    view.setUint32(ADDRESSES.automaticTargetId, 9, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .targetId,
      9,
    );

    view.setUint32(ADDRESSES.character + 0x23c, 2, true);
    kernel.tick();
    const loading = readCompanionSnapshot(
      kernel.memory.buffer,
      ADDRESSES.snapshot,
    );
    assert.equal(rejected(loading), "loading");
    assert.equal("playerId" in loading, false);
    assert.equal("targetId" in loading, false);

    view.setUint32(ADDRESSES.character + 0x23c, 0, true);
    view.setFloat32(ADDRESSES.player + 0x74, Number.NaN, true);
    kernel.tick();
    assert.equal(
      rejected(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot)),
      "game",
    );

    config[0] = 0xffff_fffc;
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(
      rejected(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot)),
      "game",
    );
    assert.equal(typeof instance.exports.companion_dispatch, "function");
  });

  it("collects only the explicitly enabled tools", async () => {
    const cursorOnly = await createKernel();
    installGameGraph(cursorOnly.view);
    installCursorGraph(cursorOnly.view);
    paintCursor(cursorOnly.view, 1);
    assert.equal(
      cursorOnly.init({ features: FEATURE_NATIVE_CURSOR }),
      1,
    );
    assert.equal(
      cursorOnly.view.getUint32(ADDRESSES.snapshot, true),
      0,
    );
    cursorOnly.tick();
    assert.equal(publishedPixels(cursorOnly.published()).status, "ready");
    assert.equal(
      cursorOnly.view.getUint32(ADDRESSES.snapshot, true),
      0,
    );

    const readoutOnly = await createKernel();
    installGameGraph(readoutOnly.view);
    installCursorGraph(readoutOnly.view);
    paintCursor(readoutOnly.view, 2);
    assert.equal(
      readoutOnly.init({ features: FEATURE_TARGET_READOUT }),
      1,
    );
    assert.equal(readoutOnly.field(CURSOR.magic), 0);
    readoutOnly.tick();
    const state = decoded(
      readCompanionSnapshot(readoutOnly.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(state.status, "ready");
    assert.equal(state.tickCount, 1);
    assert.equal(readoutOnly.field(CURSOR.magic), 0);

  });

  it("keeps map policy live while a disabled target observer stops reading targets", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: ALL_FEATURES }), 1);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot)).targetId,
      9,
    );

    kernel.activeFeatures(FEATURE_NATIVE_CURSOR);
    kernel.view.setUint32(ADDRESSES.agentBuffer + 9 * 4, 0xffff_fffc, true);
    kernel.tick();
    const policy = decoded(
      readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(policy.playRegion, "pve");
    assert.equal(policy.playerId, 7);
    assert.equal(policy.targetValid, false);
  });

  it("requires UI message configuration only for the Toolbox capability", async () => {
    const cursorOnly = await createKernel();
    cursorOnly.config.fill(0, MESSAGE_CONFIG_START);
    assert.equal(cursorOnly.init({ features: FEATURE_NATIVE_CURSOR }), 1);

    const readoutOnly = await createKernel();
    readoutOnly.config.fill(0, MESSAGE_CONFIG_START);
    assert.equal(readoutOnly.init({ features: FEATURE_TARGET_READOUT }), 1);

    const toolbox = await createKernel();
    toolbox.config.fill(0, MESSAGE_CONFIG_START);
    assert.equal(
      toolbox.init({ features: FEATURE_TOOLBOX_FOUNDATION }),
      0,
    );

    const missingDirty = await createKernel();
    missingDirty.config[MESSAGE_CONFIG_START + 3] = 0;
    assert.equal(
      missingDirty.init({ features: FEATURE_TOOLBOX_FOUNDATION }),
      0,
    );

    const duplicateDirty = await createKernel();
    duplicateDirty.config[MESSAGE_CONFIG_START + 4] =
      duplicateDirty.config[MESSAGE_CONFIG_START + 3]!;
    assert.equal(
      duplicateDirty.init({ features: FEATURE_TOOLBOX_FOUNDATION }),
      0,
    );
  });

  it("observes Toolbox heroes and the exact player agent", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    const toolbox = readyToolbox(kernel.toolbox());
    assert.equal(toolbox.heroAvailable, true);
    assert.equal(toolbox.firstHeroId, 1);
    assert.equal(toolbox.firstHeroAgentId, 77);
  });

  // The party region is the toolbox region's argument taken to its conclusion:
  // the same walk, publishing who rather than merely whether. These fixtures
  // carry no party-detail offsets -- those words are zero, which the kernel
  // reads as "not certified, do not traverse" -- so what is asserted here is
  // that the roster survives without them and that every unread field says so
  // rather than arriving as a plausible default.
  it("publishes a roster whose unread fields admit they are unread", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const party = kernel.party();
    if (party.status !== "ready") {
      throw new Error(`expected a party region, got ${JSON.stringify(party)}`);
    }
    assert.equal(party.rosterObserved, true);
    assert.equal(party.slotCount, 1);

    // Slot 0 is the player, so a one-hero party occupies slot 1.
    const [player, hero] = party.slots;
    assert.equal(player?.occupied, true);
    assert.equal(player?.hero, null);
    assert.equal(player?.agentId, 7);
    assert.equal(hero?.occupied, true);
    assert.equal(hero?.hero, 1);
    assert.equal(hero?.agentId, 77);

    // Uncertified groups were skipped whole rather than read as zero.
    assert.equal(hero?.professions, null, "professions");
    assert.equal(hero?.behaviour, null, "behaviour");
    assert.equal(hero?.skills, null, "skill bar");
    assert.equal(hero?.disabled, null, "disabled mask");
    assert.equal(party.unlockObserved, false);
    assert.equal(party.unlocked, null, "unlock table");
  });

  it("retracts the roster when the party cannot be read", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    assert.equal(readyParty(kernel.party()).slotCount, 1);

    // Break the party pointer and force a walk. A half-read party must not be
    // published as a small one: the whole observation is withdrawn.
    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0xffff_fffc, true);
    kernel.uiEvent(0x1000_011f, 0, 0);
    kernel.tick();

    const party = readyParty(kernel.party());
    assert.equal(party.rosterObserved, false);
    assert.equal(party.slotCount, 0);
    assert.equal(party.slots.every((slot) => slot.occupied === false), true);
  });

  // The certified party-detail layout, walked end to end. Everything above
  // exercises the roster with the detail words zeroed; this is the walk that
  // actually reads three arrays and sixty-four skill ids.
  it("fills the roster in from the certified detail offsets", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const party = readyParty(kernel.party());
    assert.equal(party.slotCount, 1, "the foreign hero stayed out");
    const player = party.slots[0];
    const hero = party.slots[1];
    assert.equal(player?.agentId, 7);
    assert.deepEqual(player?.professions, [3, 5], "player professions");
    assert.deepEqual(
      player?.skills,
      [120, 121, 122, 123, 124, 125, 126, 127],
      "player skill bar",
    );
    assert.deepEqual(player?.attributes, [[1, 3], [14, 10], [16, 8]]);
    assert.equal(hero?.hero, 1);
    assert.deepEqual(hero?.professions, [1, 2], "primary and secondary");
    assert.equal(hero?.behaviour, 1);
    assert.deepEqual(
      hero?.skills,
      [100, 101, 102, 103, 104, 105, 106, 107],
      "eight ids at the certified slot stride",
    );
    assert.equal(hero?.disabled, 0b101);

    // Ranks by id, invested only. Rank 0 is not published: an absent attribute
    // already means zero on the other side, and publishing it would make a
    // character who spent nothing indistinguishable from one nobody read.
    assert.deepEqual(hero?.attributes, [[17, 7], [19, 12], [24, 3]]);
    assert.equal(party.unlockObserved, true);
    assert.deepEqual(party.unlocked, [1, 2], "hero_info is account-scoped");
    // The fixture's character context says outpost, and applying a team is an
    // outpost-only operation — so the flag has to survive the walk rather than
    // being something the interface assumes.
    assert.equal(party.inOutpost, true);
  });

  // A party nobody walked cannot say where it is standing, and the difference
  // decides whether Apply refuses or explains that it does not know yet.
  it("says nothing about the instance when the walk was rejected", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    assert.equal(readyParty(kernel.party()).inOutpost, true);

    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0xffff_fffc, true);
    kernel.uiEvent(0x1000_011f, 0, 0);
    kernel.tick();
    const rejected = readyParty(kernel.party());
    assert.equal(rejected.rosterObserved, false);
    assert.equal(rejected.inOutpost, null, "not false: nobody looked");
  });

  // The anomaly the live session turned up, as a regression: `index == id` is
  // the admission rule precisely because the reference struct's padding past
  // id 44 decodes as a plausible rank. Without it the fixture's row publishes
  // Air Magic at rank 8 on a Warrior, and a captured build would carry it into
  // the library and out again as a template.
  it("takes index == id as the rule, so struct padding is not a rank", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    // Exactly the three invested ranks. Air Magic (8) is what the padding at
    // index 53 reads as, and it is absent because the whole list is asserted
    // rather than a predicate over it.
    const ranks = readyParty(kernel.party()).slots[1]?.attributes;
    assert.deepEqual(ranks, [[17, 7], [19, 12], [24, 3]]);
    // And the rule is structural, not a range check on the index: an entry
    // *inside* the walked range whose id disagrees with its position is
    // rejected the same way.
    const at = ADDRESSES.attributeBuffer
      + DETAIL.attributeEntries + 20 * DETAIL.attributeEntryStride;
    kernel.view.setUint32(at + DETAIL.attributeEntryId, 21, true);
    kernel.view.setUint32(at + DETAIL.attributeEntryRank, 9, true);
    kernel.uiEvent(0x1000_011f, 0, 0);
    kernel.tick();

    const after = readyParty(kernel.party()).slots[1]?.attributes ?? [];
    assert.deepEqual(after, ranks, "a mismatched entry changes nothing");
  });

  // The reconciliation walk exists to catch changes no certified message
  // announces — editing a hero's skill bar is exactly that — so it runs on a
  // timer whether or not anything happened. Republishing what it already
  // published would move the sequence twice a second forever, which makes
  // "the sequence moved" useless as the cheap question a reader wants to ask.
  it("republishes the roster only when the roster changed", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    const { sequence, generation } = readyParty(kernel.party());

    // Well past RECONCILE_TICKS, so the recovery walk has run several times.
    for (let tick = 0; tick < 300; tick += 1) kernel.tick();
    const idle = readyParty(kernel.party());
    assert.equal(idle.sequence, sequence, "sequence");
    assert.equal(idle.generation, generation, "generation");

    // And a change nothing announced is still picked up — by that same walk,
    // which is the whole reason it runs on a timer.
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, 5, true);
    for (let tick = 0; tick < 130; tick += 1) kernel.tick();
    const changed = readyParty(kernel.party());
    assert.notEqual(changed.sequence, sequence);
    assert.equal(changed.generation, generation + 1, "exactly one publication");
    assert.equal(changed.slots[1]?.hero, 5);
  });

  // The counterpart of the Toolbox header test below it, and the bug it exists
  // for: the party was originally re-read on the *toolbox* sequence, which
  // counts a different thing. Swapping a skill on a hero's bar moves no scalar
  // the toolbox summary carries, so the panel — and capture with it — kept
  // serving the roster from before the edit.
  it("reads only the party header while its sequence is unchanged", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const first = readChangedCompanionParty(
      kernel.memory.buffer,
      ADDRESSES.party,
      null,
    );
    assert.equal(first.changed, true);
    assert.notEqual(first.sequence, null);
    assert.deepEqual(
      readChangedCompanionParty(kernel.memory.buffer, ADDRESSES.party, first.sequence),
      { changed: false, sequence: first.sequence },
    );

    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, 5, true);
    kernel.uiEvent(0x1000_011f, 0, 0);
    kernel.tick();
    const changed = readChangedCompanionParty(
      kernel.memory.buffer,
      ADDRESSES.party,
      first.sequence,
    );
    assert.equal(changed.changed, true);
    assert.notEqual(changed.sequence, first.sequence);
  });

  it("traverses party state only for the exact dirty-message set", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    const ready = readyToolbox(kernel.toolbox());
    assert.equal(ready.heroAvailable, true);

    // Keep the last published projection but make the canonical party pointer
    // invalid. An unrelated central-dispatch message must not schedule a walk.
    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0xffff_fffc, true);
    kernel.uiEvent(0x1000_0080, 0xdead_beef, 0x7fff_fffd);
    kernel.tick();
    let state = readyToolbox(kernel.toolbox());
    assert.equal(state.sequence, ready.sequence);
    assert.equal(state.heroAvailable, true);
    // No walk ran, so the last real reading stands rather than being retracted.
    assert.equal(state.partyObserved, true);

    // The certified party removal is dirty-only: it publishes nothing in the
    // callback, then the next tick traverses and invalidates stale hero state.
    kernel.uiEvent(0x1000_011f, 0xdead_beef, 0x7fff_fffd);
    assert.equal(readyToolbox(kernel.toolbox()).sequence, ready.sequence);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.ok(state.sequence > ready.sequence);
    assert.equal(state.heroAvailable, false);
    // The party pointer is still the invalid one installed above, so this walk
    // began and rejected what it found. That is *not* an empty party, and the
    // kernel used to publish it as one — hero count 0 with no hero flag, the
    // same bytes a heroless outpost produces. A reader could not tell them
    // apart, and the panel reported "no heroes in your party" through every map
    // load. Absence of this bit is the only thing that says nobody read.
    assert.equal(state.partyObserved, false);

    // A certified map-loaded boundary also restores a replaced party graph.
    kernel.view.setUint32(ADDRESSES.game + 0x4c, ADDRESSES.partyContext, true);
    kernel.uiEvent(0x1000_008c, 0, 0);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.heroAvailable, true);
    assert.equal(state.partyObserved, true, "a completed walk claims its reading");
    assert.deepEqual(
      [state.firstHeroId, state.firstHeroAgentId],
      [1, 77],
    );

    // Every member of the certificate tuple arms the same coalesced dirty bit;
    // this also pins the Rust comparison to all ten config positions.
    for (const [index, message] of PARTY_DIRTY_MESSAGES.entries()) {
      const heroId = index + 2;
      const agentId = index + 100;
      kernel.view.setUint32(ADDRESSES.heroBuffer + 0x00, agentId, true);
      kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, heroId, true);
      kernel.uiEvent(message, 0, 0);
      kernel.tick();
      state = readyToolbox(kernel.toolbox());
      assert.deepEqual(
        [state.firstHeroId, state.firstHeroAgentId],
        [heroId, agentId],
      );
    }
  });

  it("counts chat without calling back into the game", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(
      kernel.init({
        features: FEATURE_TARGET_READOUT | FEATURE_TOOLBOX_FOUNDATION,
      }),
      1,
    );
    kernel.tick();
    let state = readyToolbox(kernel.toolbox());
    assert.equal(state.playerChatCount, 0);
    assert.equal(state.heroAvailable, true);
    assert.equal(state.heroCount, 1);
    assert.equal(state.firstHeroId, 1);
    assert.equal(state.firstHeroAgentId, 77);

    const initialSequence = state.sequence;
    kernel.uiEvent(0x1000_0080, 0xdead_beef, 0x7fff_fffd);
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.playerChatCount, 0);
    assert.equal(state.sequence, initialSequence);
    kernel.tick();
    assert.equal(readyToolbox(kernel.toolbox()).sequence, initialSequence);
    kernel.uiEvent(0x1000_0082, 0xdead_beef, 0x7fff_fffd);
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.playerChatCount, 1);
  });

  it("observes heroes on UI changes with a bounded quiet reconciliation", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    // The hero observer needs game + party + player-number only. Poisoning the
    // agent-array ceiling proves Toolbox-only collection cannot fall back to
    // the target readout's 4,096-entry agent search.
    kernel.view.setUint32(ADDRESSES.agentArray + 4, 5_000, true);
    kernel.view.setUint32(ADDRESSES.agentArray + 8, 5_000, true);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);

    kernel.tick();
    let state = readyToolbox(kernel.toolbox());
    assert.equal(state.heroAvailable, true);
    assert.deepEqual(
      [state.heroCount, state.firstHeroId, state.firstHeroAgentId],
      [1, 1, 77],
    );

    // A canonical change without a callback is intentionally invisible on
    // quiet ticks: no party traversal and no snapshot publication occurs.
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x00, 99, true);
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, 3, true);
    const quietSequence = state.sequence;
    for (let tick = 0; tick < 119; tick += 1) kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.sequence, quietSequence);
    assert.equal(state.firstHeroId, 1);

    // The 120th quiet tick is the bounded recovery path for a missed event.
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.ok(state.sequence > quietSequence);
    assert.deepEqual(
      [state.firstHeroId, state.firstHeroAgentId],
      [3, 99],
    );

    // A certified party mutation is the dirty boundary. It does not publish by
    // itself; one following tick reconciles canonical state.
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x00, 100, true);
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, 4, true);
    const beforeDirty = state.sequence;
    kernel.uiEvent(0x1000_011e, 0, 0);
    assert.equal(readyToolbox(kernel.toolbox()).sequence, beforeDirty);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.deepEqual(
      [state.firstHeroId, state.firstHeroAgentId],
      [4, 100],
    );

    // Loading invalidates the projection once. Repeated dirty callbacks while
    // it remains unavailable do not churn the seqlock or renderer.
    kernel.view.setUint32(ADDRESSES.character + 0x23c, 2, true);
    kernel.uiEvent(0x1000_00c2, 0, 0);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.heroAvailable, false);
    const loadingSequence = state.sequence;

    // Two scheduled reconciliation periods may validate lifecycle state while
    // loading, but must not walk the party vector or republish. Keep the party
    // root deliberately invalid throughout that window.
    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0xffff_fffc, true);
    for (let tick = 0; tick < 240; tick += 1) kernel.tick();
    assert.equal(readyToolbox(kernel.toolbox()).sequence, loadingSequence);

    kernel.uiEvent(0x1000_0098, 0, 0);
    kernel.tick();
    assert.equal(readyToolbox(kernel.toolbox()).sequence, loadingSequence);

    kernel.view.setUint32(ADDRESSES.character + 0x23c, 0, true);
    kernel.view.setUint32(ADDRESSES.game + 0x4c, ADDRESSES.partyContext, true);
    kernel.uiEvent(0x1000_008c, 0, 0);
    assert.equal(readyToolbox(kernel.toolbox()).sequence, loadingSequence);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.heroAvailable, true);
    assert.deepEqual(
      [state.firstHeroId, state.firstHeroAgentId],
      [4, 100],
    );
  });

  it("compares Toolbox projections by decoded value", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    const first = kernel.toolbox();
    assert.equal(sameCompanionToolboxState(null, first), false);
    assert.equal(sameCompanionToolboxState(first, kernel.toolbox()), true);

    const sequence = readyToolbox(first).sequence;
    kernel.view.setUint32(ADDRESSES.toolbox + 8, sequence + 2, true);
    const republished = kernel.toolbox();
    assert.equal(sameCompanionToolboxState(first, republished), true);
    kernel.view.setUint32(ADDRESSES.toolbox + 16, 1, true);
    assert.equal(sameCompanionToolboxState(republished, kernel.toolbox()), false);
  });

  it("reads only the Toolbox header while its generation is unchanged", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const first = readChangedCompanionToolbox(
      kernel.memory.buffer,
      ADDRESSES.toolbox,
      null,
    );
    assert.equal(first.changed, true);
    assert.notEqual(first.sequence, null);
    const unchanged = readChangedCompanionToolbox(
      kernel.memory.buffer,
      ADDRESSES.toolbox,
      first.sequence,
    );
    assert.deepEqual(unchanged, {
      changed: false,
      sequence: first.sequence,
    });

    kernel.uiEvent(0x1000_0082, 0, 0);
    const changed = readChangedCompanionToolbox(
      kernel.memory.buffer,
      ADDRESSES.toolbox,
      first.sequence,
    );
    assert.equal(changed.changed, true);
    assert.notEqual(changed.sequence, first.sequence);
  });

  it("writes only its explicitly owned regions under mixed callback load", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    installCursorGraph(kernel.view);
    paintCursor(kernel.view, 7);
    assert.equal(kernel.init({
      features: FEATURE_NATIVE_CURSOR
        | FEATURE_TARGET_READOUT
        | FEATURE_TOOLBOX_FOUNDATION,
    }), 1);
    const before = new Uint8Array(kernel.memory.buffer).slice();

    for (let index = 0; index < 512; index += 1) {
      kernel.tick();
      kernel.cursorEvent(index, index + 1, index + 2, index + 3, index + 4);
      kernel.uiEvent(index % 2 ? 0x1000_0082 : 0x1000_0080, index, 0);
      kernel.uiEvent(index % 2 ? 0x1000_01a3 : 0x1000_01a4, 1, 0);
    }

    const owned = [
      [ADDRESSES.snapshot, ADDRESSES.snapshot + 64],
      [ADDRESSES.cursor, ADDRESSES.cursor + COMPANION_CURSOR_BYTES],
      [ADDRESSES.toolbox, ADDRESSES.toolbox + COMPANION_TOOLBOX_BYTES],
      [ADDRESSES.party, ADDRESSES.party + COMPANION_PARTY_BYTES],
      [ADDRESSES.companionRuntime, ADDRESSES.companionRuntime + 65_536],
    ] as const;
    const after = new Uint8Array(kernel.memory.buffer);
    for (let address = 0; address < after.byteLength; address += 1) {
      if (owned.some(([start, end]) => address >= start && address < end)) {
        continue;
      }
      assert.equal(
        after[address],
        before[address],
        `companion wrote outside an owned region at 0x${address.toString(16)}`,
      );
    }
  });

  it("rejects empty, unknown, missing, or unselected feature regions", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.init({ features: 0 }), 0);
    assert.equal(kernel.init({ features: 1 << 3 }), 0);
    assert.equal(
      kernel.init({
        features: FEATURE_NATIVE_CURSOR,
        cursorPointer: 0,
        cursorSize: 0,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_TARGET_READOUT,
        snapshotPointer: 0,
        snapshotSize: 0,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_NATIVE_CURSOR,
        snapshotPointer: ADDRESSES.snapshot,
        snapshotSize: 64,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_TARGET_READOUT,
        cursorPointer: ADDRESSES.cursor,
        cursorSize: COMPANION_CURSOR_BYTES,
      }),
      0,
    );

    kernel.tick();
    assert.equal(kernel.view.getUint32(ADDRESSES.snapshot, true), 0);
    assert.equal(kernel.field(CURSOR.magic), 0);
  });

  it("rejects a cursor region of the wrong size, alignment, or extent", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.init({ cursorSize: COMPANION_CURSOR_BYTES - 1 }), 0);
    assert.equal(kernel.init({ cursorSize: COMPANION_CURSOR_BYTES + 1 }), 0);
    assert.equal(kernel.init({ cursorSize: 64 }), 0);
    assert.equal(kernel.init({ cursorPointer: ADDRESSES.cursor + 1 }), 0);
    assert.equal(kernel.init({ cursorPointer: ADDRESSES.cursor + 2 }), 0);
    // 16 MiB of memory: this region is aligned but runs past the end.
    assert.equal(kernel.init({ cursorPointer: 0xff_f000 }), 0);
    assert.equal(kernel.init({ cursorPointer: 0xffff_f000 }), 0);
    // A rejected init must leave the kernel dormant.
    kernel.tick();
    assert.equal(kernel.field(CURSOR.magic), 0);
    assert.equal(kernel.init(), 1);
  });

  it("publishes a validated 32x32 cursor once per distinct cursor", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view, { hotspotX: 5, hotspotY: 7 });
    const first = paintCursor(view, 1);
    assert.equal(kernel.init(), 1);

    // The region comes from the game's allocator, so init clears it.
    const cleared = invalidCursor(kernel.header());
    assert.equal(cleared.status, "invalid");
    assert.equal(cleared.reason, "cursor");
    assert.equal(kernel.field(CURSOR.generation), 0);
    assert.deepEqual(
      [...kernel.payload().slice(0, 8)],
      [0, 0, 0, 0, 0, 0, 0, 0],
    );

    kernel.tick();
    const ready = publishedPixels(kernel.published());
    assert.equal(ready.status, "ready");
    assert.equal(ready.generation, 1);
    assert.equal(ready.flags, CURSOR_VALID);
    assert.equal(ready.hidden, false);
    assert.equal(ready.hotspotX, 5);
    assert.equal(ready.hotspotY, 7);
    assert.equal(ready.pixelHash, fnv1a(first));
    assert.equal(kernel.field(CURSOR.magic), CURSOR_MAGIC);
    assert.equal(
      view.getUint16(ADDRESSES.cursor + CURSOR.abi, true),
      COMPANION_CURSOR_ABI,
    );
    assert.equal(
      view.getUint16(ADDRESSES.cursor + CURSOR.byteLength, true),
      COMPANION_CURSOR_BYTES,
    );
    assert.equal(kernel.field(CURSOR.width), CURSOR_EDGE);
    assert.equal(kernel.field(CURSOR.height), CURSOR_EDGE);
    // BGRA 0xff112233 -> R 0x11, G 0x22, B 0x33, A 0xff.
    assert.deepEqual([...ready.pixels.slice(0, 4)], [0x11, 0x22, 0x33, 0xff]);
    assert.deepEqual(ready.pixels, expectedRgba(first));

    const sequence = kernel.field(CURSOR.sequence);
    assert.equal(sequence % 2, 0);
    for (let index = 0; index < 12; index += 1) kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 1);
    assert.equal(kernel.field(CURSOR.sequence), sequence);

    const second = paintCursor(view, 2);
    kernel.cursorEvent();
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 2);
    assert.equal(kernel.field(CURSOR.pixelHash), fnv1a(second));
    assert.deepEqual(publishedPixels(kernel.published()).pixels, expectedRgba(second));
    kernel.tick();
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 2);

    // Identical pixels, moved hotspot: the pixel hash cannot see this, so the
    // published identity must carry the hotspot too.
    view.setUint32(ADDRESSES.art + 0x04, 9, true);
    kernel.cursorEvent();
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 3);
    assert.equal(kernel.field(CURSOR.pixelHash), fnv1a(second));
    assert.equal(readyCursor(kernel.header()).hotspotY, 9);

    // Show/hide moves the flags only: the bitmap is unchanged, so generation
    // holds and the renderer's CSS cache stays warm.
    view.setInt32(ADDRESSES.showCount, -1, true);
    kernel.tick();
    const gone = readyCursor(kernel.header());
    assert.equal(gone.status, "ready");
    assert.equal(gone.flags, CURSOR_VALID | CURSOR_HIDDEN);
    assert.equal(gone.hidden, true);
    assert.equal(gone.generation, 3);
    assert.deepEqual(kernel.payload(), expectedRgba(second));
    view.setInt32(ADDRESSES.showCount, 0, true);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).flags, CURSOR_VALID);
    assert.equal(kernel.field(CURSOR.generation), 3);
    assert.deepEqual(kernel.payload(), expectedRgba(second));

  });

  it("never publishes an uncommitted colour buffer as a cursor", async () => {
    const kernel = await createKernel();
    installCursorGraph(kernel.view);
    assert.equal(kernel.init(), 1);
    const sequence = kernel.field(CURSOR.sequence);
    for (let index = 0; index < 5; index += 1) kernel.tick();
    const header = invalidCursor(kernel.header());
    assert.equal(header.status, "invalid");
    assert.equal(header.flags, 0);
    assert.equal(kernel.field(CURSOR.generation), 0);
    assert.equal(kernel.field(CURSOR.sequence), sequence);
    assert.equal(kernel.published(), null);

    paintCursor(kernel.view, 4);
    kernel.cursorEvent();
    kernel.tick();
    assert.equal(kernel.header().status, "ready");
    assert.equal(kernel.field(CURSOR.generation), 1);
  });

  it("keeps the last good pixels while the software cursor is live", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view);
    const good = paintCursor(view, 5);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).generation, 1);

    view.setUint32(ADDRESSES.softwareModel, 1, true);
    const replacement = paintCursor(view, 6);
    kernel.cursorEvent();
    for (let index = 0; index < 3; index += 1) kernel.tick();
    const unsupported = invalidCursor(kernel.header());
    assert.equal(unsupported.status, "invalid");
    assert.equal(unsupported.reason, "unsupported");
    assert.equal(unsupported.flags, CURSOR_UNSUPPORTED);
    assert.equal(kernel.field(CURSOR.generation), 1);
    assert.deepEqual(kernel.payload(), expectedRgba(good));

    view.setUint32(ADDRESSES.softwareModel, 0, true);
    kernel.cursorEvent();
    kernel.tick();
    const recovered = publishedPixels(kernel.published());
    assert.equal(recovered.status, "ready");
    assert.equal(recovered.generation, 2);
    assert.deepEqual(recovered.pixels, expectedRgba(replacement));
  });

  it("clears validity for every rejected art, handle, or texture", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view);
    const words = paintCursor(view, 7);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).generation, 1);

    const rejections: [name: string, breakGraph: () => void][] = [
      ["texture type", () => view.setUint32(ADDRESSES.texture + 0x0c, 9, true)],
      ["texture width", () => view.setUint32(ADDRESSES.texture + 0x14, 64, true)],
      ["texture height", () => view.setUint32(ADDRESSES.texture + 0x18, 16, true)],
      ["access key", () => view.setUint32(ADDRESSES.handle + 0x08, TEXTURE_KEY + 1, true)],
      ["null art", () => view.setUint32(ADDRESSES.activeArt, 0, true)],
      ["misaligned art", () => view.setUint32(ADDRESSES.activeArt, ADDRESSES.art + 1, true)],
      ["hotspot x", () => view.setUint32(ADDRESSES.art + 0x00, CURSOR_EDGE, true)],
      ["hotspot y", () => view.setUint32(ADDRESSES.art + 0x04, 0xffff_ffff, true)],
    ];
    let generation = 1;
    for (const [name, breakGraph] of rejections) {
      breakGraph();
      kernel.cursorEvent();
      kernel.tick();
      const broken = invalidCursor(kernel.header());
      assert.equal(broken.status, "invalid", name);
      assert.equal(broken.reason, "cursor", name);
      assert.equal(broken.flags, 0, name);
      assert.equal(kernel.published(), null, name);
      // Header-only: the renderer keeps rendering the last good bitmap.
      assert.equal(kernel.field(CURSOR.generation), generation, name);
      assert.deepEqual(kernel.payload(), expectedRgba(words), name);

      installCursorGraph(view);
      kernel.cursorEvent();
      kernel.tick();
      generation += 1;
      assert.equal(kernel.header().status, "ready", name);
      assert.equal(kernel.field(CURSOR.generation), generation, name);
    }
  });
});
