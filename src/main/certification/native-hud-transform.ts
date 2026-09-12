/**
 * Attaches bounded skill and effect labels to native icon draw batches. The
 * original UI owns clipping and order; retained meshes avoid per-frame uploads.
 */
import { concat, encodeCode, encodeIndexVector, encodeSection, parseCode, parseExports,
  parseIndexVector, sectionById, sleb, splitSections, uleb, vectorPayload, WASM_HEADER } from "../core/wasm-binary.js";
import { encodeName } from "./cartography-transform-internals.js";
import { functionBodySha256, wasmEvidence } from "./wasm-evidence.js";
import { NATIVE_HUD_MAGIC, NATIVE_HUD_ATLAS_SIZE, NATIVE_HUD_LABELS, NATIVE_HUD_QUADS,
  NATIVE_HUD_HEADER, NATIVE_HUD_KEYCAP, NATIVE_HUD_SKILLS } from "../../shared/native-hud.js";

const CHECKED = [
  [13162, "8ab5e3b4ad9aadcd7e51245322cabda16c3c1882254c90284961c3068ceaa4e1"],
  [13125, "21369b96acf8fd04e0c4e50c23b45028425e3b56a73c7161f9fc150061737f55"],
  [6584, "7c47c6284394a67b717010e709f60ed59bbf8707af023c3780b9e8f59ed0de43"],
  [6450, "098f5fa1ea2dc1e2a877db032dd20e423ee2ce86d33ff57974390ee04e0d2771"],
  [6598, "91f5cf516b125fd6181e4e003e4b6d7acc841c37052438bf9d213ff71e27bf87"],
  [6585, "3aee7481e1f32029de64d17a77323e41d5855d72b9cfc9f16081c184092ed579"],
  [14063, "fcb416a75de2054ce9f3b1fe2224a76e0bbd4bb0e426097d6e14ffa6e7011268"],
  [1554, "6a1b82f3d27e1077795392f733b2acd6b34f8be321dbc7ed65a7af8c07e80ac5"],
  [1572, "e34024b6fb2fc72d0c598285a60f3f204fa8cfb865d7fffaad2fd7c1fa7061c3"],
  [6446, "6884ee6ff0dc70791dfd9b591ced34ee462cab445c27d20967abdbd196e87213"],
  [6447, "1100a0920546b1e2b692658952b696a0de6efc01ae7ffb28c3ec27f5d2d3f23b"],
  [1563, "af1d5ab4f32141617c6be2b747144161eedcff5c5ed5e276d220ec2f28f495e5"],
  [6488, "386a60a3578c3650aeaa6b6ee7fdc840e4b8cc6b791d242ca20e31b7652bfc85"],
  [
    6492,
    "fa27fbb7e7dc27b59a962adab6142cdc494c230ed5fef602411ccbca7b08f217"
  ],
  [
    6490,
    "30d0f1d66769f1393c111cd0534200e03d36b408ec3be7ab1572550aba8c785c"
  ],
  [
    6593,
    "7c2c5556e6546a9059f7f3c654c1d214ae7bf06ce4fabeefbadc2b8d6691f153"
  ],
  [
    5595,
    "2d9c21a01d2ea73b47cba5da45fd09648fc01c49d0bd3e7957a2b8f4952a778a"
  ],
  [
    1569,
    "46b25139552a8d66a0b519d735755346f9be5d37ab2d1e9b02bca1d79bee20fc"
  ],
  [
    1579,
    "c46a846084eb5292db3d41d901724d9e2330cf1bb9f7fb1dec371fa642e4cc48"
  ],
  [
    1559,
    "d047b1ee5ed993986e60def91a371b46aef13ef04e6e83d2c72827d98376d24a"
  ],
  [
    1444,
    "88b977ad123c93c1926a67efe32721398cafb0f86fa2b3f5a57f3bd1493fb842"
  ],
  [
    1445,
    "a883926f470e716e59f62bec0b03adc8721112e78e859477bcab028de2ab311b"
  ],
  [
    1446,
    "3cfe5e2ff85ca8c472ad41c7a3ce4db7eb66c4dcb86b6fdfc69530067fecb650"
  ],
  [
    1448,
    "79c87cd0bab2c93f9718d557a7bd552ee2c37a70ec7f6d0f82224aa8c45e438d"
  ],
  [
    1449,
    "3e750376bbc2a51393c0ba169355550ba48a1b7fdea3fff8e1d0b1b5be2d6581"
  ],
  [
    2249,
    "149d95966e67f554da12f46c064ee366a9d531b167842e6ea0a201ca730b474e"
  ],
  [
    3137,
    "3f4d7e18ad91c20147e2053ee1e42f8eb60c97937fefba142d37c93f2d672e36"
  ],
  [
    748,
    "150d8921520d98fbfa28dc4faf5e2fe488a65c69832b13d7dcf489b2f07d7b60"
  ],
  [
    1333,
    "8799e3b4032b03c0c01c88236d3283d17c362ce3b300edf58bce919395fba064"
  ],
  [
    1334,
    "d0061147c7a6987af15a15663703b726f9bbc015fb5f3e6fa44b28df41dc1905"
  ],
  [
    1357,
    "ac2e8c49bb67981447c9f66c39b364f90c292c86efa3fe98456743608453f4f5"
  ],
  [
    264,
    "0265ff024218606f270c9dcca6166d3a5d4bc28809071377662ab1ce0f13e562"
  ]
] as const;
/** Exact native draw owners and resource operations bound by local verification. */
export const NATIVE_HUD_RENDERING_PROOF = Object.freeze({ functionBodies: CHECKED });

export function provesNativeHudRendering(evidence: NonNullable<ReturnType<typeof wasmEvidence>>): boolean {
  const module = evidence.moduleView();
  return CHECKED.every(([index, hash]) => index >= module.functionImportCount
    && index < module.functionTypeIndices.length
    && functionBodySha256(module, index) === hash)
    && ["malloc", "free"].every((name) => module.exports.some((entry) => entry.kind === 0 && entry.name === name));
}

const op = (...v: number[]) => Uint8Array.of(...v);
const i = (v: number) => concat(op(0x41), sleb(v));
const l = (v: number) => concat(op(0x20), uleb(v));
const s = (v: number) => concat(op(0x21), uleb(v));
const call = (v: number) => concat(op(0x10), uleb(v));
const f = (v: number) => { const b = new Uint8Array(5); b[0] = 0x43; new DataView(b.buffer).setFloat32(1, v, true); return b; };
const load = (v: number, float = false) => concat(op(float ? 0x2a : 0x28, 2), uleb(v));
const save = (v: number, float = false) => concat(op(float ? 0x38 : 0x36, 2), uleb(v));
const add = (a: Uint8Array, b: number) => concat(a, i(b), op(0x6a));
const stack = (n: number, bytes: number) => concat(op(0x23, 0), i(bytes), op(0x6b), s(n), l(n), op(0x24, 0));
const unstack = (n: number, bytes: number) => concat(l(n), i(bytes), op(0x6a, 0x24, 0));
// Private records: owner, mesh, draw, parent ID, child ID, quad count, keycap flag, 8 quads.
const STRIDE = 316;

export function appendNativeHud(input: Uint8Array, skillBarGlobal: number): Uint8Array {
  const evidence = wasmEvidence(input); if (!evidence) throw new Error("invalid native HUD input");
  const module = evidence.moduleView();
  if (!provesNativeHudRendering(evidence)) throw new Error("native HUD rendering proof changed");
  const sections = splitSections(input);
  const globals = vectorPayload(sectionById(sections, 6));
  const signatures = vectorPayload(sectionById(sections, 1));
  const exports = vectorPayload(sectionById(sections, 7));
  const names = parseExports(sectionById(sections, 7));
  const malloc = names.find((entry) => entry.name === "malloc")?.index;
  const free = names.find((entry) => entry.name === "free")?.index;
  if (malloc === undefined || free === undefined) throw new Error("native HUD allocators missing");
  const bodies = parseCode(sectionById(sections, 10));
  const types = parseIndexVector(sectionById(sections, 3));
  const base = globals.count;
  const g = (n: number) => concat(op(0x23), uleb(base + n));
  const put = (n: number) => concat(op(0x24), uleb(base + n));
  const increment = (n: number) => concat(g(n), i(1), op(0x6a), put(n));
  // Globals: records, material, uploads, updates, created, destroyed, collections, matched, published, next visible frame.
  const first = module.functionImportCount + bodies.length;
  const originalCollect = first, originalDestroy = first + 1, releaseIndex = first + 2;
  const hideStockKeyIndex = first + 9;
  const resetIndex = first + 3, meshIndex = first + 4, collectIndex = first + 5;
  const destroyIndex = first + 6, atlasIndex = first + 7, labelIndex = first + 8;
  const each = (n: number, body: Uint8Array) => concat(g(0), op(0x04, 0x40), i(0), s(n), op(0x03, 0x40),
    body, l(n), i(1), op(0x6a), s(n), l(n), i(NATIVE_HUD_LABELS), op(0x49, 0x0d, 0, 0x0b, 0x0b));
  const record = (n: number) => concat(g(0), l(n), i(STRIDE), op(0x6c, 0x6a));
  const release = concat(op(0), l(0), load(8), op(0x04, 0x40), call(6593),
    l(0), load(8), call(748), l(0), load(4), call(748), increment(5), op(0x0b),
    ...[0, 4, 8].map((at) => concat(l(0), i(0), save(at))), op(0x0b));
  const reset = concat(op(1, 1, 0x7f), each(0, concat(record(0), call(releaseIndex))),
    g(0), op(0x04, 0x40), g(0), call(free), i(0), put(0), op(0x0b),
    g(1), op(0x04, 0x40), g(1), call(748), i(0), put(1), op(0x0b, 0x0b));
  // Native bitmap vertices are UI coordinates relative to the frame's origin.
  // Native UI projection is captured independently; our model is identity like 6118.
  const vertex: Uint8Array[] = [];
  for (let v = 0; v < 4; v++) {
    const right = v === 1 || v === 2, bottom = v >= 2;
    vertex.push(
      l(3), l(1), load(268, true), l(1), load(236, true), op(0x93),
      l(4), load(0, true), ...(right ? [l(4), load(8, true), op(0x92)] : []), l(7), op(0x94, 0x92), save(v * 24, true),
      l(3), l(1), load(280, true), l(1), load(240, true), op(0x93),
      l(4), load(4, true), ...(bottom ? [l(4), load(12, true), op(0x92)] : []), l(8), op(0x94, 0x93), save(v * 24 + 4, true),
      l(3), f(0), save(v * 24 + 8, true), l(3), i(-1), save(v * 24 + 12),
      l(3), l(4), load(right ? 24 : 16, true), save(v * 24 + 16, true),
      l(3), l(4), load(bottom ? 28 : 20, true), save(v * 24 + 20, true));
  }
  const mesh = concat(op(2, 6, 0x7f, 2, 0x7d), // record0; frame1, scratch2, vertices3, quad4, indices5, n6; width7,height8
    l(0), load(8), op(0x45, 0x04, 0x40, 0x0f, 0x0b), l(0), load(0), s(1),
    l(1), load(276, true), l(1), load(268, true), op(0x93), s(7),
    l(1), load(280, true), l(1), load(272, true), op(0x93), s(8),
    l(0), load(4), l(0), load(20), i(4), op(0x6c), call(1446), s(3),
    l(0), load(4), l(0), load(20), i(6), op(0x6c), call(1445), s(5),
    l(0), load(20), op(0x04, 0x40), i(0), s(6), add(l(0), NATIVE_HUD_HEADER), s(4), op(0x03, 0x40), ...vertex,
    ...[0, 2, 1, 0, 3, 2].map((v, at) => concat(l(5), l(6), i(4), op(0x6c), i(v), op(0x6a, 0x3b, 1), uleb(at * 2))),
    add(l(3), 96), s(3), add(l(5), 12), s(5), add(l(4), 32), s(4), add(l(6), 1), s(6),
    l(6), l(0), load(20), op(0x49, 0x0d, 0, 0x0b, 0x0b),
    stack(2, 32), ...[0, 4, 8].map((at) => concat(l(2), f(-32768), save(at, true))),
    ...[12, 16, 20].map((at) => concat(l(2), f(32768), save(at, true))),
    l(0), load(4), l(2), add(l(2), 12), call(1449), l(0), load(4), call(1448),
    ...([268, 272, 276, 280, 236, 240, 260, 264] as const).map((at, n) => concat(l(0), l(1), load(at, true), save(284 + n * 4, true))),
    increment(3), unstack(2, 32), op(0x0b));
  // 13162 creates the stock hotkey at child 6 of the bitmap. Suppress only
  // that exact player's keycap while its replacement is published. The frame,
  // game binding and original drawing resources remain owned by the game.
  const hideStockKey = concat(op(1, 4, 0x7f), op(0x02, 0x40),
    g(0), op(0x45), g(1), op(0x45, 0x72, 0x0d, 0),
    add(l(0), -4), s(1), l(1), load(184), i(6), op(0x47, 0x0d, 0),
    l(1), load(296), s(2), l(2), op(0x45, 0x0d, 0), add(l(2), -296), s(2),
    l(2), load(184), i(2), op(0x47, 0x0d, 0),
    l(2), load(296), s(3), l(3), op(0x45, 0x0d, 0), add(l(3), -296), s(3),
    l(3), load(184), i(8), op(0x4f, 0x0d, 0),
    l(3), load(296), s(4), l(4), op(0x45, 0x0d, 0), add(l(4), -296), load(188),
    ...(skillBarGlobal ? [op(0x23), uleb(skillBarGlobal)] : [i(-1)]), op(0x47, 0x0d, 0),
    l(3), load(184), s(4),
    record(4), load(12), ...(skillBarGlobal ? [op(0x23), uleb(skillBarGlobal)] : [i(-1)]), op(0x46),
    record(4), load(16), l(3), load(184), op(0x46, 0x71), record(4), load(20), i(0), op(0x4b, 0x71), record(4), load(24), i(NATIVE_HUD_KEYCAP), op(0x71, 0x71, 0x0f, 0x0b),
    i(0), op(0x0b));
  // Slot 9 is the native final outer-clip category for this frame. The original
  // collector runs first; no native list is overwritten or given duplicate refs.
  // 6585 stops at the first absent stock slot. A matched HUD owner must report
  // its intervening empty slots so the cache reaches our final category.
  const collect = concat(op(2, 9, 0x7f, 1, 0x7d), // args0..2; result3,n4,r5,frame6,relation7,depth8,source9,scratch10,tmp11,alpha12
    l(0), call(hideStockKeyIndex), op(0x04, 0x7f), i(0), op(0x05), l(0), l(1), l(2), call(originalCollect), op(0x0b), s(3),
    l(1), i(9), op(0x4b), l(1), i(9), op(0x47), l(3), op(0x71, 0x72), g(1), op(0x45, 0x72), g(0), op(0x45, 0x72, 0x04, 0x40), l(3), op(0x0f, 0x0b),
    increment(6), l(0), i(4), op(0x6b), s(6),
    each(4, concat(record(4), s(5), op(0x02, 0x40),
      l(5), load(20), op(0x45, 0x0d, 0),
      // Locate this icon through the collected frame's ancestors. Its final
      // visible descendant must draw first, including recharge/effect veils.
      l(0), i(4), op(0x6b), s(6), i(0), s(8), op(0x02, 0x40, 0x03, 0x40),
        l(6), op(0x45, 0x0d, 1),
        l(4), i(NATIVE_HUD_SKILLS), op(0x49, 0x04, 0x7f),
          l(6), load(184), i(2), op(0x46), l(6), load(296), i(0), op(0x47, 0x71, 0x04, 0x7f),
            l(6), load(296), i(296), op(0x6b), load(184), l(5), load(16), op(0x46),
          op(0x05), i(0), op(0x0b),
        op(0x05), l(5), load(16), l(6), load(184), op(0x46, 0x0b, 0x0d, 1),
        l(6), load(296), s(7), i(0), s(6), l(7), op(0x04, 0x40), l(7), i(296), op(0x6b), s(6), op(0x0b),
        add(l(8), 1), s(8), l(8), i(16), op(0x49, 0x0d, 0), i(0), s(6), op(0x0b, 0x0b),
      l(6), op(0x45, 0x0d, 0),
      // Match the validated parent, then verify the native parent identity too.
      l(6), load(296), s(7), i(0), s(8), op(0x02, 0x40, 0x03, 0x40),
        l(7), op(0x45, 0x0d, 1), l(7), i(296), op(0x6b), load(188), l(5), load(12), op(0x46, 0x0d, 1),
        l(7), load(0), s(7), add(l(8), 1), s(8), l(8), i(16), op(0x49, 0x0d, 0), i(0), s(7), op(0x0b, 0x0b),
      l(7), op(0x45, 0x0d, 0),
      l(4), i(NATIVE_HUD_SKILLS), op(0x49, 0x04, 0x40),
        l(5), load(12), ...(skillBarGlobal ? [op(0x23), uleb(skillBarGlobal)] : [i(-1)]), op(0x47, 0x0d, 1),
      op(0x05), l(7), load(12), i(1726357791), op(0x47, 0x0d, 1, 0x0b),
      // Defer while the next visible native frame still belongs to this icon.
      // The exact cache call site supplies the next frame; no per-frame scan.
      g(9), s(9), i(0), s(8), i(0), s(11), op(0x02, 0x40, 0x03, 0x40),
        l(9), op(0x45, 0x0d, 1),
        l(9), l(6), op(0x46, 0x04, 0x40), i(1), s(11), op(0x0c, 2, 0x0b),
        l(9), load(296), s(7), i(0), s(9), l(7), op(0x04, 0x40), l(7), i(296), op(0x6b), s(9), op(0x0b),
        add(l(8), 1), s(8), l(8), i(16), op(0x49, 0x0d, 0, 0x0b, 0x0b), l(11), op(0x0d, 0),
      l(5), load(0), i(0), op(0x47), l(5), load(0), l(6), op(0x47, 0x71, 0x0d, 0),
      l(1), i(9), op(0x49, 0x04, 0x40), i(1), op(0x0f, 0x0b),
      increment(7),
      // Logical skill/effect icon frames need not own a retained bitmap draw.
      // Build our own draw and capture the same native UI matrices as 6488.
      l(5), load(8), op(0x45, 0x04, 0x40),
        l(5), l(6), save(0), l(5), i(265), i(0), call(1444), save(4),
        stack(10, 176), l(10), l(5), load(4), save(160), l(10), g(1), save(164),
        l(5), i(1), add(l(10), 160), add(l(10), 164), i(0), i(0), call(1554), save(8),
        l(5), load(8), i(6), call(1572), unstack(10, 176), increment(4),
        // A recreated mesh is empty even when this icon's cached bounds still
        // match. Populate it now instead of waiting for the next timer digit.
        l(5), call(meshIndex),
      op(0x0b),
      stack(10, 160),
      ...[0, 1, 2].map((matrix) => concat(add(l(10), matrix * 52), i(matrix), call(1333), i(52), call(264))),
      add(l(6), 208), call(6446), l(5), load(8), call(1563),
      i(2), call(1357), l(5), load(8), i(0), call(1579),
      ...[0, 1, 2].map((matrix) => concat(i(matrix), add(l(10), matrix * 52), call(1334))),
      unstack(10, 160),
      ...([268, 272, 276, 280, 236, 240, 260, 264] as const).flatMap((at, n) => [l(5), load(284 + n * 4, true), l(6), load(at, true), op(0x5c), ...(n ? [op(0x72)] : [])]),
      op(0x04, 0x40), l(5), call(meshIndex), op(0x0b),
      f(1), s(12), l(6), s(7), i(0), s(8), op(0x03, 0x40),
        l(12), l(7), load(48, true), op(0x94), s(12), l(7), load(296), s(7),
        l(7), op(0x04, 0x40), l(7), i(296), op(0x6b), s(7), op(0x0b),
        add(l(8), 1), s(8), l(7), i(0), op(0x47), l(8), i(16), op(0x49, 0x71, 0x0d, 0, 0x0b),
      l(5), load(8), l(12), f(255), op(0x94, 0xa8), call(1559),
      l(2), l(2), load(8), i(1), op(0x6a), l(2), load(8), call(5595),
      l(2), load(0), l(2), load(8), i(4), op(0x6c, 0x6a), l(5), load(8), save(0),
      l(2), l(2), load(8), i(1), op(0x6a), save(8), i(1), s(3), op(0x0b))),
    l(3), op(0x0b));
  const destroy = concat(op(1, 1, 0x7f), each(1, concat(record(1), load(0), add(l(0), -4), op(0x46, 0x04, 0x40), record(1), call(releaseIndex), op(0x0b))),
    l(0), call(originalDestroy), op(0x0b));
  const validMemory = (bytes: Uint8Array) => concat(l(0), i(0), op(0x4b), l(0), i(3), op(0x71, 0x45, 0x71),
    l(0), op(0xad), bytes, op(0xad, 0x7c), op(0x3f, 0, 0xad, 0x42), sleb(65536), op(0x7e, 0x58, 0x71));
  const atlasBytes = 8 + NATIVE_HUD_ATLAS_SIZE ** 2 * 4;
  const atlas = concat(op(1, 4, 0x7f), validMemory(i(atlasBytes)), l(1), i(atlasBytes), op(0x46, 0x71, 0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b),
    l(0), load(0), i(NATIVE_HUD_MAGIC), op(0x47), l(0), load(4), i(NATIVE_HUD_ATLAS_SIZE), op(0x47, 0x72, 0x04, 0x40), i(0), op(0x0f, 0x0b),
    stack(2, 48), l(2), add(l(0), 8), save(0), l(2), i(NATIVE_HUD_ATLAS_SIZE), save(8), l(2), i(NATIVE_HUD_ATLAS_SIZE), save(12),
    l(2), i(0), add(l(2), 8), i(1), i(112), call(2249), s(3),
    l(2), l(3), save(16), l(2), i(7), save(20), l(2), i(482), save(24),
    i(1), add(l(2), 16), add(l(2), 20), add(l(2), 24), i(0), i(0), i(33555424), i(11), call(3137), s(4),
    each(5, concat(record(5), load(8), op(0x04, 0x40), record(5), load(8), i(0), l(4), call(1569), op(0x0b))),
    g(1), op(0x04, 0x40), g(1), call(748), op(0x0b), l(4), put(1), l(3), call(748), increment(2),
    unstack(2, 48), i(1), op(0x0b));
  const label = concat(op(1, 4, 0x7f), validMemory(i(NATIVE_HUD_HEADER)), l(1), i(NATIVE_HUD_HEADER), op(0x4f, 0x71, 0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b),
    l(0), load(8), s(2), l(0), load(20), s(3),
    l(0), load(0), i(NATIVE_HUD_MAGIC), op(0x46), l(0), load(4), l(1), op(0x46, 0x71),
    l(2), i(NATIVE_HUD_LABELS), op(0x49, 0x71), l(3), i(NATIVE_HUD_QUADS), op(0x4d, 0x71),
    l(1), l(3), i(32), op(0x6c), i(NATIVE_HUD_HEADER), op(0x6a, 0x46, 0x71), validMemory(l(1)), op(0x71, 0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b),
    // Only player skill records can suppress a stock keycap. The flag is
    // metadata; key and timer triangles share this record's single draw.
    l(0), load(24), i(NATIVE_HUD_KEYCAP), op(0x4b),
    l(2), i(NATIVE_HUD_SKILLS), op(0x4f), l(0), load(24), i(0), op(0x47, 0x71, 0x72),
    op(0x04, 0x40), i(0), op(0x0f, 0x0b),
    // All coordinates and UVs are normalized, finite, and inside this icon/atlas.
    i(NATIVE_HUD_HEADER), s(4), op(0x02, 0x40, 0x03, 0x40), l(4), l(1), op(0x4f, 0x0d, 1),
      l(0), l(4), op(0x6a), load(0, true), f(0), op(0x60), l(0), l(4), op(0x6a), load(0, true), f(1), op(0x5f, 0x71, 0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b),
      add(l(4), 4), s(4), op(0x0c, 0, 0x0b, 0x0b),
    // Component bounds alone permit a quad to spill into a neighboring icon.
    // Validate complete extents and ordered UVs; zero-area clipping is valid.
    i(NATIVE_HUD_HEADER), s(4), op(0x02, 0x40, 0x03, 0x40), l(4), l(1), op(0x4f, 0x0d, 1),
      l(0), l(4), op(0x6a), load(0, true), l(0), l(4), op(0x6a), load(8, true), op(0x92), f(1), op(0x5f),
      l(0), l(4), op(0x6a), load(4, true), l(0), l(4), op(0x6a), load(12, true), op(0x92), f(1), op(0x5f, 0x71),
      l(0), l(4), op(0x6a), load(24, true), l(0), l(4), op(0x6a), load(16, true), op(0x60, 0x71),
      l(0), l(4), op(0x6a), load(28, true), l(0), l(4), op(0x6a), load(20, true), op(0x60, 0x71),
      op(0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b), add(l(4), 32), s(4), op(0x0c, 0, 0x0b, 0x0b),
    g(0), op(0x45, 0x04, 0x40), i(STRIDE * NATIVE_HUD_LABELS), call(malloc), put(0), g(0), op(0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b),
      i(0), s(4), op(0x03, 0x40), g(0), l(4), op(0x6a), i(0), save(0), add(l(4), 4), s(4), l(4), i(STRIDE * NATIVE_HUD_LABELS), op(0x49, 0x0d, 0, 0x0b, 0x0b),
    increment(8), record(2), s(5),
    l(5), load(12), l(0), load(12), op(0x47), l(5), load(16), l(0), load(16), op(0x47, 0x72, 0x04, 0x40), l(5), call(releaseIndex), op(0x0b),
    l(5), load(24), l(0), load(24), op(0x47, 0x04, 0x40), call(6593), op(0x0b),
    add(l(5), 12), add(l(0), 12), l(1), i(12), op(0x6b), call(264),
    l(3), op(0x45, 0x04, 0x40), l(5), call(releaseIndex), op(0x05),
      l(5), load(8), op(0x04, 0x40), l(5), call(meshIndex), op(0x05), call(6593), op(0x0b, 0x0b), i(1), op(0x0b));
  // 6585 owns visible frame order. Pass its next frame privately to the
  // collector so labels finish an icon subtree before later panels/tooltips.
  const cacheBody = bodies[6585 - module.functionImportCount]!;
  const cacheSite = evidence.decodeFunctions([]).find((row) => row.functionIndex === 6585)?.callSites.get(6492);
  if (cacheSite?.length !== 1) throw new Error("native HUD collection site changed");
  const site = cacheSite[0]!;
  bodies[6585 - module.functionImportCount] = concat(cacheBody.slice(0, site.offset),
    add(l(2), 4), l(3), op(0x49, 0x04, 0x7f), l(2), load(4), op(0x05), i(0), op(0x0b), put(9),
    cacheBody.slice(site.offset));
  const extraBodies = [bodies[6492 - module.functionImportCount]!, bodies[6490 - module.functionImportCount]!, release, reset, mesh, collect, destroy, atlas, label, hideStockKey];
  bodies[6492 - module.functionImportCount] = concat(op(0), l(0), l(1), l(2), call(collectIndex), op(0x0b));
  bodies[6490 - module.functionImportCount] = concat(op(0), l(0), call(destroyIndex), op(0x0b));
  const extraTypes = [op(0x60, 1, 0x7f, 0), op(0x60, 0, 0), op(0x60, 2, 0x7f, 0x7f, 1, 0x7f)];
  const functionTypes = [module.functionTypeIndices[6492]!, module.functionTypeIndices[6490]!, signatures.count,
    signatures.count + 1, signatures.count, module.functionTypeIndices[6492]!, module.functionTypeIndices[6490]!, signatures.count + 2, signatures.count + 2, module.functionTypeIndices[6490]!];
  const extraExports = [["reset", resetIndex], ["atlas", atlasIndex], ["label", labelIndex]].map(([name, index]) => concat(encodeName(`gwonmac_hud_${name}`), op(0), uleb(Number(index))));
  for (const [index, name] of ["records", "material", "uploads", "updates", "created", "destroyed", "collections", "matched", "published"].entries()) {
    if (index >= 2) extraExports.push(concat(encodeName(`gwonmac_hud_${name}`), op(3), uleb(base + index)));
  }
  return concat(WASM_HEADER, ...sections.map((section) => encodeSection({id: section.id,
    body: section.id === 1 ? concat(uleb(signatures.count + extraTypes.length), signatures.entries, ...extraTypes)
      : section.id === 3 ? encodeIndexVector([...types, ...functionTypes])
      : section.id === 6 ? concat(uleb(globals.count + 10), globals.entries, ...Array.from({length: 10}, () => concat(op(0x7f, 1), i(0), op(0x0b))))
      : section.id === 7 ? concat(uleb(exports.count + extraExports.length), exports.entries, ...extraExports)
      : section.id === 10 ? encodeCode([...bodies, ...extraBodies]) : section.body,
  })));
}
