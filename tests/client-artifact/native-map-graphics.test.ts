/** Executes native map draw ownership, matrix restoration and bitmap refusal. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transformCartographySpikeWasm } from "../../src/main/certification/pathing-spike-transform.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import { concat, encodeCode, encodeSection, parseCode, parseExports, sectionById, splitSections, uleb, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { encodeName } from "../../src/main/certification/cartography-transform-internals.js";
import { NATIVE_MAP_GRAPHICS_MAGIC } from "../../src/shared/native-map-graphics.js";

test("each native map owns its mesh, restores matrices and refuses stale or malformed textures", async () => {
  assert.ok(process.env.GW_CLIENT_WASM);
  const input = new Uint8Array(await readFile(process.env.GW_CLIENT_WASM));
  const output = transformCartographySpikeWasm(input, "relocated");
  const sections = splitSections(output); const bodies = parseCode(sectionById(sections, 10));
  const evidence = wasmEvidence(output); assert.ok(evidence); const module = evidence.moduleView();
  const exported = parseExports(sectionById(sections, 7)); const decoded = evidence.decodeFunctions([]);
  for (const surface of ["mission", "world", "mission_hover", "world_hover"] as const) {
    const publishIndex = exported.find((entry) => entry.name === `gwonmac_${surface}_graphics_publish`)?.index;
    assert.ok(publishIndex !== undefined);
    const selected = Array.from({length: 4}, (_, index) => publishIndex - 3 + index);
    const peers = [1444, 1445, 1446, 1448, 1449, 1554, 1564, 1569, 1579, 1333, 1334, 1357, 264, 2956, 2249, 3137, 748];
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
      section(5, Uint8Array.of(1, 0, 4)), section(6, sectionById(sections, 6)),
      section(7, concat(uleb(labels.length + globals.length + 2),
        ...labels.map((name, index) => concat(encodeName(name), Uint8Array.of(0), uleb(peers.length + index))),
        encodeName("memory"), Uint8Array.of(2, 0), encodeName("stack"), Uint8Array.of(3, 0),
        ...globals.map((entry) => concat(encodeName(entry.name), Uint8Array.of(3), uleb(entry.index))))),
      section(10, encodeCode(rewritten)));
    const released: number[] = []; const matrixEvents: string[] = [];
    let textures = 0; let meshes = 0; let draws = 0;
    const { exports } = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(fixture)), {peer: {
      1444: (format: number, flags: number) => { assert.deepEqual([format, flags], [265, 0]); meshes += 1; return 11; },
      1445: (handle: number, count: number) => { assert.deepEqual([handle, count], [11, 6]); return 131072; },
      1446: (handle: number, count: number) => { assert.deepEqual([handle, count], [11, 4]); return 65536; },
      1448: (handle: number) => { assert.equal(handle, 11); }, 1449: () => {},
      1554: (count: number, buffer: number, material: number, flags: number, extra: number) => {
        assert.deepEqual([count, view.getUint32(buffer, true), view.getUint32(material, true), flags, extra], [1, 11, 22, 0, 0]); return 12;
      },
      1564: (count: number, pointer: number) => { assert.deepEqual([count, view.getUint32(pointer, true)], [1, 12]); matrixEvents.push("capture-view"); },
      1569: (draw: number, index: number, material: number) => { assert.deepEqual([draw, index, material], [12, 0, 22]); },
      1579: (draw: number, index: number) => { assert.deepEqual([draw, index], [12, 0]); matrixEvents.push("capture-model"); },
      1333: (matrix: number) => { assert.equal(matrix, 2); matrixEvents.push("save"); return 1024; },
      1334: (matrix: number, pointer: number) => { assert.equal(matrix, 2); assert.equal(view.getFloat32(pointer, true), 17); matrixEvents.push("restore"); },
      1357: (matrix: number) => { assert.equal(matrix, 2); matrixEvents.push("identity"); },
      264: (to: number, from: number, bytes: number) => { assert.equal(bytes, 52); new Uint8Array(view.buffer).copyWithin(to, from, from + bytes); },
      2956: (pass: number, count: number, pointer: number, flags: number) => { assert.deepEqual([pass, count, view.getUint32(pointer, true), flags], [0, 1, 12, 0]); draws += 1; matrixEvents.push("draw"); },
      2249: (mips: number, format: number, dimensions: number, levels: number, flags: number) => {
        assert.deepEqual([view.getUint32(mips, true), format, view.getUint32(dimensions, true), view.getUint32(dimensions + 4, true), levels, flags], [2112, 0, 64, 64, 1, 112]); textures += 1; return 21;
      },
      3137: () => 22, 748: (handle: number) => { released.push(handle); },
    }});
    const memory = exports.memory; assert.ok(memory instanceof WebAssembly.Memory); const view = new DataView(memory.buffer);
    const scalar = (name: string, value: number) => { const target = exports[name]; assert.ok(target instanceof WebAssembly.Global); target.value = value; };
    const invoke = (name: string, ...args: number[]) => { const target = exports[name]; assert.equal(typeof target, "function"); if (typeof target === "function") return target(...args); };
    scalar("stack", 196608); scalar("gwonmac_cartography_context_status", 1); scalar("gwonmac_cartography_context_area_epoch", 7);
    const owner = 256; const region = 2048; const bytes = 64 + 64 * 64 * 4;
    view.setFloat32(1024, 17, true); view.setUint32(owner + 4, 2, true);
    const header = () => {
      [NATIVE_MAP_GRAPHICS_MAGIC, bytes, 7, 64, 64, 1, 2, 0].forEach((value, index) => view.setUint32(region + index * 4, value, true));
      [100, 200, 300, 200, 300, 400, 100, 400].forEach((value, index) => view.setFloat32(region + 32 + index * 4, value, true));
    };
    header(); assert.equal(invoke("publish", region, bytes), 0, "no owner before native draw event");
    invoke("render", owner); assert.equal(draws, 0);
    assert.equal(invoke("publish", region, bytes), 1); assert.deepEqual(released.splice(0), [22, 21]);
    invoke("render", owner); assert.equal(draws, 1);
    assert.deepEqual(matrixEvents.splice(0), ["save", "identity", "capture-model", "capture-view", "draw", "restore"]);
    assert.equal(view.getFloat32(65536, true), 100); assert.equal(view.getFloat32(65540, true), -200);
    invoke("render", owner); assert.equal(textures, 1, "native draws reuse the texture");
    header(); assert.equal(invoke("publish", region, bytes), 1); assert.equal(meshes, 1);
    for (const [offset, value] of [[0, 0], [8, 6], [12, 63], [16, 4096], [20, 0]] as const) {
      header(); view.setUint32(region + offset, value, true); assert.equal(invoke("publish", region, bytes), 0);
    }
    header(); view.setFloat32(region + 32, NaN, true); assert.equal(invoke("publish", region, bytes), 0);
    assert.equal(invoke("publish", 262140, bytes), 0); assert.equal(invoke("publish", -1, bytes), 0);
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
