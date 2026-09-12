/**
 * Owns bounded Cartography textures drawn by the native Mission and World Map.
 * Exact draw events retain the game's clipping, ordering and graphics context.
 */
import {
  concat, encodeCode, encodeIndexVector, encodeSection, parseCode, parseExports,
  parseIndexVector, sectionById, sleb, splitSections, uleb, vectorPayload, WASM_HEADER,
} from "../core/wasm-binary.js";
import { encodeName } from "./cartography-transform-internals.js";
import { functionBodySha256, wasmEvidence } from "./wasm-evidence.js";
import { NATIVE_MAP_GRAPHICS_HEADER_BYTES, NATIVE_MAP_GRAPHICS_MAGIC,
  NATIVE_MAP_GRAPHICS_MAX_SIZE, NATIVE_MAP_GRAPHICS_SURFACES } from "../../shared/native-map-graphics.js";

const CHECKED = [
  [
    16136,
    "34712a34dc14537a423cedb253e07f1ed042edc3a989937bf51d47ca5e69e08f"
  ],
  [
    16125,
    "59c2c2556eeb11939ddfca127f48e9147c954fda6644dfc100bcacbbbb78561c"
  ],
  [
    16224,
    "7fd419cd211b2d8cc343e626d799a9de508ad8120d700ccc6a7cf63d051501e6"
  ],
  [
    16170,
    "563f4f1eecdf6b1909dd4adf3bf2f5c48ad29d91ae8f188bba0f2e43b725b897"
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
    1554,
    "6a1b82f3d27e1077795392f733b2acd6b34f8be321dbc7ed65a7af8c07e80ac5"
  ],
  [
    1564,
    "2ec191d64613c3e4b68f69b0975c716bb4685d4d71dff1a0b1c423d3cc5b9bde"
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
  ],
  [
    2956,
    "f0368e490c0c24a79a9c667c1e815b4a66f28b495af15efe37c202aefb9406d9"
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
  ]
] as const;
const op = (...bytes: number[]) => Uint8Array.of(...bytes);
const i = (value: number) => concat(op(0x41), sleb(value));
const l = (index: number) => concat(op(0x20), uleb(index));
const s = (index: number) => concat(op(0x21), uleb(index));
const call = (index: number) => concat(op(0x10), uleb(index));
const f = (value: number) => {
  const bytes = new Uint8Array(5); bytes[0] = 0x43;
  new DataView(bytes.buffer).setFloat32(1, value, true); return bytes;
};
const load = (offset: number, float = false) => concat(op(float ? 0x2a : 0x28, 2), uleb(offset));
const save = (offset: number, float = false) => concat(op(float ? 0x38 : 0x36, 2), uleb(offset));
const stack = (index: number, bytes: number) => concat(op(0x23, 0), i(bytes), op(0x6b), s(index), l(index), op(0x24, 0));
const unstack = (index: number, bytes: number) => concat(l(index), i(bytes), op(0x6a, 0x24, 0));

export function appendNativeMapGraphics(input: Uint8Array): Uint8Array {
  const evidence = wasmEvidence(input);
  if (!evidence) throw new Error("invalid native map graphics input");
  const module = evidence.moduleView();
  if (CHECKED.some(([index, hash]) => functionBodySha256(module, index) !== hash)) return input;
  const sections = splitSections(input);
  const globals = vectorPayload(sectionById(sections, 6));
  const exported = parseExports(sectionById(sections, 7));
  const exportVector = vectorPayload(sectionById(sections, 7));
  const signatures = vectorPayload(sectionById(sections, 1));
  const types = parseIndexVector(sectionById(sections, 3));
  const bodies = parseCode(sectionById(sections, 10));
  const epoch = exported.find((entry) => entry.name === "gwonmac_cartography_context_area_epoch")?.index;
  const status = exported.find((entry) => entry.name === "gwonmac_cartography_context_status")?.index;
  if (epoch === undefined || status === undefined) return input;
  const extraBodies: Uint8Array[] = []; const extraExports: Uint8Array[] = [];
  const scalarNames = ["owner", "buffer", "draw", "area", "serial", "uploads", "draws", "created", "destroyed", "continent"];
  const first = module.functionImportCount + bodies.length;
  for (const [surfaceIndex, surface] of NATIVE_MAP_GRAPHICS_SURFACES.entries()) {
    const base = globals.count + surfaceIndex * scalarNames.length;
    const isWorld = surface.startsWith("world");
    const isHover = surface.endsWith("_hover");
    const g = (index: number) => concat(op(0x23), uleb(base + index));
    const put = (index: number) => concat(op(0x24), uleb(base + index));
    const increment = (index: number) => concat(g(index), i(1), op(0x6a), put(index));
    const hideIndex = first + extraBodies.length; const destroyIndex = hideIndex + 1;
    const renderIndex = hideIndex + 2; const publishIndex = hideIndex + 3;
    const hide = concat(op(0), i(0), put(3), i(0), put(4), op(0x0b));
    const destroy = concat(op(0), l(0), g(0), op(0x46, 0x04, 0x40), call(hideIndex),
      g(2), op(0x04, 0x40), g(2), call(748), g(1), call(748), increment(8), op(0x0b),
      ...[0, 1, 2].map((index) => concat(i(0), put(index))), op(0x0b, 0x0b));
    // The draw event provides trusted ownership. Native matrices 0/1 already
    // project world-map units; only our model matrix is identity, then restored.
    const render = concat(op(1, 1, 0x7f),
      l(0), g(0), op(0x47, 0x04, 0x40), g(0), call(destroyIndex), l(0), put(0), op(0x0b),
      ...(isWorld ? [l(0), load(4), g(9), op(0x47, 0x04, 0x40), call(hideIndex), op(0x0b), l(0), load(4), put(9)] : []),
      g(3), i(0), op(0x4a), g(3), op(0x23), uleb(epoch), op(0x46, 0x71),
      op(0x23), uleb(status), i(1), op(0x46, 0x71), g(2), i(0), op(0x47, 0x71),
      op(0x45, 0x04, 0x40), call(hideIndex), op(0x0f, 0x0b),
      stack(1, 80), l(1), i(2), call(1333), i(52), call(264),
      i(2), call(1357), g(2), i(0), call(1579),
      l(1), g(2), save(64), i(1), l(1), i(64), op(0x6a), call(1564),
      i(0), i(1), l(1), i(64), op(0x6a), i(0), call(2956),
      i(2), l(1), call(1334), increment(6), unstack(1, 80), op(0x0b));
    const memoryEnd = (bytes: Uint8Array) => concat(l(0), op(0xad), bytes, op(0xad, 0x7c),
      op(0x3f, 0, 0xad), op(0x42), sleb(65536), op(0x7e, 0x58));
    const finite = (offset: number) => concat(l(0), load(offset, true), op(0x8b), f(1000000), op(0x5f));
    const dimension = (local: number) => concat(l(local), i(64), op(0x4f), l(local), i(NATIVE_MAP_GRAPHICS_MAX_SIZE), op(0x4d, 0x71),
      l(local), l(local), i(1), op(0x6b, 0x71, 0x45, 0x71));
    // Native bitmap layers (14205) use alpha stage 7 / translucent order 11.
    // The Compass ring's additive stage 4 cannot darken the terrain outside.
    const publish = concat(op(1, 7, 0x7f), call(hideIndex),
      l(0), i(0), op(0x4b), l(0), i(3), op(0x71, 0x45, 0x71),
      l(1), i(NATIVE_MAP_GRAPHICS_HEADER_BYTES), op(0x4f, 0x71), memoryEnd(i(NATIVE_MAP_GRAPHICS_HEADER_BYTES)), op(0x71),
      op(0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b),
      l(0), load(12), s(5), l(0), load(16), s(6), l(0), load(8), s(7),
      l(0), load(0), i(NATIVE_MAP_GRAPHICS_MAGIC), op(0x46), l(0), load(4), l(1), op(0x46, 0x71),
      dimension(5), op(0x71), dimension(6), op(0x71),
      l(1), l(5), l(6), op(0x6c), i(4), op(0x6c), i(NATIVE_MAP_GRAPHICS_HEADER_BYTES), op(0x6a, 0x46, 0x71),
      memoryEnd(l(1)), op(0x71), l(7), i(0), op(0x4a, 0x71), l(7), op(0x23), uleb(epoch), op(0x46, 0x71),
      op(0x23), uleb(status), i(1), op(0x46, 0x71), g(0), i(0), op(0x47, 0x71),
      l(0), load(20), i(0), op(0x4a, 0x71),
      ...(isWorld ? [l(0), load(24), g(9), op(0x46, 0x71)] : []),
      ...Array.from({length: 8}, (_, index) => concat(finite(32 + index * 4), op(0x71))),
      op(0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b), stack(4, 64),
      l(4), l(0), i(NATIVE_MAP_GRAPHICS_HEADER_BYTES), op(0x6a), save(0),
      l(4), l(5), save(8), l(4), l(6), save(12),
      l(4), i(0), l(4), i(8), op(0x6a), i(1), i(112), call(2249), s(2),
      l(4), l(2), save(16), l(4), i(7), save(20), l(4), i(482), save(24),
      i(1), l(4), i(16), op(0x6a), l(4), i(20), op(0x6a), l(4), i(24), op(0x6a), i(0), i(0), i(33555424), i(11), call(3137), s(3),
      g(2), op(0x45, 0x04, 0x40),
        i(265), i(0), call(1444), put(1), l(4), g(1), save(28), l(4), l(3), save(32),
        i(1), l(4), i(28), op(0x6a), l(4), i(32), op(0x6a), i(0), i(0), call(1554), put(2), increment(7),
      op(0x05), g(2), i(0), l(3), call(1569), op(0x0b),
      l(3), call(748), l(2), call(748),
      g(1), i(4), call(1446), s(8),
      ...Array.from({length: 4}, (_, vertex) => concat(
        l(8), l(0), load(32 + vertex * 8, true), save(vertex * 24, true),
        l(8), l(0), load(36 + vertex * 8, true), op(0x8c), save(vertex * 24 + 4, true),
        l(8), f(0), save(vertex * 24 + 8, true), l(8), i(-1), save(vertex * 24 + 12),
        l(8), f(vertex === 1 || vertex === 2 ? 1 : 0), save(vertex * 24 + 16, true),
        l(8), f(vertex >= 2 ? 1 : 0), save(vertex * 24 + 20, true))),
      g(1), i(6), call(1445), s(8),
      ...[0, 1, 2, 0, 2, 3].map((vertex, index) => concat(l(8), i(vertex), op(0x3b, 1), uleb(index * 2))),
      ...[36, 40, 44].map((offset) => concat(l(4), f(-1000000), save(offset, true))),
      ...[48, 52, 56].map((offset) => concat(l(4), f(1000000), save(offset, true))),
      g(1), l(4), i(36), op(0x6a), l(4), i(48), op(0x6a), call(1449), g(1), call(1448),
      l(7), put(3), l(0), load(20), put(4), increment(5), unstack(4, 64), i(1), op(0x0b));
    extraBodies.push(hide, destroy, render, publish);
    const hooks = !isWorld
      ? [[16136, 939, concat(l(0), call(renderIndex))], [16125, 3, concat(l(0), call(destroyIndex))]] as const
      : [[16224, 830, concat(l(4), load(0), call(renderIndex))], [16170, 3, concat(l(0), call(destroyIndex))]] as const;
    for (const [index, originalOffset, bytes] of hooks) {
      let offset = originalOffset;
      if (isHover && (index === 16136 || index === 16224)) {
        const earlierRender = first + (isWorld ? 4 : 0) + 2;
        offset += (isWorld ? concat(l(4), load(0), call(earlierRender)) : concat(l(0), call(earlierRender))).length;
      }
      const local = index - module.functionImportCount; const body = bodies[local]!;
      bodies[local] = concat(body.slice(0, offset), bytes, body.slice(offset));
    }
    for (const [name, index] of [["hide", hideIndex], ["publish", publishIndex]] as const) {
      extraExports.push(concat(encodeName(`gwonmac_${surface}_graphics_${name}`), op(0), uleb(index)));
    }
    for (const index of [3, 4, 5, 6, 7, 8]) {
      extraExports.push(concat(encodeName(`gwonmac_${surface}_graphics_${scalarNames[index]}`), op(3), uleb(base + index)));
    }
  }
  const extraTypes = [op(0x60, 0, 0), op(0x60, 1, 0x7f, 0), op(0x60, 2, 0x7f, 0x7f, 1, 0x7f)];
  return concat(WASM_HEADER, ...sections.map((section) => encodeSection({id: section.id,
    body: section.id === 1 ? concat(uleb(signatures.count + extraTypes.length), signatures.entries, ...extraTypes)
      : section.id === 3 ? encodeIndexVector([...types, ...NATIVE_MAP_GRAPHICS_SURFACES.flatMap(() => [0, 1, 1, 2].map((type) => signatures.count + type))])
      : section.id === 6 ? concat(uleb(globals.count + scalarNames.length * NATIVE_MAP_GRAPHICS_SURFACES.length), globals.entries, ...Array.from({length: scalarNames.length * NATIVE_MAP_GRAPHICS_SURFACES.length}, () => concat(op(0x7f, 1), i(0), op(0x0b))))
      : section.id === 7 ? concat(uleb(exportVector.count + extraExports.length), exportVector.entries, ...extraExports)
      : section.id === 10 ? encodeCode([...bodies, ...extraBodies]) : section.body,
  })));
}
