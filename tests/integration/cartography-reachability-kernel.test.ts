import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  CARTOGRAPHY_REACHABILITY_REGION_BYTES,
  cartographyReachabilitySignatureBytes,
} from "../../src/shared/cartography-reachability-kernel-contract.js";

const A = Object.freeze({
  contextRoot: 0x5a0e70,
  agentArray: 0x5a4de8,
  contexts: 0x10_000,
  game: 0x11_000,
  mapContext: 0x12_000,
  path: 0x13_000,
  staticData: 0x14_000,
  maps: 0x15_000,
  agents: 0x16_000,
  player: 0x17_000,
  traps: 0x18_000,
  nodes: 0x18_800,
  blocked: 0x19_000,
  portals: 0x1a_000,
  portalPair: 0x1b_000,
  portalTraps: 0x1c_000,
  propsContext: 0x1d_000,
  props: 0x1e_000,
  prop: 0x1f_000,
  model: 0x20_000,
  modelName: 0x21_000,
  largeMaps: 0x30_0000,
  runtime: 0x60_0000,
  region: 0x62_0000,
});
const MAP_ID = 200;
const AREA_EPOCH = 7;
const LAYOUT_ID = 1;
const PLAYER_ID = 7;
const WIDTH = 256;
const HEIGHT = 64;
const CELL_GAME = 32 * 96;
const MAP_BOUNDS = [176 * 32, 20 * 32, 192 * 32, 36 * 32] as const;

type Kernel = Readonly<{
  memory: WebAssembly.Memory;
  view: DataView;
  classify(radius?: 1 | 3): number;
  classifyShape(
    width: number,
    height: number,
    radius?: 1 | 3,
    bounds?: readonly [number, number, number, number],
  ): number;
  words(): Uint32Array;
  wordsShape(width: number, height: number): Uint32Array;
  terrainWords(): Uint32Array;
}>;

function array(view: DataView, at: number, buffer: number, count: number): void {
  view.setUint32(at, buffer, true);
  view.setUint32(at + 4, count, true);
  view.setUint32(at + 8, count, true);
}

function trap(
  view: DataView,
  index: number,
  cellX: number,
  cellY: number,
  adjacent: readonly number[] = [],
): number {
  const at = A.traps + index * 0x30;
  view.setUint32(at, index + 1, true);
  adjacent.forEach((target, edge) => {
    view.setUint32(at + 4 + edge * 4, A.traps + target * 0x30, true);
  });
  view.setUint16(at + 0x14, 0xffff, true);
  view.setUint16(at + 0x16, 0xffff, true);
  const left = cellX * CELL_GAME;
  const right = left + CELL_GAME;
  const top = -cellY * CELL_GAME;
  const bottom = top - CELL_GAME;
  for (const [offset, value] of [
    [0x18, left], [0x1c, right], [0x20, top],
    [0x24, left], [0x28, right], [0x2c, bottom],
  ] as const) view.setFloat32(at + offset, value, true);
  return at;
}

async function createKernel(): Promise<Kernel> {
  const bytes = await readFile("build/renderer/cartography-reachability-kernel.wasm");
  const module = new WebAssembly.Module(bytes);
  const memory = new WebAssembly.Memory({ initial: 112 });
  const view = new DataView(memory.buffer);
  const immutable = (value: number) => new WebAssembly.Global(
    { value: "i32", mutable: false }, value,
  );
  const instance = new WebAssembly.Instance(module, {
    env: {
      memory,
      __memory_base: immutable(A.runtime),
      __stack_pointer: new WebAssembly.Global(
        { value: "i32", mutable: true }, A.runtime + 65_536,
      ),
      __table_base: immutable(0),
    },
  });
  new WebAssembly.Instance(
    new WebAssembly.Module(cartographyReachabilitySignatureBytes()),
    { kernel: instance.exports },
  );
  view.setUint32(A.contextRoot, A.contexts, true);
  view.setUint32(A.contexts + 6 * 4, A.game, true);
  view.setUint32(A.game + 0x14, A.mapContext, true);
  view.setUint32(A.mapContext + 0x8c, MAP_ID, true);
  view.setUint32(A.mapContext + 0x74, A.path, true);
  view.setUint32(A.path, A.staticData, true);
  array(view, A.staticData + 0x18, A.maps, 1);
  array(view, A.path + 0x04, A.blocked, 1);
  view.setUint32(A.maps + 0x14, 3, true);
  view.setUint32(A.maps + 0x18, A.traps, true);
  array(view, A.agentArray, A.agents, 16);
  view.setUint32(A.agents + PLAYER_ID * 4, A.player, true);
  view.setUint32(A.player + 0x2c, PLAYER_ID, true);
  view.setFloat32(A.player + 0x74, 180.5 * CELL_GAME, true);
  view.setFloat32(A.player + 0x78, -25.5 * CELL_GAME, true);
  view.setUint32(A.player + 0x7c, 0, true);
  trap(view, 0, 180, 25, [1]);
  trap(view, 1, 181, 25, [0]);
  trap(view, 2, 185, 25);
  view.setUint32(A.maps + 0x44, A.nodes, true);
  view.setUint32(A.nodes, 2, true);
  view.setUint32(A.nodes + 0x08, A.traps, true);
  const classify = instance.exports.cartography_reachability_classify as (
    ...args: number[]
  ) => number;
  return {
    memory,
    view,
    classify(radius = 1) {
      return classify(
        A.region, CARTOGRAPHY_REACHABILITY_REGION_BYTES,
        LAYOUT_ID, MAP_ID, AREA_EPOCH, PLAYER_ID,
        0, 0, WIDTH, HEIGHT, ...MAP_BOUNDS, radius,
      );
    },
    classifyShape(width, height, radius = 1, bounds = MAP_BOUNDS) {
      return classify(
        A.region, CARTOGRAPHY_REACHABILITY_REGION_BYTES,
        LAYOUT_ID, MAP_ID, AREA_EPOCH, PLAYER_ID,
        0, 0, width, height, ...bounds, radius,
      );
    },
    words() {
      return new Uint32Array(
        memory.buffer.slice(A.region + 72, A.region + 72 + WIDTH * HEIGHT / 8),
      );
    },
    wordsShape(width, height) {
      return new Uint32Array(
        memory.buffer.slice(
          A.region + 72,
          A.region + 72 + Math.ceil(width * height / 32) * 4,
        ),
      );
    },
    terrainWords() {
      const width = view.getUint32(A.region + 60, true);
      const height = view.getUint32(A.region + 64, true);
      return new Uint32Array(
        memory.buffer.slice(
          A.region + 552_008,
          A.region + 552_008 + Math.ceil(width * height / 32) * 4,
        ),
      );
    },
  };
}

function bit(words: Uint32Array, x: number, y: number): boolean {
  const index = y * WIDTH + x;
  return ((words[index >>> 5]! >>> (index & 31)) & 1) === 1;
}

function addPairedPortal(kernel: Kernel, flags = 0, blocked = false): void {
  const { view } = kernel;
  array(view, A.staticData + 0x18, A.maps, 2);
  array(view, A.path + 0x04, A.blocked, 2);
  view.setUint32(A.blocked + 4, blocked ? 1 : 0, true);
  const secondMap = A.maps + 0x54;
  view.setUint32(secondMap + 0x14, 1, true);
  view.setUint32(secondMap + 0x18, A.traps + 3 * 0x30, true);
  trap(view, 3, 184, 25);
  view.setUint32(secondMap + 0x44, A.nodes + 0x10, true);
  view.setUint32(A.nodes + 0x10, 2, true);
  view.setUint32(A.nodes + 0x18, A.traps + 3 * 0x30, true);

  view.setUint32(A.maps + 0x3c, 1, true);
  view.setUint32(A.maps + 0x40, A.portals, true);
  view.setUint16(A.traps + 0x14, 0, true);
  view.setUint16(A.portals + 2, 1, true);
  view.setUint32(A.portals + 4, flags, true);
  view.setUint32(A.portals + 8, A.portalPair, true);
  view.setUint32(A.portalPair + 0x0c, 1, true);
  view.setUint32(A.portalPair + 0x10, A.portalTraps, true);
  view.setUint32(A.portalTraps, A.traps + 3 * 0x30, true);
}

function encodedFileId(fileId: number): readonly [number, number] {
  const value = fileId - 1;
  return Object.freeze([
    value % 0xff00 + 0x100,
    Math.floor(value / 0xff00) + 0x100,
  ]);
}

function addTravelDoorway(kernel: Kernel, fileId = 0xa825): void {
  const { view } = kernel;
  view.setUint32(A.mapContext + 0x7c, A.propsContext, true);
  array(view, A.propsContext + 0x194, A.props, 1);
  view.setUint32(A.props, A.prop, true);
  view.setFloat32(A.prop + 0x20, 181.5 * CELL_GAME, true);
  view.setFloat32(A.prop + 0x24, -25.5 * CELL_GAME, true);
  view.setFloat32(A.prop + 0x50, 1, true);
  view.setUint32(A.prop + 0x54, A.model, true);
  view.setUint32(A.model + 0x04, A.modelName, true);
  view.setFloat32(A.model + 0x08, CELL_GAME * 0.2, true);
  const [c0, c1] = encodedFileId(fileId);
  view.setUint16(A.modelName, c0, true);
  view.setUint16(A.modelName + 2, c1, true);
}

describe("Cartography reachability kernel", () => {
  it("accepts spare native array capacity beyond the bounded live size", async () => {
    const kernel = await createKernel();
    kernel.view.setUint32(A.staticData + 0x18 + 4, 1_024, true);
    assert.equal(kernel.classify(), 1);
  });

  it("accepts more than 64 live pathing planes and reports the real 256-plane bound", async () => {
    const kernel = await createKernel();
    new Uint8Array(kernel.memory.buffer, A.largeMaps, 0x54).set(
      new Uint8Array(kernel.memory.buffer, A.maps, 0x54),
    );
    array(kernel.view, A.staticData + 0x18, A.largeMaps, 65);
    assert.equal(kernel.classify(), 1);

    array(kernel.view, A.staticData + 0x18, A.largeMaps, 257);
    assert.equal(kernel.classify(), 7);
    assert.equal(kernel.view.getUint32(A.region + 16, true), 7);
  });

  it("accepts the real 256x512 Guild Wars exploration bitmap", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.classifyShape(256, 512), 1);
    assert.equal(kernel.view.getUint32(A.region + 32, true), 256);
    assert.equal(kernel.view.getUint32(A.region + 36, true), 512);
  });

  it("includes the player's connected component and excludes disconnected ground", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.classify(), 1);
    const header = new DataView(kernel.memory.buffer, A.region, 72);
    assert.equal(header.getUint32(20, true), MAP_ID);
    assert.equal(header.getUint32(24, true), AREA_EPOCH);
    assert.equal(header.getUint32(28, true), LAYOUT_ID);
    assert.equal(header.getUint32(44, true), 3);
    assert.equal(header.getUint32(48, true), 2);
    assert.equal(header.getUint32(52, true), 2);
    const words = kernel.words();
    assert.equal(bit(words, 180, 25), true);
    assert.equal(bit(words, 182, 26), true);
    assert.equal(bit(words, 185, 25), false);
    assert.equal(header.getUint32(60, true), 256);
    assert.equal(header.getUint32(64, true), 256);
    assert.equal(header.getFloat32(68, true), 2);
    const terrain = kernel.terrainWords();
    const terrainBit = (x: number, y: number) =>
      ((terrain[(y * 256 + x) >>> 5]! >>> ((y * 256 + x) & 31)) & 1) === 1;
    assert.equal(terrainBit(64, 80), true);
    assert.equal(terrainBit(144, 80), true);
  });

  it("keeps normal reveal credit within one cell of the map boundary", async () => {
    const kernel = await createKernel();
    assert.equal(
      kernel.classifyShape(256, 64, 1, [181 * 32, 20 * 32, 192 * 32, 36 * 32]),
      1,
    );
    const words = kernel.words();
    assert.equal(bit(words, 180, 25), true);
    assert.equal(bit(words, 179, 25), false);
  });

  it("requires nearby navmesh for the outer Bird's Eye reveal rings", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.classify(3), 1);
    assert.equal(bit(kernel.words(), 177, 22), false);

    trap(kernel.view, 2, 177, 22);
    assert.equal(kernel.classify(3), 1);
    assert.equal(bit(kernel.words(), 177, 22), true);
  });

  it("keeps the outer Bird's Eye rings inside the strict map boundary", async () => {
    const kernel = await createKernel();
    trap(kernel.view, 2, 178, 25);
    assert.equal(
      kernel.classifyShape(256, 64, 3, [181 * 32, 20 * 32, 192 * 32, 36 * 32]),
      1,
    );
    const words = kernel.words();
    assert.equal(bit(words, 180, 25), true);
    assert.equal(bit(words, 178, 25), false);
  });

  it("crosses valid paired portals but rejects closed and blocked destinations", async () => {
    const open = await createKernel();
    addPairedPortal(open);
    assert.equal(open.classify(), 1);
    assert.equal(bit(open.words(), 184, 25), true);

    const closed = await createKernel();
    addPairedPortal(closed, 0x04);
    assert.equal(closed.classify(), 1);
    assert.equal(bit(closed.words(), 184, 25), false);

    const blocked = await createKernel();
    addPairedPortal(blocked, 0, true);
    assert.equal(blocked.classify(), 1);
    assert.equal(bit(blocked.words(), 184, 25), false);
  });

  it("does not flood across a travel doorway", async () => {
    const ordinaryProp = await createKernel();
    trap(ordinaryProp.view, 1, 182, 25, [0]);
    addTravelDoorway(ordinaryProp, 1);
    assert.equal(ordinaryProp.classify(), 1);
    assert.equal(bit(ordinaryProp.words(), 182, 25), true);

    const travelDoor = await createKernel();
    trap(travelDoor.view, 1, 182, 25, [0]);
    addTravelDoorway(travelDoor);
    assert.equal(travelDoor.classify(), 1);
    const header = new DataView(travelDoor.memory.buffer, A.region, 72);
    assert.equal(header.getUint32(56, true), 1);
    assert.equal(bit(travelDoor.words(), 182, 25), false);
  });

  it("fails closed when no certified player start trapezoid exists", async () => {
    const kernel = await createKernel();
    kernel.view.setUint32(A.maps + 0x44, 0, true);
    assert.equal(kernel.classify(), 5);
    assert.equal([...kernel.words()].every((word) => word === 0), true);
  });

  it("retains one certified component through a transient missing start", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.classify(), 1);
    const before = kernel.words();
    kernel.view.setUint32(A.maps + 0x44, 0, true);
    assert.equal(kernel.classify(), 1);
    assert.deepEqual(kernel.words(), before);
  });

  it("retains the component without corrupting its queue at 256x512", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.classifyShape(256, 512), 1);
    const before = kernel.wordsShape(256, 512);
    kernel.view.setUint32(A.maps + 0x44, 0, true);
    assert.equal(kernel.classifyShape(256, 512), 1);
    assert.deepEqual(kernel.wordsShape(256, 512), before);
  });

  it("adapts complete terrain resolution instead of failing the semantic model", async () => {
    const kernel = await createKernel();
    assert.equal(
      kernel.classifyShape(256, 512, 1, [5_000, 0, 7_048, 2_048]),
      1,
    );
    const header = new DataView(kernel.memory.buffer, A.region, 72);
    assert.equal(header.getUint32(60, true), 512);
    assert.equal(header.getUint32(64, true), 512);
    assert.equal(header.getFloat32(68, true), 4);
  });

  it("recomputes when the player reaches a different component", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.classify(), 1);
    kernel.view.setUint32(A.nodes + 0x08, A.traps + 2 * 0x30, true);
    assert.equal(kernel.classify(), 1);
    const words = kernel.words();
    assert.equal(bit(words, 180, 25), false);
    assert.equal(bit(words, 185, 25), true);
  });

  it("recomputes when blocked planes change", async () => {
    const kernel = await createKernel();
    addPairedPortal(kernel);
    assert.equal(kernel.classify(), 1);
    assert.equal(bit(kernel.words(), 184, 25), true);
    kernel.view.setUint32(A.blocked + 4, 1, true);
    assert.equal(kernel.classify(), 1);
    assert.equal(bit(kernel.words(), 184, 25), false);
  });
});
