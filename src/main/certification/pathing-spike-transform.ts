/**
 * Development-only Compass and Cartography client transform.
 *
 * The exact loader-to-converter call is routed through an appended wrapper.
 * Guild Wars performs the complete conversion first; only after success does
 * an appended sampler read the already-validated live PathingMap and retain a
 * fixed scalar sample in exported globals. No address is exported, no game
 * memory is reserved, and every existing function index remains unchanged.
 */
import { createHash } from "node:crypto";
import {
  PATHING_SPIKE_GLOBALS,
  COMPASS_FRAME_SPIKE_GLOBALS,
  COMPASS_FRAME_SPIKE_SCALARS,
  MISSION_MAP_FRAME_SPIKE_GLOBALS,
  MISSION_MAP_FRAME_SPIKE_SCALARS,
  MISSION_MAP_PROJECTION_SPIKE_SCALARS,
} from "../../shared/cartography-spike.js";
import {
  concat,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  paddedIndex,
  parseCode,
  parseExports,
  parseIndexVector,
  parseTypes,
  readSleb,
  readUleb,
  sectionById,
  sleb,
  splitSections,
  uleb,
  vectorPayload,
  WASM_HEADER,
  type FunctionType,
  type Section,
} from "../core/wasm-binary.js";
import { functionBodySha256, wasmEvidence } from "./wasm-evidence.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
  Module: new (bytes: Uint8Array) => object;
};

const CERTIFICATE = Object.freeze({
  loader: 3208,
  loaderBodySha256: "ff5dcae4a3610a874609316758affe178eaf5ae698a0826c55dc96229796c1fd",
  converter: 3216,
  converterBodySha256: "fca90c6024da65a96f19461a85ece6547528cd10841a77a35f8719c13858ab66",
  callSiteOffset: 0x1b9,
  pathMapHolder: 0x00,
  trapezoidCount: 0x14,
  trapezoidPointer: 0x18,
  trapezoidStride: 0x30,
  coordinateOffsets: Object.freeze([0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c]),
});

const FRAME_LAYOUT = Object.freeze({
  frameArray: 0x5a3b1c,
  frameCount: 0x5a3b24,
  frameBytes: 0x1c8,
  frameId: 0xbc,
  frameHashId: 0x134,
  frameViewportWidth: 0x104,
  frameViewportHeight: 0x108,
  frameScreenLeft: 0x10c,
  frameScreenBottom: 0x110,
  frameScreenRight: 0x114,
  frameScreenTop: 0x118,
  frameState: 0x18c,
});

const COMPASS_CERTIFICATE = Object.freeze({
  ...FRAME_LAYOUT,
  labelHash: 3_268_554_015,
  renderFunction: 14240,
  renderBodySha256: "664c05367ef418fea33931d32dd7d6ff8b8469654453b0bb27cb7163c13e5492",
  mapRenderFunction: 14179,
  mapRenderBodySha256: "da8f05375c3989058277fe14200d57a9654bafdb1562cf215bff9b6130d2c678",
  mapRenderCallSiteOffset: 608,
  directionX: 0x00,
  directionY: 0x04,
});

const MISSION_MAP_CERTIFICATE = Object.freeze({
  ...FRAME_LAYOUT,
  labelHash: 3_378_147_614,
  eventDispatcherFunction: 16_136,
  eventDispatcherBodySha256: "34712a34dc14537a423cedb253e07f1ed042edc3a989937bf51d47ca5e69e08f",
  eventDispatcherTableSlot: 4_006,
  gameplayContextFunction: 13_562,
  gameplayContextBodySha256: "5628a0e15b94db0630b83ddf26824361a8f0a16f2015dffb58bf816da4cf959a",
  zoom: 0x4c,
  drawableWidth: 0x00,
  drawableHeight: 0x04,
  playerMapX: 0x04,
  playerMapY: 0x08,
  nativeMapWidth: 0x10,
  nativeMapHeight: 0x14,
  ownerWindow: 0x08,
  ownerMap: 0x00,
  missionMapState: 0x3c,
  panX: 0x1c,
  panY: 0x20,
});

const MAX_TRAPEZOIDS_PER_MAP = 65_536;
const MAX_TOTAL_TRAPEZOIDS = 65_536;
const MAX_CAPTURED_PATH_MAPS = 64;
export const CARTOGRAPHY_SPIKE_TRANSFORM_ABI = 15;
export { PATHING_SPIKE_GLOBALS } from "../../shared/cartography-spike.js";

function fail(message: string): never {
  throw new Error(`pathing spike transform: ${message}`);
}

function encodeTypes(types: readonly FunctionType[]): Uint8Array {
  return concat(
    uleb(types.length),
    ...types.map((type) => concat(
      Uint8Array.of(0x60),
      uleb(type.params.length),
      Uint8Array.from(type.params),
      uleb(type.results.length),
      Uint8Array.from(type.results),
    )),
  );
}

function encodeName(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(uleb(bytes.length), bytes);
}

function call(functionIndex: number): Uint8Array {
  return concat(Uint8Array.of(0x10), uleb(functionIndex));
}

function local(index: number): Uint8Array {
  return concat(Uint8Array.of(0x20), uleb(index));
}

function globalGet(index: number): Uint8Array {
  return concat(Uint8Array.of(0x23), uleb(index));
}

function globalSet(index: number): Uint8Array {
  return concat(Uint8Array.of(0x24), uleb(index));
}

function i32(value: number): Uint8Array {
  return concat(Uint8Array.of(0x41), sleb(value));
}

type SamplerGlobals = Readonly<{
  status: number;
  sequence: number;
  callCount: number;
  totalTrapezoids: number;
  sampledMapTrapezoids: number;
  sampledMapZplane: number;
  generation: number;
  sampledMapPointer: number;
  mapPointers: readonly number[];
  mapCounts: readonly number[];
  samples: readonly (readonly number[])[];
}>;

type FrameGlobals = Readonly<{
  status: number;
  generation: number;
  frameId: number;
  visible: number;
  viewportWidth: number;
  viewportHeight: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
}>;

type CompassGlobals = FrameGlobals & Readonly<{
  cameraSequence: number;
  compassDirectionX: number;
  compassDirectionY: number;
}>;

type MissionMapProjectionGlobals = Readonly<{
  status: number;
  sequence: number;
  generation: number;
  zoom: number;
  panX: number;
  panY: number;
  drawableWidth: number;
  drawableHeight: number;
  playerMapX: number;
  playerMapY: number;
  nativeMapWidth: number;
  nativeMapHeight: number;
}>;

type FrameCertificate = typeof FRAME_LAYOUT & Readonly<{ labelHash: number }>;

function i32Load(offset = 0): Uint8Array {
  return concat(Uint8Array.of(0x28, 0x02), uleb(offset));
}

function f32Load(offset: number): Uint8Array {
  return concat(Uint8Array.of(0x2a, 0x02), uleb(offset));
}

function f32(value: number): Uint8Array {
  const bytes = new Uint8Array(5);
  bytes[0] = 0x43;
  new DataView(bytes.buffer).setFloat32(1, value, true);
  return bytes;
}

function rewriteExactTableSlot(
  bytes: Uint8Array,
  slot: number,
  expectedFunction: number,
  replacementFunction: number,
): Uint8Array {
  const cursor = { offset: 0 };
  const segmentCount = readUleb(bytes, cursor);
  const segments: Array<Readonly<{ base: number; functions: number[] }>> = [];
  let replacements = 0;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    if (readUleb(bytes, cursor) !== 0 || bytes[cursor.offset++] !== 0x41) {
      fail("unsupported Mission Map element segment");
    }
    const base = readSleb(bytes, cursor);
    if (base < 0 || bytes[cursor.offset++] !== 0x0b) {
      fail("malformed Mission Map element offset");
    }
    const entries = readUleb(bytes, cursor);
    const functions: number[] = [];
    for (let index = 0; index < entries; index += 1) {
      const currentFunction = readUleb(bytes, cursor);
      if (base + index === slot) {
        if (currentFunction !== expectedFunction) fail("Mission Map table slot changed");
        functions.push(replacementFunction);
        replacements += 1;
      } else {
        functions.push(currentFunction);
      }
    }
    segments.push({ base, functions });
  }
  if (cursor.offset !== bytes.byteLength || replacements !== 1) {
    fail("Mission Map table slot is not unique");
  }
  return concat(
    uleb(segments.length),
    ...segments.map(({ base, functions }) => concat(
      uleb(0), Uint8Array.of(0x41), sleb(base), Uint8Array.of(0x0b),
      uleb(functions.length), ...functions.map(uleb),
    )),
  );
}

/** Resolve exactly one certified native frame and publish only scalar fields. */
function nativeFrameObserver(
  certificate: FrameCertificate,
  globals: FrameGlobals,
  pathingGeneration: number,
  readyGuardGlobal?: number,
): Uint8Array {
  const refuse = (status: number) => concat(
    i32(status), globalSet(globals.status), Uint8Array.of(0x0f),
  );
  const outsideMemory = (pointerLocal: number, bytes: Uint8Array) => concat(
    local(6), Uint8Array.of(0x45, 0x45),
    local(pointerLocal), local(6), bytes, Uint8Array.of(0x6b, 0x4b, 0x71),
  );
  return concat(
    // count, array, index, frame/state, matches, matched frame, memory bytes.
    Uint8Array.of(0x01, 0x07, 0x7f),
    Uint8Array.of(0x3f, 0x00), i32(65_536), Uint8Array.of(0x6c, 0x21), uleb(6),
    i32(certificate.frameCount), i32Load(), Uint8Array.of(0x22), uleb(0),
    // While status is not ready, frameId carries only the bounded diagnostic count.
    local(0), globalSet(globals.frameId),
    Uint8Array.of(0x45, 0x04, 0x40), refuse(2), Uint8Array.of(0x0b),
    local(0), i32(16_384), Uint8Array.of(0x4b, 0x04, 0x40), refuse(3), Uint8Array.of(0x0b),
    i32(certificate.frameArray), i32Load(), Uint8Array.of(0x22), uleb(1),
    Uint8Array.of(0x45, 0x04, 0x40), refuse(4), Uint8Array.of(0x0b),
    outsideMemory(1, concat(local(0), i32(4), Uint8Array.of(0x6c))),
    Uint8Array.of(0x04, 0x40), refuse(5), Uint8Array.of(0x0b),
    i32(0), Uint8Array.of(0x21), uleb(2),
    i32(0), Uint8Array.of(0x21), uleb(4),
    i32(0), Uint8Array.of(0x21), uleb(5),
    Uint8Array.of(0x02, 0x40, 0x03, 0x40),
      local(2), local(0), Uint8Array.of(0x4f, 0x0d), uleb(1),
      local(1), local(2), i32(4), Uint8Array.of(0x6c, 0x6a), i32Load(),
      Uint8Array.of(0x22), uleb(3), Uint8Array.of(0x04, 0x40),
        outsideMemory(3, i32(certificate.frameBytes)),
        Uint8Array.of(0x45, 0x04, 0x40),
          local(3), i32Load(certificate.frameId), local(2), Uint8Array.of(0x46, 0x04, 0x40),
            local(3), i32Load(certificate.frameHashId),
            i32(certificate.labelHash), Uint8Array.of(0x46, 0x04, 0x40),
              local(4), i32(1), Uint8Array.of(0x6a, 0x21), uleb(4),
              local(3), Uint8Array.of(0x21), uleb(5),
            Uint8Array.of(0x0b),
          Uint8Array.of(0x0b),
        Uint8Array.of(0x0b),
      Uint8Array.of(0x0b),
      local(2), i32(1), Uint8Array.of(0x6a, 0x21), uleb(2),
      Uint8Array.of(0x0c), uleb(0),
    Uint8Array.of(0x0b, 0x0b),
    local(4), i32(1), Uint8Array.of(0x47, 0x04, 0x40), refuse(6), Uint8Array.of(0x0b),
    local(5), Uint8Array.of(0x45, 0x04, 0x40), refuse(6), Uint8Array.of(0x0b),
    local(5), i32Load(certificate.frameId), globalSet(globals.frameId),
    local(5), i32Load(certificate.frameState), Uint8Array.of(0x22), uleb(3),
    i32(4), Uint8Array.of(0x71, 0x45, 0x45),
    local(3), i32(0x200), Uint8Array.of(0x71, 0x45, 0x71), globalSet(globals.visible),
    local(5), f32Load(certificate.frameViewportWidth), globalSet(globals.viewportWidth),
    local(5), f32Load(certificate.frameViewportHeight), globalSet(globals.viewportHeight),
    local(5), f32Load(certificate.frameScreenLeft), globalSet(globals.left),
    local(5), f32Load(certificate.frameScreenBottom), globalSet(globals.bottom),
    local(5), f32Load(certificate.frameScreenRight), globalSet(globals.right),
    local(5), f32Load(certificate.frameScreenTop), globalSet(globals.top),
    ...(readyGuardGlobal === undefined ? [] : [
      globalGet(readyGuardGlobal), Uint8Array.of(0x45, 0x04, 0x40),
      refuse(7), Uint8Array.of(0x0b),
    ]),
    globalGet(pathingGeneration), globalSet(globals.generation),
    i32(1), globalSet(globals.status),
    Uint8Array.of(0x0b),
  );
}

function sampler(globals: SamplerGlobals): Uint8Array {
  const sampleWrites = globals.samples.flatMap((coordinates, trapezoid) => {
    const recordOffset = trapezoid * CERTIFICATE.trapezoidStride;
    return [
      local(4), i32(recordOffset), Uint8Array.of(0x6a),
      ...coordinates.flatMap((target, coordinate) => [
        Uint8Array.of(0x22), uleb(3),
        Uint8Array.of(0x2a, 0x02), uleb(CERTIFICATE.coordinateOffsets[coordinate]!),
        globalSet(target),
        local(3),
      ]),
      Uint8Array.of(0x1a),
    ];
  });
  return concat(
    Uint8Array.of(0x01, 0x04, 0x7f),
    globalGet(globals.status), i32(2), Uint8Array.of(0x4f, 0x04, 0x40, 0x0f, 0x0b),
    local(0), Uint8Array.of(0x28, 0x02), uleb(CERTIFICATE.pathMapHolder),
    Uint8Array.of(0x22), uleb(1), Uint8Array.of(0x45, 0x04, 0x40),
    i32(2), globalSet(globals.status), Uint8Array.of(0x0f, 0x0b),
    local(1), Uint8Array.of(0x28, 0x02), uleb(CERTIFICATE.trapezoidCount),
    Uint8Array.of(0x22), uleb(2),
    i32(MAX_TRAPEZOIDS_PER_MAP), Uint8Array.of(0x4b, 0x04, 0x40),
    i32(3), globalSet(globals.status), Uint8Array.of(0x0f, 0x0b),
    globalGet(globals.callCount), i32(MAX_CAPTURED_PATH_MAPS), Uint8Array.of(0x4f, 0x04, 0x40),
    i32(7), globalSet(globals.status), Uint8Array.of(0x0f, 0x0b),
    local(1), i32Load(CERTIFICATE.trapezoidPointer), Uint8Array.of(0x21), uleb(4),
    local(2), Uint8Array.of(0x45, 0x45), local(4), Uint8Array.of(0x45, 0x71, 0x04, 0x40),
    i32(4), globalSet(globals.status), Uint8Array.of(0x0f, 0x0b),
    ...globals.mapPointers.flatMap((pointer, index) => [
      globalGet(globals.callCount), i32(index), Uint8Array.of(0x46, 0x04, 0x40),
      local(4), globalSet(pointer), local(2), globalSet(globals.mapCounts[index]!),
      Uint8Array.of(0x0b),
    ]),
    globalGet(globals.callCount), i32(1), Uint8Array.of(0x6a),
    globalSet(globals.callCount),
    globalGet(globals.totalTrapezoids), local(2), Uint8Array.of(0x6a),
    Uint8Array.of(0x22), uleb(3), i32(MAX_TOTAL_TRAPEZOIDS), Uint8Array.of(0x4b, 0x04, 0x40),
    i32(6), globalSet(globals.status), i32(0), globalSet(globals.sampledMapPointer),
    i32(0), globalSet(globals.sampledMapTrapezoids), Uint8Array.of(0x0f, 0x0b),
    local(3), globalSet(globals.totalTrapezoids),
    // The ground plane is authoritative. Before it arrives, retain the
    // largest plane only as a bounded diagnostic fallback.
    local(1), i32Load(), i32(-1), Uint8Array.of(0x46),
    globalGet(globals.sampledMapZplane), i32(-1), Uint8Array.of(0x47),
    local(2), globalGet(globals.sampledMapTrapezoids), Uint8Array.of(0x4b, 0x71, 0x72),
    Uint8Array.of(0x04, 0x40),
    local(2), globalSet(globals.sampledMapTrapezoids),
    local(1), i32Load(), globalSet(globals.sampledMapZplane),
    local(4), globalSet(globals.sampledMapPointer),
    ...sampleWrites,
    Uint8Array.of(0x0b),
    globalGet(globals.sequence), i32(1), Uint8Array.of(0x6a),
    globalSet(globals.sequence),
    i32(1), globalSet(globals.status),
    Uint8Array.of(0x0b),
  );
}

function reset(globals: SamplerGlobals): Uint8Array {
  return concat(
    Uint8Array.of(0x00),
    globalGet(globals.generation), i32(1), Uint8Array.of(0x6a), globalSet(globals.generation),
    ...[
      globals.status, globals.sequence, globals.callCount,
      globals.totalTrapezoids, globals.sampledMapTrapezoids,
      globals.sampledMapZplane, globals.sampledMapPointer,
      ...globals.mapPointers, ...globals.mapCounts,
    ].flatMap((target) => [i32(0), globalSet(target)]),
    Uint8Array.of(0x0b),
  );
}

function readCoordinate(globals: SamplerGlobals): Uint8Array {
  const nan = Uint8Array.of(0x43, 0x00, 0x00, 0xc0, 0x7f);
  const refuse = concat(nan, Uint8Array.of(0x0f));
  return concat(
    Uint8Array.of(0x01, 0x02, 0x7f),
    globalGet(globals.status), i32(1), Uint8Array.of(0x47, 0x04, 0x40), refuse, Uint8Array.of(0x0b),
    local(0), globalGet(globals.totalTrapezoids), i32(6), Uint8Array.of(0x6c, 0x4f, 0x04, 0x40),
    refuse, Uint8Array.of(0x0b),
    local(0), i32(6), Uint8Array.of(0x6e), Uint8Array.of(0x21), uleb(1),
    ...globals.mapPointers.flatMap((pointer, index) => [
      local(1), globalGet(globals.mapCounts[index]!), Uint8Array.of(0x49, 0x04, 0x40),
      globalGet(pointer), Uint8Array.of(0x45, 0x04, 0x40), refuse, Uint8Array.of(0x0b),
      globalGet(pointer), local(1), i32(CERTIFICATE.trapezoidStride), Uint8Array.of(0x6c, 0x6a),
      i32(CERTIFICATE.coordinateOffsets[0]!), Uint8Array.of(0x6a),
      local(0), i32(6), Uint8Array.of(0x70), i32(4), Uint8Array.of(0x6c, 0x6a),
      Uint8Array.of(0x2a, 0x02, 0x00, 0x0f, 0x0b),
      local(1), globalGet(globals.mapCounts[index]!), Uint8Array.of(0x6b, 0x21), uleb(1),
    ]),
    refuse, Uint8Array.of(0x0b),
  );
}

function wrapper(converter: number, samplerFunction: number): Uint8Array {
  return concat(
    Uint8Array.of(0x01, 0x01, 0x7f),
    local(0), local(1), local(2), local(3), call(converter),
    Uint8Array.of(0x22), uleb(4), Uint8Array.of(0x04, 0x40),
    local(0), call(samplerFunction),
    Uint8Array.of(0x0b), local(4), Uint8Array.of(0x0b),
  );
}

/** Retain the exact direction argument consumed by the native CompassMap. */
function compassMapRenderWrapper(render: number, globals: CompassGlobals): Uint8Array {
  return concat(
    Uint8Array.of(0x00),
    local(0), local(1), local(2), call(render),
    local(2), f32Load(COMPASS_CERTIFICATE.directionX), globalSet(globals.compassDirectionX),
    local(2), f32Load(COMPASS_CERTIFICATE.directionY), globalSet(globals.compassDirectionY),
    globalGet(globals.cameraSequence), i32(1), Uint8Array.of(0x6a),
    globalSet(globals.cameraSequence),
    Uint8Array.of(0x0b),
  );
}

/** Observe native Mission Map projection state after its exact event dispatcher runs. */
function missionMapEventWrapper(
  dispatcher: number,
  globals: MissionMapProjectionGlobals,
  pathingGeneration: number,
): Uint8Array {
  const refuse = (status: number) => concat(
    i32(status), globalSet(globals.status), Uint8Array.of(0x0f),
  );
  const requirePointer = (pointerLocal: number, bytes: number, status: number) => concat(
    local(pointerLocal), Uint8Array.of(0x45, 0x04, 0x40),
    refuse(status), Uint8Array.of(0x0b),
    local(pointerLocal), local(3), i32(bytes), Uint8Array.of(0x6b, 0x4b, 0x04, 0x40),
    refuse(status), Uint8Array.of(0x0b),
  );
  return concat(
    // locals 3..4 are pointers/memory size; 5..7 are zoom and pan.
    Uint8Array.of(0x02, 0x02, 0x7f, 0x03, 0x7d),
    local(0), local(1), local(2), call(dispatcher),
    Uint8Array.of(0x3f, 0x00), i32(65_536), Uint8Array.of(0x6c, 0x21), uleb(3),
    requirePointer(0, MISSION_MAP_CERTIFICATE.ownerWindow + 4, 2),
    local(0), i32Load(MISSION_MAP_CERTIFICATE.ownerWindow),
    Uint8Array.of(0x21), uleb(4),
    requirePointer(4, MISSION_MAP_CERTIFICATE.ownerMap + 4, 3),
    local(4), i32Load(MISSION_MAP_CERTIFICATE.ownerMap), Uint8Array.of(0x21), uleb(4),
    requirePointer(4, MISSION_MAP_CERTIFICATE.missionMapState + 4, 4),
    local(4), f32Load(MISSION_MAP_CERTIFICATE.drawableWidth),
    globalSet(globals.drawableWidth),
    local(4), f32Load(MISSION_MAP_CERTIFICATE.drawableHeight),
    globalSet(globals.drawableHeight),
    local(4), i32Load(MISSION_MAP_CERTIFICATE.missionMapState),
    Uint8Array.of(0x21), uleb(4),
    requirePointer(4, MISSION_MAP_CERTIFICATE.panY + 4, 5),
    local(4), f32Load(MISSION_MAP_CERTIFICATE.playerMapX),
    globalSet(globals.playerMapX),
    local(4), f32Load(MISSION_MAP_CERTIFICATE.playerMapY),
    globalSet(globals.playerMapY),
    local(4), f32Load(MISSION_MAP_CERTIFICATE.nativeMapWidth),
    globalSet(globals.nativeMapWidth),
    local(4), f32Load(MISSION_MAP_CERTIFICATE.nativeMapHeight),
    globalSet(globals.nativeMapHeight),
    call(MISSION_MAP_CERTIFICATE.gameplayContextFunction), Uint8Array.of(0x21), uleb(0),
    requirePointer(0, MISSION_MAP_CERTIFICATE.zoom + 4, 6),
    local(0), f32Load(MISSION_MAP_CERTIFICATE.zoom), Uint8Array.of(0x22), uleb(5),
    f32(1), Uint8Array.of(0x60),
    local(5), f32(3.5), Uint8Array.of(0x5f, 0x71, 0x45, 0x04, 0x40),
    refuse(7), Uint8Array.of(0x0b),
    local(4), f32Load(MISSION_MAP_CERTIFICATE.panX), Uint8Array.of(0x22), uleb(6),
    Uint8Array.of(0x8b), f32(10_000_000), Uint8Array.of(0x5f),
    local(4), f32Load(MISSION_MAP_CERTIFICATE.panY), Uint8Array.of(0x22), uleb(7),
    Uint8Array.of(0x8b), f32(10_000_000), Uint8Array.of(0x5f, 0x71, 0x45, 0x04, 0x40),
    refuse(8), Uint8Array.of(0x0b),
    local(5), globalSet(globals.zoom),
    local(6), globalSet(globals.panX),
    local(7), globalSet(globals.panY),
    globalGet(pathingGeneration), globalSet(globals.generation),
    globalGet(globals.sequence), i32(1), Uint8Array.of(0x6a), globalSet(globals.sequence),
    i32(1), globalSet(globals.status),
    Uint8Array.of(0x0b),
  );
}

/** Add the exact scalar sampler to the certified current client. */
export function transformCartographySpikeWasm(input: Uint8Array): Uint8Array {
  const evidence = wasmEvidence(input) ?? fail("invalid WebAssembly input");
  const module = evidence.moduleView();
  if (
    functionBodySha256(module, CERTIFICATE.loader) !== CERTIFICATE.loaderBodySha256
    || functionBodySha256(module, CERTIFICATE.converter) !== CERTIFICATE.converterBodySha256
    || functionBodySha256(module, COMPASS_CERTIFICATE.renderFunction)
      !== COMPASS_CERTIFICATE.renderBodySha256
    || functionBodySha256(module, COMPASS_CERTIFICATE.mapRenderFunction)
      !== COMPASS_CERTIFICATE.mapRenderBodySha256
    || functionBodySha256(module, MISSION_MAP_CERTIFICATE.eventDispatcherFunction)
      !== MISSION_MAP_CERTIFICATE.eventDispatcherBodySha256
    || functionBodySha256(module, MISSION_MAP_CERTIFICATE.gameplayContextFunction)
      !== MISSION_MAP_CERTIFICATE.gameplayContextBodySha256
  ) fail("loader or converter certificate changed");

  const sections = splitSections(input);
  const types = parseTypes(sectionById(sections, 1));
  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const bodies = parseCode(sectionById(sections, 10));
  const globals = vectorPayload(sectionById(sections, 6));
  const exports = vectorPayload(sectionById(sections, 7));
  if (functionTypes.length !== bodies.length) fail("function and code sections disagree");

  const existingExports = new Set(parseExports(sectionById(sections, 7)).map((entry) => entry.name));
  const names = [
    PATHING_SPIKE_GLOBALS.status,
    PATHING_SPIKE_GLOBALS.sequence,
    PATHING_SPIKE_GLOBALS.callCount,
    PATHING_SPIKE_GLOBALS.totalTrapezoids,
    PATHING_SPIKE_GLOBALS.sampledMapTrapezoids,
    PATHING_SPIKE_GLOBALS.sampledMapZplane,
    PATHING_SPIKE_GLOBALS.generation,
    ...PATHING_SPIKE_GLOBALS.samples.flat(),
  ];
  const functionNames = [PATHING_SPIKE_GLOBALS.readCoordinate, PATHING_SPIKE_GLOBALS.reset];
  const compassNames = COMPASS_FRAME_SPIKE_SCALARS;
  const missionMapNames = MISSION_MAP_FRAME_SPIKE_SCALARS;
  const missionMapProjectionNames = MISSION_MAP_PROJECTION_SPIKE_SCALARS;
  const allFunctionNames = [
    ...functionNames,
    COMPASS_FRAME_SPIKE_GLOBALS.observe,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.observe,
  ];
  if (
    [
      ...names, ...compassNames, ...missionMapNames,
      ...missionMapProjectionNames, ...allFunctionNames,
    ]
      .some((name) => existingExports.has(name))
  ) {
    fail("pathing spike export already exists");
  }

  const firstGlobal = globals.count;
  const sampleGlobalBase = firstGlobal + 7;
  const sampledMapPointer = firstGlobal + names.length;
  const firstMapPointerGlobal = sampledMapPointer + 1;
  const firstMapCountGlobal = firstMapPointerGlobal + MAX_CAPTURED_PATH_MAPS;
  const firstCompassGlobal = firstMapCountGlobal + MAX_CAPTURED_PATH_MAPS;
  const firstMissionMapGlobal = firstCompassGlobal + compassNames.length;
  const firstMissionMapProjectionGlobal = firstMissionMapGlobal + missionMapNames.length;
  const samplerGlobals: SamplerGlobals = Object.freeze({
    status: firstGlobal,
    sequence: firstGlobal + 1,
    callCount: firstGlobal + 2,
    totalTrapezoids: firstGlobal + 3,
    sampledMapTrapezoids: firstGlobal + 4,
    sampledMapZplane: firstGlobal + 5,
    generation: firstGlobal + 6,
    sampledMapPointer,
    mapPointers: Object.freeze(Array.from(
      { length: MAX_CAPTURED_PATH_MAPS }, (_, index) => firstMapPointerGlobal + index,
    )),
    mapCounts: Object.freeze(Array.from(
      { length: MAX_CAPTURED_PATH_MAPS }, (_, index) => firstMapCountGlobal + index,
    )),
    samples: Object.freeze(PATHING_SPIKE_GLOBALS.samples.map((row, trapezoid) =>
      Object.freeze(row.map((_, coordinate) =>
        sampleGlobalBase + trapezoid * CERTIFICATE.coordinateOffsets.length + coordinate
      ))
    )),
  });
  const compassGlobals: CompassGlobals = Object.freeze({
    status: firstCompassGlobal,
    generation: firstCompassGlobal + 1,
    frameId: firstCompassGlobal + 2,
    visible: firstCompassGlobal + 3,
    cameraSequence: firstCompassGlobal + 4,
    viewportWidth: firstCompassGlobal + 5,
    viewportHeight: firstCompassGlobal + 6,
    left: firstCompassGlobal + 7,
    bottom: firstCompassGlobal + 8,
    right: firstCompassGlobal + 9,
    top: firstCompassGlobal + 10,
    compassDirectionX: firstCompassGlobal + 11,
    compassDirectionY: firstCompassGlobal + 12,
  });
  const missionMapGlobals: FrameGlobals = Object.freeze({
    status: firstMissionMapGlobal,
    generation: firstMissionMapGlobal + 1,
    frameId: firstMissionMapGlobal + 2,
    visible: firstMissionMapGlobal + 3,
    viewportWidth: firstMissionMapGlobal + 4,
    viewportHeight: firstMissionMapGlobal + 5,
    left: firstMissionMapGlobal + 6,
    bottom: firstMissionMapGlobal + 7,
    right: firstMissionMapGlobal + 8,
    top: firstMissionMapGlobal + 9,
  });
  const missionMapProjectionGlobals: MissionMapProjectionGlobals = Object.freeze({
    status: firstMissionMapProjectionGlobal,
    sequence: firstMissionMapProjectionGlobal + 1,
    generation: firstMissionMapProjectionGlobal + 2,
    zoom: firstMissionMapProjectionGlobal + 3,
    panX: firstMissionMapProjectionGlobal + 4,
    panY: firstMissionMapProjectionGlobal + 5,
    drawableWidth: firstMissionMapProjectionGlobal + 6,
    drawableHeight: firstMissionMapProjectionGlobal + 7,
    playerMapX: firstMissionMapProjectionGlobal + 8,
    playerMapY: firstMissionMapProjectionGlobal + 9,
    nativeMapWidth: firstMissionMapProjectionGlobal + 10,
    nativeMapHeight: firstMissionMapProjectionGlobal + 11,
  });

  const loaderLocal = CERTIFICATE.loader - module.functionImportCount;
  const converterLocal = CERTIFICATE.converter - module.functionImportCount;
  const compassRenderLocal = COMPASS_CERTIFICATE.renderFunction - module.functionImportCount;
  const compassMapRenderLocal = COMPASS_CERTIFICATE.mapRenderFunction - module.functionImportCount;
  const missionMapDispatcherLocal = MISSION_MAP_CERTIFICATE.eventDispatcherFunction
    - module.functionImportCount;
  const loader = bodies[loaderLocal]?.slice() ?? fail("loader body is missing");
  const compassRender = bodies[compassRenderLocal]?.slice()
    ?? fail("Compass render body is missing");
  const converterType = functionTypes[converterLocal] ?? fail("converter type is missing");
  const compassMapRenderType = functionTypes[compassMapRenderLocal]
    ?? fail("CompassMap render type is missing");
  const missionMapDispatcherType = functionTypes[missionMapDispatcherLocal]
    ?? fail("Mission Map dispatcher type is missing");
  const expectedCall = concat(Uint8Array.of(0x10), paddedIndex(CERTIFICATE.converter));
  if (!expectedCall.every((byte, index) => loader[CERTIFICATE.callSiteOffset + index] === byte)) {
    fail("loader call site changed");
  }

  const nextTypes = [
    ...types,
    { params: [0x7f], results: [] },
    { params: [], results: [] },
    { params: [0x7f], results: [0x7d] },
  ];
  const resetType = nextTypes.length - 2;
  const readCoordinateType = nextTypes.length - 1;
  // samplerType is the first of the three appended types.
  const actualSamplerType = nextTypes.length - 3;
  const samplerFunction = module.functionImportCount + bodies.length;
  const wrapperFunction = samplerFunction + 1;
  const resetFunction = wrapperFunction + 1;
  const readCoordinateFunction = resetFunction + 1;
  const compassMapRenderWrapperFunction = readCoordinateFunction + 1;
  const compassObserverFunction = compassMapRenderWrapperFunction + 1;
  const missionMapObserverFunction = compassObserverFunction + 1;
  const missionMapEventWrapperFunction = missionMapObserverFunction + 1;
  loader.set(concat(Uint8Array.of(0x10), paddedIndex(wrapperFunction)), CERTIFICATE.callSiteOffset);
  const expectedCompassMapRenderCall = concat(
    Uint8Array.of(0x10), paddedIndex(COMPASS_CERTIFICATE.mapRenderFunction),
  );
  if (!expectedCompassMapRenderCall.every((byte, index) =>
    compassRender[COMPASS_CERTIFICATE.mapRenderCallSiteOffset + index] === byte
  )) fail("CompassMap render call site changed");
  compassRender.set(
    concat(Uint8Array.of(0x10), paddedIndex(compassMapRenderWrapperFunction)),
    COMPASS_CERTIFICATE.mapRenderCallSiteOffset,
  );
  const nextBodies = [...bodies];
  nextBodies[loaderLocal] = loader;
  nextBodies[compassRenderLocal] = compassRender;
  nextBodies.push(
    sampler(samplerGlobals),
    wrapper(CERTIFICATE.converter, samplerFunction),
    reset(samplerGlobals),
    readCoordinate(samplerGlobals),
    compassMapRenderWrapper(COMPASS_CERTIFICATE.mapRenderFunction, compassGlobals),
    nativeFrameObserver(
      COMPASS_CERTIFICATE,
      compassGlobals,
      samplerGlobals.generation,
      compassGlobals.cameraSequence,
    ),
    nativeFrameObserver(MISSION_MAP_CERTIFICATE, missionMapGlobals, samplerGlobals.generation),
    missionMapEventWrapper(
      MISSION_MAP_CERTIFICATE.eventDispatcherFunction,
      missionMapProjectionGlobals,
      samplerGlobals.generation,
    ),
  );
  const nextFunctionTypes = [
    ...functionTypes, actualSamplerType, converterType, resetType, readCoordinateType,
    compassMapRenderType, resetType, resetType, missionMapDispatcherType,
  ];
  const nextGlobals = concat(
    uleb(
      globals.count + names.length + 1 + MAX_CAPTURED_PATH_MAPS * 2
      + compassNames.length + missionMapNames.length
      + missionMapProjectionNames.length,
    ),
    globals.entries,
    ...names.map((_, index) => index < 7
      ? Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b)
      : Uint8Array.of(0x7d, 0x01, 0x43, 0, 0, 0, 0, 0x0b)),
    Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b),
    ...Array.from(
      { length: MAX_CAPTURED_PATH_MAPS * 2 },
      () => Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b),
    ),
    ...compassNames.map((_, index) => index < 5
      ? Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b)
      : Uint8Array.of(0x7d, 0x01, 0x43, 0, 0, 0, 0, 0x0b)),
    ...missionMapNames.map((_, index) => index < 4
      ? Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b)
      : Uint8Array.of(0x7d, 0x01, 0x43, 0, 0, 0, 0, 0x0b)),
    ...missionMapProjectionNames.map((_, index) => index < 3
      ? Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b)
      : Uint8Array.of(0x7d, 0x01, 0x43, 0, 0, 0, 0, 0x0b)),
  );
  const nextExports = concat(
    uleb(
      exports.count + names.length + compassNames.length
      + missionMapNames.length + missionMapProjectionNames.length
      + allFunctionNames.length,
    ),
    exports.entries,
    ...names.map((name, index) => concat(
      encodeName(name), Uint8Array.of(0x03), uleb(firstGlobal + index),
    )),
    concat(encodeName(PATHING_SPIKE_GLOBALS.reset), Uint8Array.of(0x00), uleb(resetFunction)),
    concat(
      encodeName(PATHING_SPIKE_GLOBALS.readCoordinate),
      Uint8Array.of(0x00),
      uleb(readCoordinateFunction),
    ),
    ...compassNames.map((name, index) => concat(
      encodeName(name), Uint8Array.of(0x03), uleb(firstCompassGlobal + index),
    )),
    concat(
      encodeName(COMPASS_FRAME_SPIKE_GLOBALS.observe),
      Uint8Array.of(0x00),
      uleb(compassObserverFunction),
    ),
    ...missionMapNames.map((name, index) => concat(
      encodeName(name), Uint8Array.of(0x03), uleb(firstMissionMapGlobal + index),
    )),
    ...missionMapProjectionNames.map((name, index) => concat(
      encodeName(name),
      Uint8Array.of(0x03),
      uleb(firstMissionMapProjectionGlobal + index),
    )),
    concat(
      encodeName(MISSION_MAP_FRAME_SPIKE_GLOBALS.observe),
      Uint8Array.of(0x00),
      uleb(missionMapObserverFunction),
    ),
  );

  const rewritten = sections.map((section): Section => {
    if (section.id === 1) return { id: 1, body: encodeTypes(nextTypes) };
    if (section.id === 3) return { id: 3, body: encodeIndexVector(nextFunctionTypes) };
    if (section.id === 6) return { id: 6, body: nextGlobals };
    if (section.id === 7) return { id: 7, body: nextExports };
    if (section.id === 9) return {
      id: 9,
      body: rewriteExactTableSlot(
        section.body,
        MISSION_MAP_CERTIFICATE.eventDispatcherTableSlot,
        MISSION_MAP_CERTIFICATE.eventDispatcherFunction,
        missionMapEventWrapperFunction,
      ),
    };
    if (section.id === 10) return { id: 10, body: encodeCode(nextBodies) };
    return section;
  });
  const output = concat(WASM_HEADER, ...rewritten.map(encodeSection));
  if (!WebAssembly.validate(output)) {
    try {
      new WebAssembly.Module(output);
    } catch (error) {
      fail(`rewritten module failed validation: ${String(error)}`);
    }
    fail("rewritten module failed validation");
  }
  return output;
}

export function cartographySpikeOutputSha256(input: Uint8Array): string {
  return createHash("sha256").update(transformCartographySpikeWasm(input)).digest("hex");
}
