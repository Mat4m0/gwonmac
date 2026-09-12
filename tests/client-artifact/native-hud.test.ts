/** Executes the native HUD attachment, resource and input boundaries with controlled peers. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appendNativeHud } from "../../src/main/certification/native-hud-transform.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import { concat, encodeCode, encodeSection, parseCode, parseExports, sectionById, splitSections, uleb, vectorPayload, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { encodeName } from "../../src/main/certification/cartography-transform-internals.js";
import { NATIVE_HUD_MAGIC, NATIVE_HUD_HEADER as HEADER, NATIVE_HUD_LABELS, NATIVE_HUD_KEYCAP } from "../../src/shared/native-hud.js";

for (const channel of ["cooldowns", "keys", "effects"] as const) {
 test(`native ${channel} retains icon clipping, updates geometry without texture uploads, and frees every resource`, async () => {
  const isEffect = channel === "effects";
  const recordIndex = isEffect ? 8 : channel === "keys" ? 7 : 0;
  const childId = isEffect ? 127 : channel === "keys" ? 7 : 0;
  assert.ok(process.env.GW_CLIENT_WASM);
  const input = new Uint8Array(await readFile(process.env.GW_CLIENT_WASM));
  const output = appendNativeHud(input, 1);
  const sections = splitSections(output), bodies = parseCode(sectionById(sections, 10));
  const evidence = wasmEvidence(output); assert.ok(evidence); const module = evidence.moduleView();
  const exported = parseExports(sectionById(sections, 7));
  const label = exported.find((entry) => entry.name === "gwonmac_hud_label")?.index; assert.ok(label);
  const first = label - 8;
  const selected = [...Array.from({length: 7}, (_, n) => first + 2 + n), first, 6492, 6585, first + 9];
  const peers = [17640, 6587, 294, 295, 322, 334, 6588, 6598, 6599, 6601, 6602, first + 1, 6593, 748, 17791, 17793, 1444, 1445, 1446, 1448, 1449, 1554, 1572, 6446, 1563, 1569, 1579, 1333, 1334, 1357, 264, 1559, 5595, 2249, 3137];
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
  const scalarExports = exported.filter((entry) => entry.kind === 3 && entry.name.startsWith("gwonmac_hud_"));
  const section = (id: number, body: Uint8Array) => encodeSection({id, body});
  const labels = ["release", "reset", "mesh", "collect", "destroy", "atlas", "label", "originalCollect", "wrappedCollect", "buildCache", "hideStockKey"];
  const globalCount = vectorPayload(sectionById(sections, 6)).count;
  const fixture = concat(WASM_HEADER,
    section(1, sectionById(sections, 1)),
    section(2, concat(uleb(peers.length), ...peers.map((index) => concat(encodeName("peer"), encodeName(String(index)), Uint8Array.of(0), uleb(module.functionTypeIndices[index]!))))),
    section(3, concat(uleb(selected.length), ...selected.map((index) => uleb(module.functionTypeIndices[index]!)))),
    section(4, concat(uleb(1), Uint8Array.of(0x70, 0), uleb(1714))),
    section(5, Uint8Array.of(1, 0, 128, 1)),
    section(6, concat(uleb(globalCount), ...Array.from({length: globalCount}, () => Uint8Array.of(0x7f, 1, 0x41, 0, 0x0b)))),
    section(7, concat(uleb(labels.length + scalarExports.length + 3),
      ...labels.map((name, index) => concat(encodeName(name), Uint8Array.of(0), uleb(peers.length + index))),
      encodeName("memory"), Uint8Array.of(2, 0), encodeName("stack"), Uint8Array.of(3, 0), encodeName("skillbar"), Uint8Array.of(3, 1),
      ...scalarExports.map((entry) => concat(encodeName(entry.name), Uint8Array.of(3), uleb(entry.index))))),
    section(9, concat(uleb(1), Uint8Array.of(0, 0x41, 0xae, 0x0d, 0x0b), uleb(4), ...[6598, 6599, 6601, 6602].map((index) => uleb(indices.get(index)!)))),
    section(10, encodeCode(rewritten)));
  let textureCreates = 0, invalidations = 0, meshes = 0, destroyed = 0, nextHandle = 100;
  const refs = new Map<number, number>(); const meshVertices = new Map<number, number>();
  const create = () => { const handle = nextHandle++; refs.set(handle, 1); return handle; };
  const collected: number[] = [];
  let heap = 5_000_000; const allocations = new Set<number>();
  const exports: WebAssembly.Exports = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(fixture)), {peer: {
    17640: () => { throw new Error("fixture cache must be initialized"); },
    6587: (count: number, vectors: number) => {
      for (let n = 0; n < count; n++) {
        const vector = vectors + n * 16;
        for (let at = 0; at < view.getUint32(vector + 8, true); at++) {
          collected.push(view.getUint32(view.getUint32(vector, true) + at * 4, true));
        }
        view.setUint32(vector + 8, 0, true);
      }
    },
    294: () => { throw new Error("fixture cache capacity exceeded"); },
    295: () => { throw new Error("fixture cache allocation unexpected"); },
    322: () => { throw new Error("native assertion"); },
    334: () => { throw new Error("fixture cache free unexpected"); },
    6588: () => { throw new Error("fixture cache grow unexpected"); },
    6598: (out: number) => { [0, 0, 1024, 768].forEach((v, n) => view.setFloat32(out + n * 4, v, true)); },
    6599: () => {},
    6601: (out: number) => { [0, 0, 1024, 768].forEach((v, n) => view.setFloat32(out + n * 4, v, true)); },
    6602: () => {},
    [first + 1]: (owner: number) => { destroyed++; return owner; },
    6593: () => { invalidations++; },
    748: (handle: number) => { assert.ok(refs.has(handle), `release unknown ${handle}`); refs.delete(handle); },
    17791: (bytes: number) => { const p = heap; heap += bytes; allocations.add(p); return p; },
    17793: (pointer: number) => { assert.ok(allocations.delete(pointer)); },
    1444: () => create(),
    1445: () => 7_000_000,
    1446: (handle: number) => { const p = 6_000_000; meshVertices.set(handle, p); meshes++; return p; },
    1448: () => {}, 1449: () => {},
    1554: (count: number, mesh: number, material: number) => {
      assert.equal(count, 1); assert.ok(refs.has(view.getUint32(mesh, true))); assert.ok(refs.has(view.getUint32(material, true))); return create();
    },
    1572: (_draw: number, flags: number) => { assert.equal(flags, 6); },
    6446: (position: number) => { assert.equal(position, 256 + 208); },
    1563: () => {}, 1569: () => {}, 1579: () => {},
    1333: () => 1000, 1334: () => {}, 1357: () => {},
    264: (to: number, from: number, bytes: number) => { new Uint8Array(view.buffer).copyWithin(to >>> 0, from >>> 0, (from >>> 0) + bytes); },
    1559: (_handle: number, alpha: number) => { assert.equal(alpha, 127); },
    5595: (_output: number, needed: number, count: number) => { assert.equal(needed, count + 1); },
    2249: (_pixels: number, format: number, dimensions: number, mips: number, flags: number) => {
      assert.deepEqual([format, view.getUint32(dimensions, true), view.getUint32(dimensions + 4, true), mips, flags], [0, 1024, 1024, 1, 112]); textureCreates++; return create();
    },
    3137: (_count: number, _texture: number, stage: number, _shader: number, _a: number, _b: number, _flags: number, order: number) => {
      assert.deepEqual([view.getUint32(stage, true), order], [7, 11]); return create();
    },
  }}).exports;
  assert.ok(exports.memory instanceof WebAssembly.Memory); let view = new DataView(exports.memory.buffer);
  const invoke = (name: string, ...args: number[]) => { const target = exports[name]; assert.equal(typeof target, "function"); if (typeof target === "function") return target(...args); };
  const scalar = (name: string, value: number) => { const target = exports[name]; assert.ok(target instanceof WebAssembly.Global); target.value = value; };
  scalar("stack", 7_900_000); scalar("skillbar", 43);
  const region = 2048, atlasBytes = 8 + 1024 * 1024 * 4;
  view.setUint32(region, NATIVE_HUD_MAGIC, true); view.setUint32(region + 4, 1024, true);
  assert.equal(invoke("atlas", region, atlasBytes - 1), 0);
  assert.equal(invoke("atlas", region, atlasBytes), 1);
  const frame = 256, parent = 1024, outputVector = 1800;
  const u = (at: number, value: number) => view.setUint32(at, value, true);
  const f = (at: number, value: number) => view.setFloat32(at, value, true);
  u(frame + 184, isEffect ? childId : 2); u(frame + 188, 50); u(frame + 296, parent + 296);
  u(parent + 188, 44); u(parent + 184, childId); u(parent + 296, 4600 + 296); u(4600 + 188, 43); u(4600 + 308, 1726357791); f(4600 + 48, 1); f(parent + 48, 1); f(frame + 48, .5);
  u(frame + 32, 4500); u(frame + 40, 6); // Live bitmap has six stock layer slots.
  u(4500 + 5 * 16, 4700); u(4500 + 5 * 16 + 8, 1); u(4700, 777);
  u(outputVector, 1900);
  [100, 200, 164, 264].forEach((v, n) => f(frame + 268 + n * 4, v));
  const header = (count = 1) => {
    [NATIVE_HUD_MAGIC, HEADER + count * 32, recordIndex, 43, childId, count, channel === "keys" && count ? NATIVE_HUD_KEYCAP : 0].forEach((v, n) => u(region + n * 4, v));
    [.25, .25, .5, .5, 0, 0, 1, 1].forEach((v, n) => f(region + HEADER + n * 4, v));
  };
  header(); assert.equal(invoke("label", region, HEADER + 32), 1);
  if (!isEffect) assert.equal(invoke("collect", parent + 4, 9, outputVector), 0, "logical skill containers are not bitmap draw owners");
  assert.equal(invoke("collect", frame + 4, 8, outputVector), 1, "empty intermediate slots keep the stock traversal alive");
  assert.equal(meshes, 0, "only the native final clip category gets labels");
  // Execute the exact stock cache loop, including its early-exit behavior.
  // Calling collect(9) directly hid the live failure for six-slot bitmaps.
  const veil = 16000, laterPanel = 17000, stockKey = 20000;
  u(veil, 1); u(veil + 184, 0); u(veil + 188, 51); u(veil + 296, frame + 296);
  u(veil + 32, 18000); u(veil + 40, 1); u(18000, 19000); u(18008, 1); u(19000, 778);
  u(laterPanel + 184, 900); u(laterPanel + 188, 52);
  u(laterPanel + 32, 18100); u(laterPanel + 40, 1); u(18100, 19004); u(18108, 1); u(19004, 779);
  u(stockKey, 1); u(stockKey + 184, 6); u(stockKey + 188, 53); u(stockKey + 296, frame + 296);
  u(stockKey + 28, 19400); u(19404, 780); // Stock keycap uses the implicit draw, without layer slots.
  u(5913696, 1); u(5913576, 4); u(5913568, 4800); u(4800, frame); u(4804, veil); u(4808, stockKey); u(4812, laterPanel);
  f(5910124, 1024); f(5910128, 768);
  u(5913680, 8000); u(5913684, 16); u(5913688, 16);
  for (let n = 0; n < 16; n++) { u(8000 + n * 16, 9000 + n * 256); u(8004 + n * 16, 64); }
  [0, 3, 1710, 1711, 4, 8, 1712, 1713, 9, 9, 1710, 1711].forEach((v, n) => u(1420256 + n * 4, v));
  invoke("buildCache");
  assert.equal(collected[0], 777, "stock bitmap drawing is preserved");
  assert.equal(collected.length, channel === "keys" ? 4 : 5, "only active key labels suppress the stock keycap");
  assert.equal(collected[1], 778, "native child veil must precede our label");
  if (channel !== "keys") assert.equal(collected[2], 780, "cooldowns and effects preserve stock keys");
  assert.ok(refs.has(collected.at(-2)!), "the retained label is above the veil and stock key drawing");
  assert.equal(collected.at(-1), 779, "later native panels remain above our label");
  assert.equal(meshes, 1);
  if (channel === "cooldowns") {
    const draw = collected.at(-2);
    const resourceCount = refs.size;
    // A keycap joins an existing cooldown in the same native draw. There is
    // no second object for later native sorting to move above the number.
    header(2); u(region + 24, NATIVE_HUD_KEYCAP);
    [.25, .25, .5, .5, 0, 0, 1, 1].forEach((v, n) => f(region + HEADER + 32 + n * 4, v));
    f(region + HEADER, .5);
    assert.equal(invoke("label", region, HEADER + 64), 1);
    collected.length = 0; invoke("buildCache");
    assert.deepEqual(collected, [777, 778, draw, 779], "keycap and cooldown are one ordered draw between the veil and later panels");
    assert.equal(refs.size, resourceCount, "coexistence adds no independent sorting object");
    assert.equal(view.getFloat32(6_000_000, true), 132, "first quad is the keycap");
    assert.equal(view.getFloat32(6_000_096, true), 116, "cooldown triangles follow inside the same mesh");
    const changedFlag = invalidations;
    header(); assert.equal(invoke("label", region, HEADER + 32), 1);
    assert.ok(invalidations > changedFlag, "turning off keycaps invalidates stock suppression without recreating the timer");
    collected.length = 0; invoke("buildCache");
    assert.deepEqual(collected, [777, 778, 780, draw, 779]);
    assert.equal(refs.size, resourceCount);
  }
  assert.equal(invoke("collect", frame + 4, 9, outputVector), 1);
  assert.equal(view.getUint32(outputVector + 8, true), 1);
  assert.equal(view.getFloat32(6_000_000, true), 116);
  assert.equal(view.getFloat32(6_000_004, true), 248);
  const invalidationsBefore = invalidations;
  header(); f(region + HEADER, .125); assert.equal(invoke("label", region, HEADER + 32), 1);
  assert.equal(textureCreates, 1); assert.equal(invalidations, invalidationsBefore, "countdown changes retain the compiled native batch");
  assert.equal(view.getFloat32(6_000_000, true), 108);
  f(frame + 276, 228); invoke("collect", frame + 4, 9, outputVector);
  assert.equal(view.getFloat32(6_000_000, true), 116, "native icon resize updates geometry without a texture upload");
  for (const [offset, value] of [[0, 0], [8, NATIVE_HUD_LABELS], [20, 9]] as const) { header(); u(region + offset, value); assert.equal(invoke("label", region, HEADER + 32), 0); }
  header(); u(region + 24, 2); assert.equal(invoke("label", region, HEADER + 32), 0, "unknown composition flags refuse");
  header(); u(region + 8, 8); u(region + 24, NATIVE_HUD_KEYCAP); assert.equal(invoke("label", region, HEADER + 32), 0, "effect labels cannot suppress player keycaps");
  for (const [field, value] of [[0, .75], [4, .75], [16, .75], [20, .75]] as const) {
    header();
    [.25, .25, .5, .5, .25, .25, .5, .5].forEach((v, n) => f(region + HEADER + n * 4, v));
    f(region + HEADER + field, value);
    assert.equal(invoke("label", region, HEADER + 32), 0, "complete extents and UV ordering must stay within the icon/atlas");
  }
  header(); f(region + HEADER + 8, 0); f(region + HEADER + 12, 0);
  assert.equal(invoke("label", region, HEADER + 32), 1, "zero-area clipping remains valid");
  header(); f(region + HEADER, NaN); assert.equal(invoke("label", region, HEADER + 32), 0);
  header(); f(region + HEADER, -1); assert.equal(invoke("label", region, HEADER + 32), 0);
  assert.equal(invoke("label", 8_388_604, 56), 0); assert.equal(invoke("label", -1, 56), 0);
  header(0); assert.equal(invoke("label", region, HEADER), 1);
  assert.equal(invoke("collect", frame + 4, 8, outputVector), 0, "disabled HUD restores the stock stopping point");
  assert.equal(refs.size, 1, "hiding releases the label's retained resources");
  collected.length = 0; invoke("buildCache");
  assert.deepEqual(collected, [777, 778, 780, 779], "disabling the replacement restores the untouched stock keycap");
  const meshesBeforeReappearance = meshes;
  header(); assert.equal(invoke("label", region, HEADER + 32), 1);
  assert.equal(invoke("collect", frame + 4, 9, outputVector), 1);
  assert.equal(meshes, meshesBeforeReappearance + 1, "reappearing labels have populated geometry on their first draw, before any digit changes");
  assert.equal(invoke("destroy", frame + 4), frame + 4); assert.equal(destroyed, 1);
  assert.equal(refs.size, 1, "icon destruction leaves only the shared atlas material");
  invoke("reset"); invoke("reset"); assert.equal(refs.size, 0); assert.equal(allocations.size, 0);
  assert.equal(textureCreates, 1);
  if (channel === "cooldowns") {
    const memory = exports.memory;
    const highRegion = 0x80000800;
    memory.grow(32768 + 128 - memory.buffer.byteLength / 65536);
    view = new DataView(memory.buffer);
    u(highRegion, NATIVE_HUD_MAGIC); u(highRegion + 4, 1024);
    assert.equal(invoke("atlas", highRegion | 0, atlasBytes), 1, "native atlas accepts a signed high-memory pointer");
    header();
    new Uint8Array(memory.buffer, highRegion, HEADER + 32).set(new Uint8Array(memory.buffer, region, HEADER + 32));
    assert.equal(invoke("label", highRegion | 0, HEADER + 32), 1);
    assert.equal(invoke("collect", frame + 4, 9, outputVector), 1);
    invoke("reset");
    assert.equal(refs.size, 0); assert.equal(allocations.size, 0);
  }
});

}
