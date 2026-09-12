/**
 * Gives the exact native Compass Canvas one retained terrain texture and mesh.
 * Native frame attachment, resource references and camera projection own drawing.
 */
import {
  concat, encodeCode, encodeIndexVector, encodeSection, parseCode, parseExports,
  parseIndexVector, sectionById, sleb, splitSections, uleb, vectorPayload, WASM_HEADER,
} from "../core/wasm-binary.js";
import { encodeName } from "./cartography-transform-internals.js";
import { functionBodySha256, wasmEvidence } from "./wasm-evidence.js";
import {
  NATIVE_COMPASS_CLIP_RADIUS, NATIVE_COMPASS_TERRAIN_HEADER_BYTES,
  NATIVE_COMPASS_TERRAIN_MAGIC, NATIVE_COMPASS_TERRAIN_MAX_SIZE,
  NATIVE_COMPASS_TERRAIN_WORLD_SPAN, NATIVE_COMPASS_WORLD_SCALE,
} from "../../shared/native-compass-terrain.js";

const CHECKED = [
  [14112, "40b8dfac2eb2e4c861e2daa4d3e775de33d15194c64765ddb53025bcb73fb74f"],
  [14116, "ee5ae8fd4eecae9bccac822d7ae7f3614286a2c395af6b348f6b2082c6c23aee"],
  [14126, "256397ed0536d44ea656323cddb51bc29fb2b87b6af98a5793ff8ee9292a7c6a"],
  [14137, "019d8124a7e7ebcc6691a5d7adc87cef503d3eca5789ab2c6667bce2afad495f"],
  [14132, "1f9a028cc7edb1245971483bce34905c5121b85b305a8b3eed34987ca9a8f966"],
  [14147, "b47aa2a9b0df83431a59ccf6754b9435af7f2f4b9e35be532930ce89323854ae"],
  [1444, "88b977ad123c93c1926a67efe32721398cafb0f86fa2b3f5a57f3bd1493fb842"],
  [1445, "a883926f470e716e59f62bec0b03adc8721112e78e859477bcab028de2ab311b"],
  [1446, "3cfe5e2ff85ca8c472ad41c7a3ce4db7eb66c4dcb86b6fdfc69530067fecb650"],
  [1448, "79c87cd0bab2c93f9718d557a7bd552ee2c37a70ec7f6d0f82224aa8c45e438d"],
  [1449, "3e750376bbc2a51393c0ba169355550ba48a1b7fdea3fff8e1d0b1b5be2d6581"],
  [1556, "25b4a1cbaf249c4dab4842fd7c90ef0e2f7d28a9184c81c1167ced06d1ee45ca"],
  [1522, "75b99afc7b3b9e6208aba50ea70618e84b3171a550788211e2587c551ab2f041"],
  [1565, "c7e2cc16116757011dfecf14eff0220469221cb200b109b650461eb5c750ceba"],
  [1530, "e890ea8a31e26749317404120c8d07354743fcd31a603921416875723683e783"],
  [1569, "46b25139552a8d66a0b519d735755346f9be5d37ab2d1e9b02bca1d79bee20fc"],
  [1532, "f77af25d4e59724cd0ed6103fb9fcbe92b035e09ee24456f00fafdc44bfc286a"],
  [1579, "c46a846084eb5292db3d41d901724d9e2330cf1bb9f7fb1dec371fa642e4cc48"],
  [3137, "3f4d7e18ad91c20147e2053ee1e42f8eb60c97937fefba142d37c93f2d672e36"],
  [2249, "149d95966e67f554da12f46c064ee366a9d531b167842e6ea0a201ca730b474e"],
  [2187, "fe75a199add4d8ffb71a03e694144b903e3e82a7c165558b7593a8e5f9495415"],
  [748, "150d8921520d98fbfa28dc4faf5e2fe488a65c69832b13d7dcf489b2f07d7b60"],
  [6827, "f8adede1f8a366bdce292461977643bb760e8e846bc30689312781dcab0630c7"],
] as const;
const SEGMENTS = 64;
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

export function appendNativeCompassTerrain(input: Uint8Array): Uint8Array {
  const evidence = wasmEvidence(input);
  if (!evidence) throw new Error("invalid native Compass terrain input");
  const module = evidence.moduleView();
  if (CHECKED.some(([index, hash]) => functionBodySha256(module, index) !== hash)) return input;
  return appendCompassSurface(appendCompassSurface(input, false), true);
}

/** Both Compass consumers share exact Canvas lifetime and bitmap ownership. */
function appendCompassSurface(input: Uint8Array, screenSpace: boolean): Uint8Array {
  const evidence = wasmEvidence(input);
  if (!evidence) throw new Error("invalid Compass surface input");
  const module = evidence.moduleView();
  const prefix = screenSpace ? "gwonmac_compass_ranges" : "gwonmac_compass_terrain";
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
  const base = globals.count;
  const g = (index: number) => concat(op(0x23), uleb(base + index));
  const put = (index: number) => concat(op(0x24), uleb(base + index));
  const first = module.functionImportCount + bodies.length;
  const hideIndex = first; const destroyIndex = first + 1; const initIndex = first + 2;
  const attachIndex = first + 3; const updateIndex = first + 4; const publishIndex = first + 5;
  const increment = (index: number) => concat(g(index), i(1), op(0x6a), put(index));
  const contextValid = () => concat(g(3), i(0), op(0x4a), g(3), op(0x23), uleb(epoch), op(0x46, 0x71), op(0x23), uleb(status), i(1), op(0x46, 0x71));
  const finite = (value: Uint8Array, limit: number) => concat(value, op(0x8b), f(limit), op(0x5f));
  const hide = concat(op(0), g(3), op(0x04, 0x40), i(0), put(3),
    g(1), op(0x04, 0x40), g(1), i(0), call(1445), op(0x1a), g(1), call(1448), op(0x0b, 0x0b, 0x0b));
  const destroy = concat(op(0), l(0), g(0), op(0x46), g(0), i(0), op(0x47, 0x71, 0x04, 0x40),
    call(hideIndex), g(2), call(748), g(1), call(748),
    ...[0, 1, 2, 3, 4, 9].map((index) => concat(i(0), put(index))), increment(8), op(0x0b, 0x0b));
  // Clone only this Canvas's retained draw object, then replace its one mesh.
  // The constructor hook runs after the native transform has been established.
  const init = concat(op(0), g(0), call(destroyIndex), l(0), put(0),
    i(265), i(0), call(1444), put(1), l(0), load(144), call(1556), put(2),
    g(2), i(0), g(1), call(1565), g(2), i(0), call(1579), increment(7), op(0x0b));
  const attach = concat(op(1, 1, 0x7f),
    l(0), g(0), op(0x46), g(2), i(0), op(0x47, 0x71, 0x04, 0x40), stack(2, 16),
    l(2), g(2), save(0), l(1), i(1), l(2), i(4), call(6827), unstack(2, 16), op(0x0b, 0x0b));

  const vertexStores: Uint8Array[] = [];
  const points: Readonly<{ x: number; y: number; edge: boolean }>[] = [{x: 0, y: 0, edge: false}];
  for (const edge of [false, true]) for (let n = 0; n < SEGMENTS; n += 1) {
    const angle = n * 2 * Math.PI / SEGMENTS;
    points.push({x: Math.cos(angle), y: Math.sin(angle), edge});
  }
  points.forEach((point, vertex) => {
    const offset = vertex * 24;
    const radius = (dimension: number) => point.edge || vertex === 0 ? f(NATIVE_COMPASS_CLIP_RADIUS)
      : concat(f(NATIVE_COMPASS_CLIP_RADIUS), f(1), l(dimension), op(0x95, 0x93));
    vertexStores.push(
      f(0.5), f(point.x), radius(6), op(0x94, 0x92), s(12),
      f(0.5), f(point.y), radius(7), op(0x94, 0x92), s(13),
      // Invert the Canvas's rotation for texture coordinates. The frame itself
      // applies the retained transform, so geometry remains Canvas-local.
      l(9), l(12), f(0.5), op(0x93, 0x94), l(8), l(13), f(0.5), op(0x93, 0x94, 0x92), f(NATIVE_COMPASS_WORLD_SCALE), op(0x95), s(14),
      l(9), l(13), f(0.5), op(0x93, 0x94), l(8), l(12), f(0.5), op(0x93, 0x94, 0x93), f(NATIVE_COMPASS_WORLD_SCALE), op(0x95), s(15),
      l(4), l(6), l(12), op(0x94), save(offset, true),
      l(4), l(7), l(13), op(0x94), save(offset + 4, true),
      l(4), f(0), save(offset + 8, true),
      l(4), i(point.edge ? 0x00ffffff : -1), save(offset + 12),
      l(4), ...(screenSpace ? [l(12)] : [l(10), l(14), op(0x92), g(10), op(0x93), g(12), op(0x95)]), save(offset + 16, true),
      l(4), ...(screenSpace ? [l(13)] : [g(11), l(11), l(15), op(0x92, 0x93), g(12), op(0x95)]), save(offset + 20, true));
  });
  const indexStores: Uint8Array[] = [];
  for (let n = 0; n < SEGMENTS; n += 1) {
    const a = 1 + n; const b = 1 + (n + 1) % SEGMENTS;
    // Clockwise winding matches the native Canvas triangles.
    [0, b, a, a, b, a + SEGMENTS, a + SEGMENTS, b, b + SEGMENTS].forEach((vertex, at) => {
      indexStores.push(concat(l(5), i(vertex), op(0x3b, 1), uleb((n * 9 + at) * 2)));
    });
  }
  const update = concat(op(2, 3, 0x7f, 10, 0x7d),
    l(0), g(0), op(0x47, 0x04, 0x40, 0x0f, 0x0b),
    l(0), load(180, true), l(0), load(172, true), op(0x93), s(6),
    l(0), load(184, true), l(0), load(176, true), op(0x93), s(7),
    l(2), load(0, true), s(8), l(2), load(4, true), s(9),
    l(1), load(0, true), s(10), l(1), load(4, true), s(11),
    // An unchanged native camera and rectangle need no buffer rewrite. The
    // serial invalidates UVs after a tile upload or indices after withdrawal.
    contextValid(), g(4), g(19), op(0x46, 0x71),
    l(6), g(15), op(0x5b, 0x71), l(7), g(16), op(0x5b, 0x71),
    ...(screenSpace ? [] : [l(10), g(13), op(0x5b, 0x71), l(11), g(14), op(0x5b, 0x71),
      l(8), g(17), op(0x5b, 0x71), l(9), g(18), op(0x5b, 0x71)]),
    op(0x04, 0x40, 0x0f, 0x0b),
    l(8), put(17), l(9), put(18),
    l(10), put(13), l(11), put(14), l(6), put(15), l(7), put(16),
    contextValid(), finite(l(6), 16384), op(0x71), l(6), f(2), op(0x5e, 0x71),
    finite(l(7), 16384), op(0x71), l(7), f(2), op(0x5e, 0x71),
    finite(l(10), 1000000), op(0x71), finite(l(11), 1000000), op(0x71),
    l(8), l(8), op(0x94), l(9), l(9), op(0x94, 0x92), f(1), op(0x93, 0x8b), f(0.02), op(0x5f, 0x71),
    ...(screenSpace ? [] : [
    l(10), g(10), f(4500), op(0x92, 0x60, 0x71), l(10), g(10), g(12), op(0x92), f(4500), op(0x93, 0x5f, 0x71),
    l(11), g(11), f(4500), op(0x93, 0x5f, 0x71), l(11), g(11), g(12), op(0x93), f(4500), op(0x92, 0x60, 0x71),
    ]),
    op(0x45, 0x04, 0x40), call(hideIndex), op(0x0f, 0x0b),
    stack(3, 32), g(1), i(points.length), call(1446), s(4), g(1), i(SEGMENTS * 9), call(1445), s(5),
    ...vertexStores, ...indexStores,
    ...[0, 4, 8].map((offset) => concat(l(3), f(0), save(offset, true))),
    ...[12, 16, 20].map((offset) => concat(l(3), l(6), l(7), op(0x97), save(offset, true))),
    g(1), l(3), l(3), i(12), op(0x6a), call(1449), g(1), call(1448),
    g(4), put(19), increment(5), unstack(3, 32), op(0x0b));

  // A copied bitmap is the only write capability. Validate its complete region
  // before reading pixels; GrTex copies the input with flags & 1 == 0.
  const memoryEnd = (bytes: Uint8Array) => concat(l(0), op(0xad), bytes, op(0xad, 0x7c), op(0x3f, 0, 0xad), op(0x42), sleb(65536), op(0x7e, 0x58));
  const publish = concat(op(1, 5, 0x7f), call(hideIndex),
    l(0), i(0), op(0x4b), l(0), i(3), op(0x71, 0x45, 0x71),
    l(1), i(NATIVE_COMPASS_TERRAIN_HEADER_BYTES), op(0x4f, 0x71), memoryEnd(i(NATIVE_COMPASS_TERRAIN_HEADER_BYTES)), op(0x71),
    op(0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b),
    l(0), load(12), s(5), l(0), load(8), s(6),
    l(0), load(0), i(NATIVE_COMPASS_TERRAIN_MAGIC), op(0x46), l(0), load(4), l(1), op(0x46, 0x71),
    l(5), i(64), op(0x4f, 0x71), l(5), i(NATIVE_COMPASS_TERRAIN_MAX_SIZE), op(0x4d, 0x71),
    l(5), l(5), i(1), op(0x6b, 0x71, 0x45, 0x71),
    l(1), l(5), l(5), op(0x6c), i(4), op(0x6c), i(NATIVE_COMPASS_TERRAIN_HEADER_BYTES), op(0x6a, 0x46, 0x71),
    memoryEnd(l(1)), op(0x71), l(6), i(0), op(0x4a, 0x71), l(6), op(0x23), uleb(epoch), op(0x46, 0x71),
    op(0x23), uleb(status), i(1), op(0x46, 0x71), g(2), i(0), op(0x47, 0x71),
    finite(concat(l(0), load(16, true)), 1000000), op(0x71), finite(concat(l(0), load(20, true)), 1000000), op(0x71),
    l(0), load(24, true), f(NATIVE_COMPASS_TERRAIN_WORLD_SPAN), op(0x5b, 0x71),
    l(0), load(28), i(0), op(0x4a, 0x71),
    op(0x45, 0x04, 0x40), i(0), op(0x0f, 0x0b), stack(4, 32),
    l(4), l(0), i(NATIVE_COMPASS_TERRAIN_HEADER_BYTES), op(0x6a), save(0),
    l(4), l(5), save(8), l(4), l(5), save(12),
    l(4), i(0), l(4), i(8), op(0x6a), i(1), i(112), call(2249), s(2),
    l(4), l(2), save(16), l(4), i(screenSpace ? 4 : 7), save(20), l(4), i(482), save(24),
    i(1), l(4), i(16), op(0x6a), l(4), i(20), op(0x6a), l(4), i(24), op(0x6a), i(0), i(0), i(33555424), i(screenSpace ? 4 : 11), call(3137), s(3),
    g(2), i(0), l(3), call(1569), l(3), call(748), l(2), call(748),
    l(0), load(16, true), put(10), l(0), load(20, true), put(11), l(0), load(24, true), put(12),
    l(5), put(9), l(0), load(28), put(4), l(6), put(3), increment(6), unstack(4, 32), i(1), op(0x0b));

  for (const [index, offset, bytes] of [
    [14112, 530, concat(l(0), call(initIndex))],
    [14116, 3, concat(l(0), call(destroyIndex))],
    [14126, 3, concat(l(0), l(1), call(attachIndex))],
    [14137, 17, concat(l(0), l(1), l(2), call(updateIndex))],
  ] as const) {
    const local = index - module.functionImportCount; const body = bodies[local]!;
    let insertion = offset;
    if (screenSpace && index === 14126) {
      const terrainPublish = exported.find((entry) => entry.name === "gwonmac_compass_terrain_publish")?.index;
      if (terrainPublish === undefined) throw new Error("missing native terrain attachment");
      const earlier = concat(l(0), l(1), call(terrainPublish - 2));
      if (!earlier.every((byte, at) => body[offset + at] === byte)) throw new Error("native Compass attachment changed");
      insertion += earlier.length;
    }
    bodies[local] = concat(body.slice(0, insertion), bytes, body.slice(insertion));
  }
  const extraTypes = [
    op(0x60, 0, 0), op(0x60, 1, 0x7f, 0), op(0x60, 2, 0x7f, 0x7f, 0),
    op(0x60, 3, 0x7f, 0x7f, 0x7f, 0), op(0x60, 2, 0x7f, 0x7f, 1, 0x7f),
  ];
  bodies.push(hide, destroy, init, attach, update, publish);
  const globalTypes = [...Array.from({length: 10}, () => 0x7f), ...Array.from({length: 9}, () => 0x7d), 0x7f];
  const scalarExports = [["area", 3], ["serial", 4], ["updates", 5], ["uploads", 6], ["created", 7], ["destroyed", 8], ["size", 9], ["camera_x", 13], ["camera_y", 14], ["width", 15], ["height", 16]] as const;
  return concat(WASM_HEADER, ...sections.map((section) => encodeSection({id: section.id,
    body: section.id === 1 ? concat(uleb(signatures.count + extraTypes.length), signatures.entries, ...extraTypes)
      : section.id === 3 ? encodeIndexVector([...types, ...[0, 1, 1, 2, 3, 4].map((type) => signatures.count + type)])
      : section.id === 6 ? concat(uleb(base + globalTypes.length), globals.entries, ...globalTypes.map((type) => concat(op(type, 1), type === 0x7f ? i(0) : f(0), op(0x0b))))
      : section.id === 7 ? concat(uleb(exportVector.count + scalarExports.length + 2), exportVector.entries,
        encodeName(`${prefix}_publish`), op(0), uleb(publishIndex),
        encodeName(`${prefix}_hide`), op(0), uleb(hideIndex),
        ...scalarExports.map(([name, index]) => concat(encodeName(`${prefix}_${name}`), op(3), uleb(base + index))))
      : section.id === 10 ? encodeCode(bodies) : section.body,
  })));
}
