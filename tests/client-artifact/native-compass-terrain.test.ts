/** Executes emitted native terrain ownership and upload code against controlled peers. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transformCartographySpikeWasm } from "../../src/main/certification/pathing-spike-transform.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import { concat, encodeCode, encodeSection, parseCode, parseExports, sectionById, splitSections, uleb, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { encodeName } from "../../src/main/certification/cartography-transform-internals.js";
import { NATIVE_COMPASS_CLIP_RADIUS, NATIVE_COMPASS_TERRAIN_MAGIC, NATIVE_COMPASS_WORLD_SCALE } from "../../src/shared/native-compass-terrain.js";

test("native terrain owns bounded resources, follows its Canvas and refuses invalid uploads", async () => {
  assert.ok(process.env.GW_CLIENT_WASM);
  const input = new Uint8Array(await readFile(process.env.GW_CLIENT_WASM));
  const output = transformCartographySpikeWasm(input, "relocated");
  const sections = splitSections(output); const bodies = parseCode(sectionById(sections, 10));
  const evidence = wasmEvidence(output); assert.ok(evidence); const module = evidence.moduleView();
  const exported = parseExports(sectionById(sections, 7));
  for (const surface of ["terrain", "ranges"] as const) {
  const prefix = `gwonmac_compass_${surface}`;
  const publishIndex = exported.find((entry) => entry.name === `${prefix}_publish`)?.index;
  assert.ok(publishIndex !== undefined);
  const first = publishIndex - 5;
  const selected = Array.from({length: 6}, (_, index) => first + index);
  const peers = [1444, 1445, 1446, 1448, 1449, 1556, 1565, 1579, 748, 6827, 2249, 3137, 1569];
  const indices = new Map([...peers, ...selected].map((index, position) => [index, position]));
  const decoded = evidence.decodeFunctions([]);
  const rewritten = selected.map((index) => {
    const body = bodies[index - module.functionImportCount]!;
    const sites = decoded.find((row) => row.functionIndex === index)?.callSites; assert.ok(sites);
    const edits = [...sites].flatMap(([target, calls]) => {
      const replacement = indices.get(target); assert.ok(replacement !== undefined, `unexpected peer ${target}`);
      return calls.map((site) => ({...site, replacement}));
    }).sort((a, b) => a.offset - b.offset);
    let cursor = 0; const parts: Uint8Array[] = [];
    for (const edit of edits) { parts.push(body.slice(cursor, edit.offset + 1), uleb(edit.replacement)); cursor = edit.operandEnd; }
    return concat(...parts, body.slice(cursor));
  });
  const globals = exported.filter((entry) => entry.kind === 3 && (entry.name.startsWith(`${prefix}_`)
    || ["gwonmac_cartography_context_area_epoch", "gwonmac_cartography_context_status"].includes(entry.name)));
  const section = (id: number, body: Uint8Array) => encodeSection({id, body});
  const labels = ["hide", "destroy", "init", "attach", "update", "publish"];
  const fixture = concat(WASM_HEADER,
    section(1, sectionById(sections, 1)),
    section(2, concat(uleb(peers.length), ...peers.map((index) => concat(encodeName("peer"), encodeName(String(index)), Uint8Array.of(0), uleb(module.functionTypeIndices[index]!))))),
    section(3, concat(uleb(selected.length), ...selected.map((index) => uleb(module.functionTypeIndices[index]!)))),
    section(5, Uint8Array.of(1, 0, 4)), section(6, sectionById(sections, 6)),
    section(7, concat(uleb(labels.length + globals.length + 2),
      ...labels.map((name, index) => concat(encodeName(name), Uint8Array.of(0), uleb(peers.length + index))),
      encodeName("memory"), Uint8Array.of(2, 0), encodeName("stack"), Uint8Array.of(3, 0),
      ...globals.map((entry) => concat(encodeName(entry.name), Uint8Array.of(3), uleb(entry.index))))),
    section(10, encodeCode(rewritten)));
  const released: number[] = []; const vertices: number[] = []; const indicesAllocated: number[] = [];
  let textureCreates = 0; let attachments = 0;
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(fixture)), {peer: {
    1444: (format: number, flags: number) => { assert.deepEqual([format, flags], [265, 0]); return 11; },
    1445: (handle: number, count: number) => { assert.equal(handle, 11); indicesAllocated.push(count); return 131072; },
    1446: (handle: number, count: number) => { assert.equal(handle, 11); vertices.push(count); return 65536; },
    1448: (handle: number) => { assert.equal(handle, 11); },
    1449: (handle: number, min: number, max: number) => { assert.equal(handle, 11); assert.equal(view.getFloat32(min, true), 0); assert.ok(view.getFloat32(max, true) > 0); },
    1556: (handle: number) => { assert.equal(handle, 7); return 12; },
    1565: (draw: number, index: number, buffer: number) => { assert.deepEqual([draw, index, buffer], [12, 0, 11]); },
    1579: (draw: number, index: number) => { assert.deepEqual([draw, index], [12, 0]); },
    748: (handle: number) => { released.push(handle); },
    6827: (frame: number, count: number, pointer: number, slot: number) => { assert.deepEqual([frame, count, view.getUint32(pointer, true), slot], [43, 1, 12, 4]); attachments += 1; },
    2249: (mips: number, format: number, dimensions: number, levels: number, flags: number) => {
      assert.deepEqual([view.getUint32(mips, true), format, view.getUint32(dimensions, true), view.getUint32(dimensions + 4, true), levels, flags], [2080, 0, 64, 64, 1, 112]);
      textureCreates += 1; return 21;
    },
    3137: (count: number, texture: number, sampler: number, shader: number, a: number, b: number, flags: number, mode: number) => {
      assert.deepEqual([count, view.getUint32(texture, true), view.getUint32(sampler, true), view.getUint32(shader, true), a, b, flags, mode], [1, 21, surface === "ranges" ? 4 : 7, 482, 0, 0, 33555424, surface === "ranges" ? 4 : 11]); return 22;
    },
    1569: (draw: number, index: number, material: number) => { assert.deepEqual([draw, index, material], [12, 0, 22]); },
  }});
  assert.ok(exports.memory instanceof WebAssembly.Memory); const view = new DataView(exports.memory.buffer);
  const scalar = (name: string, value: number) => { const target = exports[name]; assert.ok(target instanceof WebAssembly.Global); target.value = value; };
  const invoke = (name: string, ...args: number[]) => { const target = exports[name]; assert.equal(typeof target, "function"); if (typeof target === "function") return target(...args); };
  scalar("stack", 196608); scalar("gwonmac_cartography_context_status", 1); scalar("gwonmac_cartography_context_area_epoch", 7);
  const owner = 256; const camera = 768; const direction = 784; const region = 2048; const bytes = 32 + 64 * 64 * 4;
  const rectangle = (width: number, height: number) => {
    [17, 29, 17 + width, 29 + height].forEach((value, index) => view.setFloat32(owner + 172 + index * 4, value, true));
  };
  view.setUint32(owner + 144, 7, true); rectangle(245, 245); view.setFloat32(direction, 0, true); view.setFloat32(direction + 4, 1, true);
  const header = () => {
    [NATIVE_COMPASS_TERRAIN_MAGIC, bytes, 7, 64].forEach((value, index) => view.setUint32(region + index * 4, value, true));
    [-8192, 8192, 16384].forEach((value, index) => view.setFloat32(region + 16 + index * 4, value, true));
    view.setUint32(region + 28, 1, true);
  };
  header(); assert.equal(invoke("publish", region, bytes), 0); assert.equal(textureCreates, 0);
  invoke("init", owner); invoke("attach", owner, 43); assert.equal(attachments, 1);
  assert.equal(invoke("publish", region, bytes), 1); assert.deepEqual(released.splice(0), [22, 21]);
  invoke("update", owner, camera, direction); assert.deepEqual(vertices.splice(0), [129]); assert.equal(indicesAllocated.at(-1), 576);
  assert.equal(view.getFloat32(65536, true), 122.5); assert.equal(view.getFloat32(65540, true), 122.5);
  assert.equal(view.getFloat32(65552, true), 0.5); assert.equal(view.getFloat32(65556, true), 0.5);
  assert.ok(Math.abs(view.getFloat32(65536 + 24, true) - (122.5 + 245 * NATIVE_COMPASS_CLIP_RADIUS - 1)) < 0.001);
  assert.ok(Math.abs(view.getFloat32(65552 + 24, true) - (0.5 + (NATIVE_COMPASS_CLIP_RADIUS - 1 / 245) / (surface === "ranges" ? 1 : NATIVE_COMPASS_WORLD_SCALE * 16384))) < 0.00001);
  for (let index = 0; index < 576; index += 1) assert.ok(view.getUint16(131072 + index * 2, true) < 129);
  for (const [width, height] of [[384, 384], [320, 192]] as const) {
    rectangle(width, height); invoke("update", owner, camera, direction);
    assert.equal(view.getFloat32(65536, true), width / 2); assert.equal(view.getFloat32(65540, true), height / 2);
  }
  assert.equal(textureCreates, 1, "camera and rectangle updates do not allocate textures");
  const allocationsBeforeIdle = indicesAllocated.length;
  invoke("update", owner, camera, direction); invoke("update", owner, camera, direction);
  assert.equal(indicesAllocated.length, allocationsBeforeIdle, "idle native frames do not rewrite mesh buffers");
  view.setFloat32(camera, 100, true); invoke("update", owner, camera, direction);
  assert.equal(indicesAllocated.length, allocationsBeforeIdle + (surface === "ranges" ? 0 : 1),
    "only world-anchored terrain responds to camera movement");
  for (const [offset, value] of [[0, 0], [8, 6], [12, 63], [12, 4096], [28, 0]] as const) {
    header(); view.setUint32(region + offset, value, true); assert.equal(invoke("publish", region, bytes), 0);
  }
  assert.equal(invoke("publish", 262140, bytes), 0); assert.equal(invoke("publish", -1, bytes), 0);
  assert.equal(textureCreates, 1);
  header(); assert.equal(invoke("publish", region, bytes), 1); released.length = 0;
  scalar("gwonmac_cartography_context_area_epoch", 8); invoke("update", owner, camera, direction);
  assert.equal(indicesAllocated.at(-1), 0);
  invoke("destroy", owner); invoke("destroy", owner); assert.deepEqual(released, [12, 11]);
  }
});
