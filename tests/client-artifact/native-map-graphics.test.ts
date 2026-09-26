/** Executes native map draw ownership, matrix restoration and bitmap refusal. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transformCartographySpikeWasm } from "../../src/main/certification/pathing-spike-transform.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import { concat, encodeCode, encodeSection, parseCode, parseExports, sectionById, splitSections, uleb, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { encodeName } from "../../src/main/certification/cartography-transform-internals.js";
import { NATIVE_MAP_GRAPHICS_MAGIC, NATIVE_MAP_GRAPHICS_SURFACES, NATIVE_MAP_QUADS_MAGIC, NATIVE_MAP_QUADS_MAX,
  NATIVE_MAP_QUAD_SURFACES } from "../../src/shared/native-map-graphics.js";

test("each native map owns its mesh, restores matrices and refuses stale or malformed textures", async () => {
  assert.ok(process.env.GW_CLIENT_WASM);
  const input = new Uint8Array(await readFile(process.env.GW_CLIENT_WASM));
  const output = transformCartographySpikeWasm(input, "relocated");
  const sections = splitSections(output); const bodies = parseCode(sectionById(sections, 10));
  const evidence = wasmEvidence(output); assert.ok(evidence); const module = evidence.moduleView();
  const exported = parseExports(sectionById(sections, 7)); const decoded = evidence.decodeFunctions([]);
  for (const surface of NATIVE_MAP_GRAPHICS_SURFACES) {
    const quads = (NATIVE_MAP_QUAD_SURFACES as readonly string[]).includes(surface);
    const count = quads ? 2 : 1;
    const publishIndex = exported.find((entry) => entry.name === `gwonmac_${surface}_graphics_publish`)?.index;
    assert.ok(publishIndex !== undefined);
    const selected = Array.from({length: 4}, (_, index) => publishIndex - 3 + index);
    const peers = [1444, 1445, 1446, 1448, 1449, 1554, 1564, 1569, 1579, 1333, 1334, 1357, 264, 2956, 2249, 3137, 748, 750];
    const indices = new Map([...peers, ...selected].map((index, position) => [index, position]));
    const rewritten = selected.map((index) => {
      const body = bodies[index - module.functionImportCount]!;
      const sites = decoded.find((row) => row.functionIndex === index)?.callSites; assert.ok(sites);
      const edits = [...sites].flatMap(([target, calls]) => {
        const replacement = indices.get(target); assert.ok(replacement !== undefined, `unexpected native peer ${target}`);
        return calls.map((site) => ({...site, replacement}));
      }).sort((a, b) => a.offset - b.offset);
      let cursor = 0; const parts: Uint8Array[] = [];
      for (const edit of edits) { parts.push(body.slice(cursor, edit.offset + 1), uleb(edit.replacement)); cursor = edit.operandEnd; }
      return concat(...parts, body.slice(cursor));
    });
    const globals = exported.filter((entry) => entry.kind === 3 && (entry.name.startsWith(`gwonmac_${surface}_graphics_`)
      || ["gwonmac_cartography_context_area_epoch", "gwonmac_cartography_context_status"].includes(entry.name)));
    const section = (id: number, body: Uint8Array) => encodeSection({id, body});
    const labels = ["hide", "destroy", "render", "publish"];
    const fixture = concat(WASM_HEADER, section(1, sectionById(sections, 1)),
      section(2, concat(uleb(peers.length), ...peers.map((index) => concat(encodeName("peer"), encodeName(String(index)), Uint8Array.of(0), uleb(module.functionTypeIndices[index]!))))),
      section(3, concat(uleb(selected.length), ...selected.map((index) => uleb(module.functionTypeIndices[index]!)))),
      // Include the native model-type word and current graphics-device pointer.
      section(5, Uint8Array.of(1, 0, 48)), section(6, sectionById(sections, 6)),
      section(7, concat(uleb(labels.length + globals.length + 2),
        ...labels.map((name, index) => concat(encodeName(name), Uint8Array.of(0), uleb(peers.length + index))),
        encodeName("memory"), Uint8Array.of(2, 0), encodeName("stack"), Uint8Array.of(3, 0),
        ...globals.map((entry) => concat(encodeName(entry.name), Uint8Array.of(3), uleb(entry.index))))),
      section(10, encodeCode(rewritten)));
    const released: number[] = []; const matrixEvents: string[] = [];
    let textures = 0; let meshes = 0; let draws = 0;
    const { exports } = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(fixture)), {peer: {
      1444: (format: number, flags: number) => { assert.deepEqual([format, flags], [265, 0]); meshes += 1; return 11; },
      1445: (handle: number, indices: number) => { assert.deepEqual([handle, indices], [11, 6 * count]); return 131072; },
      1446: (handle: number, vertices: number) => { assert.deepEqual([handle, vertices], [11, 4 * count]); return 65536; },
      1448: (handle: number) => { assert.equal(handle, 11); }, 1449: () => {},
      1554: (count: number, buffer: number, material: number, flags: number, extra: number) => {
        assert.deepEqual([count, view.getUint32(buffer, true), view.getUint32(material, true), flags, extra], [1, 11, 22, 0, 0]); return 12;
      },
      1564: (count: number, pointer: number) => { assert.deepEqual([count, view.getUint32(pointer, true)], [1, 12]); matrixEvents.push("capture-view"); },
      1569: (draw: number, index: number, material: number) => {
        assert.equal(view.getUint32(MODEL + 152, true), 0, "a texture swap never reaches a referenced model");
        assert.deepEqual([draw, index, material], [12, 0, 22]);
      },
      750: (handle: number, type: number) => { assert.deepEqual([handle, type], [12, MODEL_TYPE]); return MODEL; },
      1579: (draw: number, index: number) => { assert.deepEqual([draw, index], [12, 0]); matrixEvents.push("capture-model"); },
      1333: (matrix: number) => { assert.equal(matrix, 2); matrixEvents.push("save"); return 1024; },
      1334: (matrix: number, pointer: number) => { assert.equal(matrix, 2); assert.equal(view.getFloat32(pointer, true), 17); matrixEvents.push("restore"); },
      1357: (matrix: number) => { assert.equal(matrix, 2); matrixEvents.push("identity"); },
      264: (to: number, from: number, bytes: number) => { assert.equal(bytes, 52); new Uint8Array(view.buffer).copyWithin(to, from, from + bytes); },
      2956: (pass: number, count: number, pointer: number, flags: number) => { assert.deepEqual([pass, count, view.getUint32(pointer, true), flags], [0, 1, 12, 0]); draws += 1; matrixEvents.push("draw"); },
      2249: (mips: number, format: number, dimensions: number, levels: number, flags: number) => {
        assert.deepEqual([view.getUint32(mips, true), format, view.getUint32(dimensions, true), view.getUint32(dimensions + 4, true), levels, flags], [2112 + (quads ? count * 32 : 0), 0, 64, 64, 1, 112]); textures += 1; return 21;
      },
      3137: () => 22, 748: (handle: number) => { released.push(handle); },
    }});
    const memory = exports.memory; assert.ok(memory instanceof WebAssembly.Memory); const view = new DataView(memory.buffer);
    const scalar = (name: string, value: number) => { const target = exports[name]; assert.ok(target instanceof WebAssembly.Global); target.value = value; };
    const invoke = (name: string, ...args: number[]) => { const target = exports[name]; assert.equal(typeof target, "function"); if (typeof target === "function") return target(...args); };
    const MODEL = 196608 + 4096; const MODEL_TYPE = 20;
    view.setUint32(20 + 1341168, MODEL_TYPE, true);
    const DEVICE = 400_000;
    view.setUint32(2734712, DEVICE, true);
    view.setUint32(DEVICE + 460, 3, true);
    scalar("stack", 196608); scalar("gwonmac_cartography_context_status", 1); scalar("gwonmac_cartography_context_area_epoch", 7);
    const owner = 256; const region = 2048; const bytes = 64 + (quads ? count * 32 : 0) + 64 * 64 * 4;
    view.setFloat32(1024, 17, true); view.setUint32(owner + 4, 2, true);
    const header = () => {
      [quads ? NATIVE_MAP_QUADS_MAGIC : NATIVE_MAP_GRAPHICS_MAGIC, bytes, 7, 64, 64, 1, 2, quads ? count : 0].forEach((value, index) => view.setUint32(region + index * 4, value, true));
      if (!quads) [100, 200, 300, 200, 300, 400, 100, 400].forEach((value, index) => view.setFloat32(region + 32 + index * 4, value, true));
      else [[100, 200, 300, 400, 0, 0, 0.5, 1], [500, 600, 520, 620, 0.5, 0, 1, 1]].flat()
        .forEach((value, index) => view.setFloat32(region + 64 + index * 4, value, true));
    };
    const assertQueueBusy = () => {
      for (const phase of [null, 0, 1, 2, 4]) {
        view.setUint32(2734712, phase === null ? 0 : DEVICE, true);
        view.setUint32(DEVICE + 460, phase ?? 3, true);
        const before = new Uint8Array(memory.buffer).slice();
        assert.equal(invoke("publish", region, bytes), 2, `queue phase ${phase} defers publishing`);
        assert.deepEqual(new Uint8Array(memory.buffer), before, "busy leaves native memory unchanged");
      }
      view.setUint32(2734712, DEVICE, true);
      view.setUint32(DEVICE + 460, 3, true);
    };
    header(); assert.equal(invoke("publish", region, bytes), 0, "no owner before native draw event");
    invoke("render", owner); assert.equal(draws, 0);
    assertQueueBusy(); assert.equal(textures, 0, "first upload waits before allocating");
    assert.equal(invoke("publish", region, bytes), 1); assert.deepEqual(released.splice(0), [22, 21]);
    invoke("render", owner); assert.equal(draws, 1);
    assert.deepEqual(matrixEvents.splice(0), ["save", "identity", "capture-model", "capture-view", "draw", "restore"]);
    assert.equal(view.getFloat32(65536, true), 100); assert.equal(view.getFloat32(65540, true), -200);
    assert.equal(view.getFloat32(65536 + 2 * 24, true), 300); assert.equal(view.getFloat32(65536 + 2 * 24 + 4, true), -400);
    if (quads) {
      assert.equal(view.getFloat32(65536 + 24 + 16, true), 0.5, "each quad samples its own atlas cell");
      assert.equal(view.getFloat32(65536 + 96, true), 500, "the second quad has its own world rectangle");
      assert.deepEqual([0, 1, 2, 3, 4, 5].map((index) => view.getUint16(131072 + 12 + index * 2, true)), [4, 5, 6, 4, 6, 7]);
    }
    invoke("render", owner); assert.equal(textures, 1, "native draws reuse the texture");
    // While the native renderer holds the model, publishing reports busy and
    // changes nothing; the host retries on a later frame.
    assertQueueBusy(); assert.equal(textures, 1, "existing texture stays allocated");
    view.setUint32(MODEL + 152, 1, true); header();
    assert.equal(invoke("publish", region, bytes), 2); assert.equal(textures, 1); assert.deepEqual(released, []);
    const drawn = draws; invoke("render", owner);
    assert.equal(draws, drawn + 1, "a busy publish keeps the current texture drawn");
    view.setUint32(MODEL + 152, 0, true);
    header(); assert.equal(invoke("publish", region, bytes), 1); assert.equal(meshes, 1);
    for (const [offset, value] of [[0, 0], [8, 6], [12, 63], [16, 4096], [20, 0]] as const) {
      header(); view.setUint32(region + offset, value, true); assert.equal(invoke("publish", region, bytes), 0);
    }
    header(); view.setFloat32(region + (quads ? 64 + 36 : 32), NaN, true); assert.equal(invoke("publish", region, bytes), 0);
    if (quads) {
      header(); view.setFloat32(region + 64 + 40, 2e6, true); assert.equal(invoke("publish", region, bytes), 0, "unbounded quad");
      for (const refused of [0, NATIVE_MAP_QUADS_MAX + 1]) {
        header(); view.setUint32(region + 28, refused, true); assert.equal(invoke("publish", region, bytes), 0, `quad count ${refused}`);
      }
    }
    assert.equal(invoke("publish", memory.buffer.byteLength - 4, bytes), 0); assert.equal(invoke("publish", -1, bytes), 0);
    assert.equal(textures, 2);
    header(); assert.equal(invoke("publish", region, bytes), 1);
    const before = draws;
    if (surface.startsWith("world")) {
      view.setUint32(owner + 4, 3, true); invoke("render", owner); assert.equal(draws, before, "continent change withdraws old pixels");
      assert.equal(invoke("publish", region, bytes), 0, "old continent cannot publish");
    } else {
      scalar("gwonmac_cartography_context_area_epoch", 8); invoke("render", owner); assert.equal(draws, before);
    }
    released.length = 0; invoke("destroy", owner); invoke("destroy", owner); assert.deepEqual(released, [12, 11]);
  }
});

test("each map draws its surfaces in the shared order", async () => {
  assert.ok(process.env.GW_CLIENT_WASM);
  const output = transformCartographySpikeWasm(new Uint8Array(await readFile(process.env.GW_CLIENT_WASM)), "relocated");
  const exported = parseExports(sectionById(splitSections(output), 7));
  const evidence = wasmEvidence(output); assert.ok(evidence); const decoded = evidence.decodeFunctions([]);
  for (const [map, dispatcher] of [["mission", 16136], ["world", 16224]] as const) {
    const renders = NATIVE_MAP_GRAPHICS_SURFACES.filter((surface) => surface.startsWith(map)).map((surface) => {
      const publish = exported.find((entry) => entry.name === `gwonmac_${surface}_graphics_publish`)?.index;
      assert.ok(publish !== undefined); return publish - 1;
    });
    const sites = decoded.find((row) => row.functionIndex === dispatcher)?.callSites; assert.ok(sites);
    const offsets = renders.map((index) => { const calls = sites.get(index); assert.equal(calls?.length, 1); return calls[0]!.offset; });
    assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b), `${map} surfaces draw in declaration order`);
  }
});

test("the map pointer answer follows the hovered frame's ancestors and refuses bad memory", async () => {
  assert.ok(process.env.GW_CLIENT_WASM);
  const output = transformCartographySpikeWasm(new Uint8Array(await readFile(process.env.GW_CLIENT_WASM)), "relocated");
  const sections = splitSections(output); const bodies = parseCode(sectionById(sections, 10));
  const evidence = wasmEvidence(output); assert.ok(evidence); const module = evidence.moduleView();
  const index = parseExports(sectionById(sections, 7)).find((entry) => entry.name === "gwonmac_map_pointer_within")?.index;
  assert.ok(index !== undefined);
  assert.equal(evidence.decodeFunctions([]).find((row) => row.functionIndex === index)?.callSites.size ?? 0, 0, "the answer calls nothing");
  const section = (id: number, body: Uint8Array) => encodeSection({id, body});
  const fixture = concat(WASM_HEADER, section(1, sectionById(sections, 1)),
    section(3, concat(uleb(1), uleb(module.functionTypeIndices[index]!))), section(5, concat(Uint8Array.of(1, 0), uleb(96))),
    section(7, concat(uleb(2), encodeName("pointer"), Uint8Array.of(0, 0), encodeName("memory"), Uint8Array.of(2, 0))),
    section(10, encodeCode([bodies[index - module.functionImportCount]!])));
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(fixture)));
  const memory = exports.memory; assert.ok(memory instanceof WebAssembly.Memory); const view = new DataView(memory.buffer);
  const pointer = exports.pointer; assert.equal(typeof pointer, "function"); if (typeof pointer !== "function") return;
  const UNDER_MOUSE = 5911100; const [map, panel, marker] = [65536, 131072, 196608];
  const frame = (at: number, id: number, parent: number) => { view.setUint32(at + 0xbc, id, true); view.setUint32(at + 0x128, parent ? parent + 0x128 : 0, true); };
  frame(map, 77, 0); frame(panel, 90, 0); frame(marker, 12, map);
  view.setUint32(UNDER_MOUSE, 0, true); assert.equal(pointer(77), 0, "nothing hovered");
  view.setUint32(UNDER_MOUSE, map, true); assert.equal(pointer(77), 1); assert.equal(pointer(0), 0); assert.equal(pointer(-1), 0);
  view.setUint32(UNDER_MOUSE, marker, true); assert.equal(pointer(77), 1, "a child of the map counts");
  view.setUint32(UNDER_MOUSE, panel, true); assert.equal(pointer(77), 0, "a covering panel does not");
  view.setUint32(UNDER_MOUSE, memory.buffer.byteLength - 8, true); assert.equal(pointer(77), 0, "out-of-bounds frames are refused");
  let tail = 262144; frame(tail, 1, 0);
  for (let depth = 0; depth < 20; depth += 1) { const next = tail + 1024; frame(next, 2, tail); tail = next; }
  view.setUint32(UNDER_MOUSE, tail, true); assert.equal(pointer(1), 0, "the ancestor walk is bounded");
});
