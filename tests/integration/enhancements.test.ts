import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  readCompanionCursorHeader,
  readCompanionCursorPixels,
  readCompanionSnapshot,
  readCompanionToolbox,
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  COMPANION_TOOLBOX_BYTES,
} from "../../src/renderer/companion-snapshot.ts";

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
  view.setUint16(4, 1, true);
  view.setUint16(6, 64, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  const flags = overrides.flags ?? 7;
  const hasPlayer = (flags & 2) !== 0;
  const hasTarget = (flags & 4) !== 0;
  view.setUint32(12, flags, true);
  view.setUint32(16, overrides.tickCount ?? 40, true);
  view.setUint32(20, overrides.mapId ?? (hasPlayer ? 133 : 0), true);
  view.setUint32(24, overrides.instanceType ?? 0, true);
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
  partyContext: 0xa000,
  partyInfo: 0xa100,
  heroBuffer: 0xa200,
});
const CONFIG_WORDS = 40;
const CONFIG_BYTES = CONFIG_WORDS * 4;
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
  const setPanel = exports["companion_set_first_hero_panel"];
  if (
    typeof init !== "function"
    || typeof dispatch !== "function"
    || typeof setPanel !== "function"
  ) {
    throw new Error("companion-kernel.wasm did not export its foundation ABI");
  }
  return {
    init: init as KernelInit,
    dispatch: dispatch as KernelDispatch,
    setPanel: setPanel as (shown: number) => number,
  };
}

async function createKernel() {
  const bytes = await readFile("build/renderer/companion-kernel.wasm");
  const memory = new WebAssembly.Memory({ initial: 256 });
  const view = new DataView(memory.buffer);
  const calls = {
    original: 0,
    cursor: [] as number[][],
    ui: [] as number[][],
    uiContext: [] as number[],
  };
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    game: {
      enhancement_tick_original: () => {
        calls.original += 1;
      },
      enhancement_cursor_original: (...args: number[]) => calls.cursor.push(args),
      enhancement_ui_original: (...args: number[]) => {
        calls.ui.push(args);
        calls.uiContext.push(view.getUint32(0x28cc20, true));
      },
    },
  });
  const exports = kernelExports(instance.exports);
  const config = new Uint32Array(memory.buffer, ADDRESSES.config, CONFIG_WORDS);
  config.set([
    ADDRESSES.contextRoot, ADDRESSES.agentArray,
    ADDRESSES.manualTargetId, ADDRESSES.automaticTargetId,
    6, 0x44, 0x198, 0x19c,
    0x234, 0x23c, 0x2ac, 0x2c, 0x74, 0x78, 0x9c, 0xf4, 0xf6,
    ADDRESSES.activeArt, ADDRESSES.softwareModel, ADDRESSES.showCount,
    ADDRESSES.colorBuffer,
    0x00, 0x0c, 0x08, 0x00, 0x08, 0x0c, 0x14, 0x18,
    0x4c, 0x54, 0x24, 0x18, 0x00, 0x04, 0x08, 0x28cc20,
    0x1000_0082, 0x1000_01a3, 0x1000_01a4,
  ]);
  return {
    instance,
    memory,
    view,
    config,
    calls,
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
        features,
      );
    },
    tick: () => exports.dispatch(0, 123, 0, 0, 0, 0),
    cursorEvent: (...args: number[]) =>
      exports.dispatch(1, args[0] ?? 1, args[1] ?? 2, args[2] ?? 3,
        args[3] ?? 4, args[4] ?? 5),
    uiEvent: (message: number, wparam: number, lparam: number) =>
      exports.dispatch(2, message, wparam, lparam, 0, 0),
    setPanel: (shown: boolean) => exports.setPanel(shown ? 1 : 0),
    toolbox: () => readCompanionToolbox(memory.buffer, ADDRESSES.toolbox),
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
    new DataView(corrupt).setUint16(4, 2, true);
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
  it("calls the original once and publishes a checked snapshot", async () => {
    const kernel = await createKernel();
    const { view, config, instance } = kernel;
    installGameGraph(view);

    assert.equal(kernel.init({ snapshotPointer: 0xffff_fffc }), 0);
    assert.equal(kernel.init({ snapshotSize: 63 }), 0);
    assert.equal(kernel.init({ configSize: CONFIG_BYTES - 4 }), 0);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(kernel.calls.original, 1);
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
    assert.equal(kernel.calls.original, boundaries.length + 6);
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

    assert.equal(cursorOnly.calls.original, 1);
    assert.equal(readoutOnly.calls.original, 1);
  });

  it("counts chat and applies hero commands on tick inside a restored PropContext", async () => {
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

    kernel.uiEvent(0x1000_0080, 0xdead_beef, 0x7fff_fffd);
    assert.equal(readyToolbox(kernel.toolbox()).playerChatCount, 0);
    kernel.uiEvent(0x1000_0082, 0xdead_beef, 0x7fff_fffd);
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.playerChatCount, 1);
    assert.deepEqual(kernel.calls.ui.slice(0, 2), [
      [0x1000_0080, 0xdead_beef | 0, 0x7fff_fffd],
      [0x1000_0082, 0xdead_beef | 0, 0x7fff_fffd],
    ]);
    assert.deepEqual(kernel.calls.uiContext, [0, 0]);

    const request = kernel.setPanel(true);
    assert.equal(request, 1);
    assert.equal(kernel.calls.ui.length, 2);
    assert.equal(readyToolbox(kernel.toolbox()).commandRequest, request);
    kernel.view.setUint32(0x28cc20, 0x1234_5678, true);
    kernel.tick();
    assert.deepEqual(kernel.calls.ui[2], [0x1000_01a4, 1, 0]);
    assert.equal(kernel.calls.uiContext[2], ADDRESSES.game);
    assert.equal(kernel.view.getUint32(0x28cc20, true), 0x1234_5678);
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.panelState, 2);
    assert.equal(state.commandComplete, request);
    assert.equal(state.commandStatus, 1);

    kernel.uiEvent(0x1000_01a3, 1, 0);
    assert.equal(readyToolbox(kernel.toolbox()).panelState, 1);
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
    assert.equal(kernel.calls.original, 1);
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
    assert.equal(kernel.calls.original, 1);
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

    assert.equal(kernel.calls.original, 19);
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
