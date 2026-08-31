/**
 * Owns certified constants and bytecode emitters for native Cartography.
 * It does not choose a client or memory layout for a launch.
 */
import {
  concat,
  readSleb,
  readUleb,
  sleb,
  uleb,
  type FunctionType,
} from "../core/wasm-binary.js";

const FRAME_LAYOUT = Object.freeze({
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

export const COMPASS_CERTIFICATE = Object.freeze({
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

export const MISSION_MAP_CERTIFICATE = Object.freeze({
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

export const WORLD_MAP_CERTIFICATE = Object.freeze({
  ...FRAME_LAYOUT,
  eventDispatcherFunction: 16_223,
  eventDispatcherBodySha256: "8802b503fe9c637e4e7aee6381357e224f861d34081a1c9539dd919909f3a5e7",
  eventDispatcherTableSlot: 4_152,
  ownerWindow: 0x08,
  ownerMap: 0x00,
  contextBytes: 0x224,
  frameId: 0x00,
  continent: 0x04,
  zoom: 0x38,
  topLeftX: 0x3c,
  topLeftY: 0x40,
  bottomRightX: 0x44,
  bottomRightY: 0x48,
});

export const EXPLORATION_CERTIFICATE = Object.freeze({
  gameContextSlot: 6,
  worldContext: 0x2c,
  cartographedAreas: 0x5a4,
  arrayCapacity: 0x04,
  arraySize: 0x08,
  gridWidth: 0x5b4,
  gridHeight: 0x5b8,
});

export const WORLD_MAP_ANCHOR_CERTIFICATE = Object.freeze({
  gameContextSlot: 6,
  mapContext: 0x14,
  mapStartX: 0x04,
  mapEndY: 0x10,
  mapId: 0x8c,
  areaInfoCount: 883,
  areaInfoStride: 0x7c,
  continent: 0x04,
  iconStartX: 0x48,
  iconStartY: 0x4c,
  iconEndX: 0x50,
  iconEndY: 0x54,
  iconStartXDupe: 0x58,
  iconStartYDupe: 0x5c,
  iconEndXDupe: 0x60,
  iconEndYDupe: 0x64,
});

export type CartographyMemoryLayout = Readonly<{
  frameArray: number;
  frameCount: number;
  contextRoot: number;
  areaInfo: number;
}>;

export const CARTOGRAPHY_MEMORY_LAYOUTS = Object.freeze({
  official: Object.freeze({
    frameArray: 0x5a1fdc,
    frameCount: 0x5a1fe4,
    contextRoot: 0x5a0e70,
    areaInfo: 0x1cc5c0,
  }),
  relocated: Object.freeze({
    frameArray: 0x5a3b1c,
    frameCount: 0x5a3b24,
    contextRoot: 0x5a29b0,
    areaInfo: 0x1cc700,
  }),
} satisfies Readonly<Record<"official" | "relocated", CartographyMemoryLayout>>);

export function fail(message: string): never {
  throw new Error(`pathing spike transform: ${message}`);
}

export function encodeTypes(types: readonly FunctionType[]): Uint8Array {
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

export function encodeName(value: string): Uint8Array {
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

export type CartographyContextGlobals = Readonly<{
  status: number;
  sequence: number;
  areaEpoch: number;
  mapId: number;
  layoutId: number;
  lastMapId: number;
  wasReady: number;
}>;

export type CartographyContextCertificate = Readonly<{
  contextRoot: number;
  gameContextSlot: number;
  mapContext: number;
  mapId: number;
  layoutId: 1 | 2;
}>;

export type FrameGlobals = Readonly<{
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

export type CompassGlobals = FrameGlobals & Readonly<{
  cameraSequence: number;
  compassDirectionX: number;
  compassDirectionY: number;
}>;

export type MissionMapProjectionGlobals = Readonly<{
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

export type WorldMapGlobals = FrameGlobals & Readonly<{
  sequence: number;
  continent: number;
  zoom: number;
  topLeftX: number;
  topLeftY: number;
  bottomRightX: number;
  bottomRightY: number;
}>;

export type ExplorationGlobals = Readonly<{
  status: number;
  sequence: number;
  generation: number;
  width: number;
  height: number;
  dwordCount: number;
  bufferPointer: number;
}>;

export type WorldMapAnchorGlobals = Readonly<{
  status: number;
  generation: number;
  continent: number;
  worldAnchorX: number;
  worldAnchorY: number;
  mapMinX: number;
  mapMinY: number;
  mapMaxX: number;
  mapMaxY: number;
}>;

type ExplorationCertificate = Readonly<
  Record<keyof typeof EXPLORATION_CERTIFICATE, number>
  & Pick<CartographyMemoryLayout, "contextRoot">
>;
type WorldMapAnchorCertificate = Readonly<
  Record<keyof typeof WORLD_MAP_ANCHOR_CERTIFICATE, number>
  & Pick<CartographyMemoryLayout, "contextRoot" | "areaInfo">
>;

type FrameCertificate = Readonly<{
  frameArray: number;
  frameCount: number;
  frameBytes: number;
  frameId: number;
  frameHashId: number;
  frameViewportWidth: number;
  frameViewportHeight: number;
  frameScreenLeft: number;
  frameScreenBottom: number;
  frameScreenRight: number;
  frameScreenTop: number;
  frameState: number;
  labelHash: number;
}>;

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

/**
 * Publish the one certified identity for the currently loaded map. The two
 * private globals make loading transitions edge-triggered: an unavailable
 * poll withdraws the current epoch once, while repeated polls stay stable.
 */
export function cartographyContextObserver(
  globals: CartographyContextGlobals,
  certificate: CartographyContextCertificate,
): Uint8Array {
  const finish = (status: number) => concat(
    i32(status), globalSet(globals.status),
    globalGet(globals.sequence), i32(1), Uint8Array.of(0x6a),
    globalSet(globals.sequence),
    Uint8Array.of(0x0f),
  );
  const withdraw = (status: number) => concat(
    globalGet(globals.wasReady), Uint8Array.of(0x04, 0x40),
    globalGet(globals.areaEpoch), i32(1), Uint8Array.of(0x6a),
    globalSet(globals.areaEpoch),
    i32(0), globalSet(globals.wasReady),
    Uint8Array.of(0x0b),
    i32(0), globalSet(globals.mapId),
    finish(status),
  );
  const requirePointer = (pointerLocal: number, bytes: number, status: number) => concat(
    local(pointerLocal), Uint8Array.of(0x45, 0x04, 0x40),
    withdraw(status), Uint8Array.of(0x0b),
    local(pointerLocal), local(4), i32(bytes), Uint8Array.of(0x6b, 0x4b, 0x04, 0x40),
    withdraw(status), Uint8Array.of(0x0b),
  );
  return concat(
    // contexts, game context, map context, map id, memory bytes.
    Uint8Array.of(0x01, 0x05, 0x7f),
    // Odd sequence means publication is in progress.
    globalGet(globals.sequence), i32(1), Uint8Array.of(0x6a),
    globalSet(globals.sequence),
    Uint8Array.of(0x3f, 0x00), i32(65_536), Uint8Array.of(0x6c, 0x21), uleb(4),
    i32(certificate.contextRoot), i32Load(), Uint8Array.of(0x21), uleb(0),
    requirePointer(0, certificate.gameContextSlot * 4 + 4, 2),
    local(0), i32Load(certificate.gameContextSlot * 4),
    Uint8Array.of(0x21), uleb(1),
    requirePointer(1, certificate.mapContext + 4, 3),
    local(1), i32Load(certificate.mapContext), Uint8Array.of(0x21), uleb(2),
    requirePointer(2, certificate.mapId + 4, 4),
    local(2), i32Load(certificate.mapId), Uint8Array.of(0x22), uleb(3),
    Uint8Array.of(0x45, 0x04, 0x40), withdraw(5), Uint8Array.of(0x0b),
    local(3), i32(2_000), Uint8Array.of(0x4b, 0x04, 0x40),
    withdraw(5), Uint8Array.of(0x0b),
    // Entering ready state or changing map creates one new area epoch.
    globalGet(globals.wasReady), Uint8Array.of(0x45),
    local(3), globalGet(globals.lastMapId), Uint8Array.of(0x47, 0x72, 0x04, 0x40),
    globalGet(globals.areaEpoch), i32(1), Uint8Array.of(0x6a),
    globalSet(globals.areaEpoch),
    Uint8Array.of(0x0b),
    local(3), globalSet(globals.lastMapId),
    local(3), globalSet(globals.mapId),
    i32(certificate.layoutId), globalSet(globals.layoutId),
    i32(1), globalSet(globals.wasReady),
    // Even sequence completes the seqlock publication.
    i32(1), globalSet(globals.status),
    globalGet(globals.sequence), i32(1), Uint8Array.of(0x6a),
    globalSet(globals.sequence),
    Uint8Array.of(0x0b),
  );
}

export function rewriteExactTableSlot(
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
export function nativeFrameObserver(
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

/** Retain the exact direction argument consumed by the native CompassMap. */
export function compassMapRenderWrapper(render: number, globals: CompassGlobals): Uint8Array {
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
export function missionMapEventWrapper(
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

/** Observe the dedicated native World Map context after its exact event handler. */
export function worldMapEventWrapper(
  dispatcher: number,
  globals: WorldMapGlobals,
  areaEpoch: number,
  certificate: typeof WORLD_MAP_CERTIFICATE & Pick<CartographyMemoryLayout, "frameArray" | "frameCount">,
): Uint8Array {
  const refuse = (status: number) => concat(
    i32(0), globalSet(globals.visible),
    i32(status), globalSet(globals.status), Uint8Array.of(0x0f),
  );
  const requirePointer = (pointerLocal: number, bytes: Uint8Array, status: number) => concat(
    local(pointerLocal), Uint8Array.of(0x45, 0x04, 0x40),
    refuse(status), Uint8Array.of(0x0b),
    local(pointerLocal), local(7), bytes, Uint8Array.of(0x6b, 0x4b, 0x04, 0x40),
    refuse(status), Uint8Array.of(0x0b),
  );
  const finite = (valueLocal: number, status: number) => concat(
    local(valueLocal), Uint8Array.of(0x8b), f32(1_000_000),
    Uint8Array.of(0x5f, 0x45, 0x04, 0x40), refuse(status), Uint8Array.of(0x0b),
  );
  return concat(
    // locals 3..7: owner window, context, frame id/index, frame, memory bytes.
    // locals 8..12: zoom and viewport bounds.
    Uint8Array.of(0x02, 0x05, 0x7f, 0x05, 0x7d),
    local(0), local(1), local(2), call(dispatcher),
    Uint8Array.of(0x3f, 0x00), i32(65_536), Uint8Array.of(0x6c, 0x21), uleb(7),
    requirePointer(0, i32(certificate.ownerWindow + 4), 2),
    local(0), i32Load(certificate.ownerWindow), Uint8Array.of(0x21), uleb(3),
    requirePointer(3, i32(certificate.ownerMap + 4), 3),
    local(3), i32Load(certificate.ownerMap), Uint8Array.of(0x21), uleb(4),
    requirePointer(4, i32(certificate.contextBytes), 4),
    local(4), i32Load(certificate.frameId), Uint8Array.of(0x22), uleb(5),
    globalSet(globals.frameId), local(5),
    i32(certificate.frameCount), i32Load(), Uint8Array.of(0x4f, 0x04, 0x40),
    refuse(5), Uint8Array.of(0x0b),
    i32(certificate.frameArray), i32Load(), Uint8Array.of(0x21), uleb(6),
    requirePointer(6, concat(local(5), i32(4), Uint8Array.of(0x6c)), 5),
    local(6), local(5), i32(4), Uint8Array.of(0x6c, 0x6a), i32Load(),
    Uint8Array.of(0x21), uleb(6),
    requirePointer(6, i32(certificate.frameBytes), 10),
    local(4), i32Load(certificate.continent), Uint8Array.of(0x22), uleb(3),
    i32(5), Uint8Array.of(0x4b, 0x04, 0x40), refuse(7), Uint8Array.of(0x0b),
    local(4), f32Load(certificate.zoom), Uint8Array.of(0x21), uleb(8),
    local(4), f32Load(certificate.topLeftX), Uint8Array.of(0x21), uleb(9),
    local(4), f32Load(certificate.topLeftY), Uint8Array.of(0x21), uleb(10),
    local(4), f32Load(certificate.bottomRightX), Uint8Array.of(0x21), uleb(11),
    local(4), f32Load(certificate.bottomRightY), Uint8Array.of(0x21), uleb(12),
    finite(8, 8), finite(9, 8), finite(10, 8), finite(11, 8), finite(12, 8),
    local(11), local(9), Uint8Array.of(0x5e, 0x45, 0x04, 0x40),
    refuse(9), Uint8Array.of(0x0b),
    local(12), local(10), Uint8Array.of(0x5e, 0x45, 0x04, 0x40),
    refuse(9), Uint8Array.of(0x0b),
    local(6), i32Load(certificate.frameState), Uint8Array.of(0x22), uleb(4),
    i32(4), Uint8Array.of(0x71, 0x45, 0x45),
    local(4), i32(0x200), Uint8Array.of(0x71, 0x45, 0x71), globalSet(globals.visible),
    local(6), f32Load(certificate.frameViewportWidth), globalSet(globals.viewportWidth),
    local(6), f32Load(certificate.frameViewportHeight), globalSet(globals.viewportHeight),
    local(6), f32Load(certificate.frameScreenLeft), globalSet(globals.left),
    local(6), f32Load(certificate.frameScreenBottom), globalSet(globals.bottom),
    local(6), f32Load(certificate.frameScreenRight), globalSet(globals.right),
    local(6), f32Load(certificate.frameScreenTop), globalSet(globals.top),
    local(3), globalSet(globals.continent),
    local(8), globalSet(globals.zoom),
    local(9), globalSet(globals.topLeftX),
    local(10), globalSet(globals.topLeftY),
    local(11), globalSet(globals.bottomRightX),
    local(12), globalSet(globals.bottomRightY),
    globalGet(areaEpoch), globalSet(globals.generation),
    globalGet(globals.sequence), i32(1), Uint8Array.of(0x6a), globalSet(globals.sequence),
    i32(1), globalSet(globals.status),
    Uint8Array.of(0x0b),
  );
}

/**
 * Publish the current map's world-space origin from the exact MapContext and
 * immutable AreaInfo table. This is the same two-input conversion used by
 * GWToolbox's GamePosToWorldMap, but no pointer crosses the client boundary.
 */
export function worldMapAnchorObserver(
  globals: WorldMapAnchorGlobals,
  pathingGeneration: number,
  certificate: WorldMapAnchorCertificate,
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
  const writeAnchors = (xOffset: number, yOffset: number) => concat(
    local(2), i32Load(xOffset), Uint8Array.of(0xb3),
    local(0), f32Load(certificate.mapStartX), Uint8Array.of(0x8b),
    f32(96), Uint8Array.of(0x95, 0x92, 0x21), uleb(4),
    local(2), i32Load(yOffset), Uint8Array.of(0xb3),
    local(0), f32Load(certificate.mapEndY), Uint8Array.of(0x8b),
    f32(96), Uint8Array.of(0x95, 0x92, 0x21), uleb(5),
  );
  const writeMapInfo = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) => concat(
    local(2), i32Load(certificate.continent), globalSet(globals.continent),
    local(2), i32Load(startX), Uint8Array.of(0xb3, 0x22), uleb(6),
    globalSet(globals.mapMinX),
    local(2), i32Load(startY), Uint8Array.of(0xb3, 0x22), uleb(7),
    globalSet(globals.mapMinY),
    local(2), i32Load(endX), Uint8Array.of(0xb3, 0x22), uleb(8),
    globalSet(globals.mapMaxX),
    local(2), i32Load(endY), Uint8Array.of(0xb3, 0x22), uleb(9),
    globalSet(globals.mapMaxY),
    writeAnchors(startX, startY),
  );
  return concat(
    // MapContext, map id, AreaInfo, memory bytes; anchors and map bounds.
    Uint8Array.of(0x02, 0x04, 0x7f, 0x06, 0x7d),
    i32(0), globalSet(globals.status),
    Uint8Array.of(0x3f, 0x00), i32(65_536), Uint8Array.of(0x6c, 0x21), uleb(3),
    i32(certificate.contextRoot), i32Load(),
    Uint8Array.of(0x21), uleb(0),
    requirePointer(0, certificate.gameContextSlot * 4 + 4, 2),
    local(0), i32Load(certificate.gameContextSlot * 4),
    Uint8Array.of(0x21), uleb(0),
    requirePointer(0, certificate.mapContext + 4, 3),
    local(0), i32Load(certificate.mapContext),
    Uint8Array.of(0x21), uleb(0),
    requirePointer(0, certificate.mapId + 4, 4),
    local(0), i32Load(certificate.mapId),
    Uint8Array.of(0x22), uleb(1), Uint8Array.of(0x45, 0x04, 0x40),
    refuse(5), Uint8Array.of(0x0b),
    local(1), i32(certificate.areaInfoCount),
    Uint8Array.of(0x4f, 0x04, 0x40), refuse(5), Uint8Array.of(0x0b),
    i32(certificate.areaInfo),
    local(1), i32(certificate.areaInfoStride),
    Uint8Array.of(0x6c, 0x6a, 0x21), uleb(2),
    requirePointer(2, certificate.areaInfoStride, 6),
    local(2), i32Load(certificate.iconStartX),
    Uint8Array.of(0x45, 0x04, 0x40),
    writeMapInfo(
      certificate.iconStartXDupe,
      certificate.iconStartYDupe,
      certificate.iconEndXDupe,
      certificate.iconEndYDupe,
    ),
    Uint8Array.of(0x05),
    writeMapInfo(
      certificate.iconStartX,
      certificate.iconStartY,
      certificate.iconEndX,
      certificate.iconEndY,
    ),
    Uint8Array.of(0x0b),
    // Publish the derived scalars before validating their range. A
    // non-ready status remains fail-closed, while live evidence can identify
    // which exact calculation violated the certificate without exposing a pointer.
    local(4), globalSet(globals.worldAnchorX),
    local(5), globalSet(globals.worldAnchorY),
    local(4), Uint8Array.of(0x8b), f32(1_000_000),
    Uint8Array.of(0x5d, 0x45, 0x04, 0x40), refuse(7), Uint8Array.of(0x0b),
    local(5), Uint8Array.of(0x8b), f32(1_000_000),
    Uint8Array.of(0x5d, 0x45, 0x04, 0x40), refuse(7), Uint8Array.of(0x0b),
    globalGet(globals.continent), i32(5), Uint8Array.of(0x4b, 0x04, 0x40),
    refuse(7), Uint8Array.of(0x0b),
    local(8), local(6), Uint8Array.of(0x5e, 0x45, 0x04, 0x40),
    refuse(7), Uint8Array.of(0x0b),
    local(9), local(7), Uint8Array.of(0x5e, 0x45, 0x04, 0x40),
    refuse(7), Uint8Array.of(0x0b),
    local(6), Uint8Array.of(0x8b), f32(1_000_000),
    Uint8Array.of(0x5f, 0x45, 0x04, 0x40), refuse(7), Uint8Array.of(0x0b),
    local(7), Uint8Array.of(0x8b), f32(1_000_000),
    Uint8Array.of(0x5f, 0x45, 0x04, 0x40), refuse(7), Uint8Array.of(0x0b),
    local(8), Uint8Array.of(0x8b), f32(1_000_000),
    Uint8Array.of(0x5f, 0x45, 0x04, 0x40), refuse(7), Uint8Array.of(0x0b),
    local(9), Uint8Array.of(0x8b), f32(1_000_000),
    Uint8Array.of(0x5f, 0x45, 0x04, 0x40), refuse(7), Uint8Array.of(0x0b),
    local(4), globalSet(globals.worldAnchorX),
    local(5), globalSet(globals.worldAnchorY),
    globalGet(pathingGeneration), globalSet(globals.generation),
    i32(1), globalSet(globals.status),
    Uint8Array.of(0x0b),
  );
}

/** Read the bounded exploration bitmap owner chain and publish no address. */
export function explorationObserver(
  globals: ExplorationGlobals,
  pathingGeneration: number,
  certificate: ExplorationCertificate,
): Uint8Array {
  const refuse = (status: number) => concat(
    i32(0), globalSet(globals.bufferPointer),
    i32(status), globalSet(globals.status), Uint8Array.of(0x0f),
  );
  const requirePointer = (pointerLocal: number, bytes: number, status: number) => concat(
    local(pointerLocal), Uint8Array.of(0x45, 0x04, 0x40),
    refuse(status), Uint8Array.of(0x0b),
    local(pointerLocal), local(5), i32(bytes), Uint8Array.of(0x6b, 0x4b, 0x04, 0x40),
    refuse(status), Uint8Array.of(0x0b),
  );
  return concat(
    // pointer scratch, capacity, size, cell/word count, and memory bytes.
    Uint8Array.of(0x01, 0x06, 0x7f),
    Uint8Array.of(0x3f, 0x00), i32(65_536), Uint8Array.of(0x6c, 0x21), uleb(5),
    i32(certificate.contextRoot), i32Load(), Uint8Array.of(0x21), uleb(0),
    requirePointer(0, certificate.gameContextSlot * 4 + 4, 2),
    local(0), i32Load(certificate.gameContextSlot * 4),
    Uint8Array.of(0x21), uleb(0),
    requirePointer(0, certificate.worldContext + 4, 3),
    local(0), i32Load(certificate.worldContext), Uint8Array.of(0x21), uleb(1),
    requirePointer(1, certificate.gridHeight + 4, 4),
    local(1), i32Load(certificate.gridWidth), Uint8Array.of(0x22), uleb(0),
    Uint8Array.of(0x45, 0x04, 0x40), refuse(5), Uint8Array.of(0x0b),
    local(0), i32(8_192), Uint8Array.of(0x4b, 0x04, 0x40),
    refuse(5), Uint8Array.of(0x0b),
    local(1), i32Load(certificate.gridHeight), Uint8Array.of(0x22), uleb(4),
    Uint8Array.of(0x45, 0x04, 0x40), refuse(5), Uint8Array.of(0x0b),
    local(4), i32(8_192), Uint8Array.of(0x4b, 0x04, 0x40),
    refuse(5), Uint8Array.of(0x0b),
    local(0), local(4), Uint8Array.of(0x6c, 0x21), uleb(4),
    local(1), i32Load(certificate.cartographedAreas),
    Uint8Array.of(0x21), uleb(0),
    local(1), i32Load(
      certificate.cartographedAreas + certificate.arrayCapacity,
    ), Uint8Array.of(0x21), uleb(2),
    local(1), i32Load(
      certificate.cartographedAreas + certificate.arraySize,
    ), Uint8Array.of(0x22), uleb(3),
    local(2), Uint8Array.of(0x4b, 0x04, 0x40), refuse(6), Uint8Array.of(0x0b),
    local(3), i32(262_144), Uint8Array.of(0x4b, 0x04, 0x40),
    refuse(6), Uint8Array.of(0x0b),
    // ceil(width * height / 32) must fit in the source array.
    local(4), i32(31), Uint8Array.of(0x6a), i32(5), Uint8Array.of(0x76),
    local(3), Uint8Array.of(0x4b, 0x04, 0x40), refuse(7), Uint8Array.of(0x0b),
    local(3), Uint8Array.of(0x45, 0x45), local(0), Uint8Array.of(0x45, 0x71, 0x04, 0x40),
    refuse(8), Uint8Array.of(0x0b),
    local(0), local(5), local(3), i32(4), Uint8Array.of(0x6c, 0x6b, 0x4b),
    Uint8Array.of(0x04, 0x40), refuse(8), Uint8Array.of(0x0b),
    local(0), globalSet(globals.bufferPointer),
    // Reload dimensions from the validated owner after retaining the buffer privately.
    local(1), i32Load(certificate.gridWidth), globalSet(globals.width),
    local(1), i32Load(certificate.gridHeight), globalSet(globals.height),
    local(3), globalSet(globals.dwordCount),
    globalGet(pathingGeneration), globalSet(globals.generation),
    globalGet(globals.sequence), i32(1), Uint8Array.of(0x6a), globalSet(globals.sequence),
    i32(1), globalSet(globals.status),
    Uint8Array.of(0x0b),
  );
}

export function explorationReadWord(globals: ExplorationGlobals): Uint8Array {
  return concat(
    Uint8Array.of(0x00),
    globalGet(globals.status), i32(1), Uint8Array.of(0x47, 0x04, 0x40),
    i32(0), Uint8Array.of(0x0f, 0x0b),
    local(0), globalGet(globals.dwordCount), Uint8Array.of(0x4f, 0x04, 0x40),
    i32(0), Uint8Array.of(0x0f, 0x0b),
    globalGet(globals.bufferPointer), local(0), i32(4), Uint8Array.of(0x6c, 0x6a),
    i32Load(), Uint8Array.of(0x0b),
  );
}

/** Add the exact scalar sampler to the certified current client. */
