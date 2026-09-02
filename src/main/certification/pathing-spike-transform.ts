/**
 * Certified Cartography client transform.
 *
 * This transform publishes only bounded scalar observations. It never reads,
 * retains, or exports a native pathing graph; the sealed Rust kernel is the
 * sole owner of that job. Every observer is stamped with one area epoch from
 * the certified context observer, so consumers can assemble an atomic model.
 */
import {
  CARTOGRAPHY_CONTEXT_GLOBALS,
  CARTOGRAPHY_CONTEXT_SCALARS,
  COMPASS_FRAME_SPIKE_GLOBALS,
  COMPASS_FRAME_SPIKE_SCALARS,
  EXPLORATION_SPIKE_GLOBALS,
  EXPLORATION_SPIKE_SCALARS,
  MISSION_MAP_FRAME_SPIKE_GLOBALS,
  MISSION_MAP_FRAME_SPIKE_SCALARS,
  MISSION_MAP_PROJECTION_SPIKE_SCALARS,
  WORLD_MAP_FRAME_SPIKE_SCALARS,
  WORLD_MAP_ANCHOR_SPIKE_GLOBALS,
  WORLD_MAP_ANCHOR_SPIKE_SCALARS,
} from "../../shared/cartography-spike.js";
import {
  concat,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  parseCode,
  parseExports,
  parseIndexVector,
  parseTypes,
  paddedIndex,
  sectionById,
  splitSections,
  uleb,
  vectorPayload,
  WASM_HEADER,
  type Section,
} from "../core/wasm-binary.js";
import { functionBodySha256, wasmEvidence } from "./wasm-evidence.js";
import {
  CARTOGRAPHY_MEMORY_LAYOUTS,
  COMPASS_CERTIFICATE,
  EXPLORATION_CERTIFICATE,
  MISSION_MAP_CERTIFICATE,
  WORLD_MAP_CERTIFICATE,
  WORLD_MAP_ANCHOR_CERTIFICATE,
  cartographyContextObserver,
  compassMapRenderWrapper,
  encodeName,
  encodeTypes,
  explorationObserver,
  explorationReadWord,
  fail,
  missionMapEventWrapper,
  nativeFrameObserver,
  rewriteExactTableSlot,
  worldMapAnchorObserver,
  worldMapEventWrapper,
  type CartographyContextGlobals,
  type CartographyMemoryLayout,
  type CompassGlobals,
  type ExplorationGlobals,
  type FrameGlobals,
  type MissionMapProjectionGlobals,
  type WorldMapAnchorGlobals,
  type WorldMapGlobals,
} from "./cartography-transform-internals.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
  Module: new (bytes: Uint8Array) => object;
};

export const CARTOGRAPHY_SPIKE_TRANSFORM_ABI = 31;
export type CartographyMemoryLayoutId = keyof typeof CARTOGRAPHY_MEMORY_LAYOUTS;

const mutableI32 = () => Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b);
const mutableF32 = () => Uint8Array.of(0x7d, 0x01, 0x43, 0, 0, 0, 0, 0x0b);

function globalsFor(
  firstGlobal: number,
): Readonly<{
  context: CartographyContextGlobals;
  compass: CompassGlobals;
  mission: FrameGlobals;
  projection: MissionMapProjectionGlobals;
  exploration: ExplorationGlobals;
  anchor: WorldMapAnchorGlobals;
  world: WorldMapGlobals;
  explorationBufferPointer: number;
  firstCompass: number;
  firstMission: number;
  firstProjection: number;
  firstExploration: number;
  firstAnchor: number;
  firstWorld: number;
  appendedCount: number;
}> {
  const firstCompass = firstGlobal + CARTOGRAPHY_CONTEXT_SCALARS.length + 2;
  const firstMission = firstCompass + COMPASS_FRAME_SPIKE_SCALARS.length;
  const firstProjection = firstMission + MISSION_MAP_FRAME_SPIKE_SCALARS.length;
  const firstExploration = firstProjection + MISSION_MAP_PROJECTION_SPIKE_SCALARS.length;
  const explorationBufferPointer = firstExploration + EXPLORATION_SPIKE_SCALARS.length;
  const firstAnchor = explorationBufferPointer + 1;
  const firstWorld = firstAnchor + WORLD_MAP_ANCHOR_SPIKE_SCALARS.length;
  const context: CartographyContextGlobals = Object.freeze({
    status: firstGlobal,
    sequence: firstGlobal + 1,
    areaEpoch: firstGlobal + 2,
    mapId: firstGlobal + 3,
    layoutId: firstGlobal + 4,
    lastMapId: firstGlobal + 5,
    wasReady: firstGlobal + 6,
  });
  return Object.freeze({
    context,
    compass: Object.freeze({
      status: firstCompass,
      generation: firstCompass + 1,
      frameId: firstCompass + 2,
      visible: firstCompass + 3,
      cameraSequence: firstCompass + 4,
      viewportWidth: firstCompass + 5,
      viewportHeight: firstCompass + 6,
      left: firstCompass + 7,
      bottom: firstCompass + 8,
      right: firstCompass + 9,
      top: firstCompass + 10,
      compassDirectionX: firstCompass + 11,
      compassDirectionY: firstCompass + 12,
    }),
    mission: Object.freeze({
      status: firstMission,
      generation: firstMission + 1,
      frameId: firstMission + 2,
      visible: firstMission + 3,
      viewportWidth: firstMission + 4,
      viewportHeight: firstMission + 5,
      left: firstMission + 6,
      bottom: firstMission + 7,
      right: firstMission + 8,
      top: firstMission + 9,
    }),
    projection: Object.freeze({
      status: firstProjection,
      sequence: firstProjection + 1,
      generation: firstProjection + 2,
      zoom: firstProjection + 3,
      panX: firstProjection + 4,
      panY: firstProjection + 5,
      drawableWidth: firstProjection + 6,
      drawableHeight: firstProjection + 7,
      playerMapX: firstProjection + 8,
      playerMapY: firstProjection + 9,
      nativeMapWidth: firstProjection + 10,
      nativeMapHeight: firstProjection + 11,
    }),
    exploration: Object.freeze({
      status: firstExploration,
      sequence: firstExploration + 1,
      generation: firstExploration + 2,
      width: firstExploration + 3,
      height: firstExploration + 4,
      dwordCount: firstExploration + 5,
      bufferPointer: explorationBufferPointer,
    }),
    anchor: Object.freeze({
      status: firstAnchor,
      generation: firstAnchor + 1,
      continent: firstAnchor + 2,
      onWorldMap: firstAnchor + 3,
      worldAnchorX: firstAnchor + 4,
      worldAnchorY: firstAnchor + 5,
      mapMinX: firstAnchor + 6,
      mapMinY: firstAnchor + 7,
      mapMaxX: firstAnchor + 8,
      mapMaxY: firstAnchor + 9,
    }),
    world: Object.freeze({
      status: firstWorld,
      sequence: firstWorld + 1,
      generation: firstWorld + 2,
      frameId: firstWorld + 3,
      visible: firstWorld + 4,
      viewportWidth: firstWorld + 5,
      viewportHeight: firstWorld + 6,
      left: firstWorld + 7,
      bottom: firstWorld + 8,
      right: firstWorld + 9,
      top: firstWorld + 10,
      continent: firstWorld + 11,
      zoom: firstWorld + 12,
      topLeftX: firstWorld + 13,
      topLeftY: firstWorld + 14,
      bottomRightX: firstWorld + 15,
      bottomRightY: firstWorld + 16,
    }),
    explorationBufferPointer,
    firstCompass,
    firstMission,
    firstProjection,
    firstExploration,
    firstAnchor,
    firstWorld,
    appendedCount: firstWorld + WORLD_MAP_FRAME_SPIKE_SCALARS.length - firstGlobal,
  });
}

export function transformCartographySpikeWasm(
  input: Uint8Array,
  memoryLayoutId: CartographyMemoryLayoutId,
): Uint8Array {
  const memoryLayout: CartographyMemoryLayout = CARTOGRAPHY_MEMORY_LAYOUTS[memoryLayoutId];
  const layoutId = memoryLayoutId === "official" ? 1 : 2;
  const compassCertificate = Object.freeze({
    ...COMPASS_CERTIFICATE,
    frameArray: memoryLayout.frameArray,
    frameCount: memoryLayout.frameCount,
  });
  const missionCertificate = Object.freeze({
    ...MISSION_MAP_CERTIFICATE,
    frameArray: memoryLayout.frameArray,
    frameCount: memoryLayout.frameCount,
  });
  const worldCertificate = Object.freeze({
    ...WORLD_MAP_CERTIFICATE,
    frameArray: memoryLayout.frameArray,
    frameCount: memoryLayout.frameCount,
  });
  const explorationCertificate = Object.freeze({
    ...EXPLORATION_CERTIFICATE,
    contextRoot: memoryLayout.contextRoot,
  });
  const anchorCertificate = Object.freeze({
    ...WORLD_MAP_ANCHOR_CERTIFICATE,
    contextRoot: memoryLayout.contextRoot,
    areaInfo: memoryLayout.areaInfo,
  });
  const contextCertificate = Object.freeze({
    contextRoot: memoryLayout.contextRoot,
    gameContextSlot: WORLD_MAP_ANCHOR_CERTIFICATE.gameContextSlot,
    mapContext: WORLD_MAP_ANCHOR_CERTIFICATE.mapContext,
    mapId: WORLD_MAP_ANCHOR_CERTIFICATE.mapId,
    layoutId,
  });
  const evidence = wasmEvidence(input) ?? fail("invalid WebAssembly input");
  const module = evidence.moduleView();
  if (
    functionBodySha256(module, COMPASS_CERTIFICATE.renderFunction)
      !== COMPASS_CERTIFICATE.renderBodySha256
    || functionBodySha256(module, COMPASS_CERTIFICATE.mapRenderFunction)
      !== COMPASS_CERTIFICATE.mapRenderBodySha256
    || functionBodySha256(module, MISSION_MAP_CERTIFICATE.eventDispatcherFunction)
      !== MISSION_MAP_CERTIFICATE.eventDispatcherBodySha256
    || functionBodySha256(module, MISSION_MAP_CERTIFICATE.gameplayContextFunction)
      !== MISSION_MAP_CERTIFICATE.gameplayContextBodySha256
    || functionBodySha256(module, WORLD_MAP_CERTIFICATE.eventDispatcherFunction)
      !== WORLD_MAP_CERTIFICATE.eventDispatcherBodySha256
  ) fail("Cartography surface certificate changed");

  const sections = splitSections(input);
  const types = parseTypes(sectionById(sections, 1));
  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const bodies = parseCode(sectionById(sections, 10));
  const globals = vectorPayload(sectionById(sections, 6));
  const exports = vectorPayload(sectionById(sections, 7));
  if (functionTypes.length !== bodies.length) fail("function and code sections disagree");

  const scalarNames = [
    ...CARTOGRAPHY_CONTEXT_SCALARS,
    ...COMPASS_FRAME_SPIKE_SCALARS,
    ...MISSION_MAP_FRAME_SPIKE_SCALARS,
    ...MISSION_MAP_PROJECTION_SPIKE_SCALARS,
    ...EXPLORATION_SPIKE_SCALARS,
    ...WORLD_MAP_ANCHOR_SPIKE_SCALARS,
    ...WORLD_MAP_FRAME_SPIKE_SCALARS,
  ];
  const functionNames = [
    CARTOGRAPHY_CONTEXT_GLOBALS.observe,
    COMPASS_FRAME_SPIKE_GLOBALS.observe,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.observe,
    EXPLORATION_SPIKE_GLOBALS.observe,
    EXPLORATION_SPIKE_GLOBALS.readWord,
    WORLD_MAP_ANCHOR_SPIKE_GLOBALS.observe,
  ];
  const existingExports = new Set(
    parseExports(sectionById(sections, 7)).map((entry) => entry.name),
  );
  if ([...scalarNames, ...functionNames].some((name) => existingExports.has(name))) {
    fail("Cartography observer export already exists");
  }

  const allocated = globalsFor(globals.count);
  const voidType = types.length;
  const readWordType = voidType + 1;
  const nextTypes = [
    ...types,
    { params: [], results: [] },
    { params: [0x7f], results: [0x7f] },
  ];
  const compassMapRenderLocal = COMPASS_CERTIFICATE.mapRenderFunction
    - module.functionImportCount;
  const compassRenderLocal = COMPASS_CERTIFICATE.renderFunction - module.functionImportCount;
  const missionDispatcherLocal = MISSION_MAP_CERTIFICATE.eventDispatcherFunction
    - module.functionImportCount;
  const worldDispatcherLocal = WORLD_MAP_CERTIFICATE.eventDispatcherFunction
    - module.functionImportCount;
  const compassMapRenderType = functionTypes[compassMapRenderLocal]
    ?? fail("CompassMap render type is missing");
  const missionDispatcherType = functionTypes[missionDispatcherLocal]
    ?? fail("Mission Map dispatcher type is missing");
  const worldDispatcherType = functionTypes[worldDispatcherLocal]
    ?? fail("World Map dispatcher type is missing");
  const firstFunction = module.functionImportCount + bodies.length;
  const contextObserverFunction = firstFunction;
  const compassMapRenderWrapperFunction = firstFunction + 1;
  const compassObserverFunction = firstFunction + 2;
  const missionObserverFunction = firstFunction + 3;
  const missionEventWrapperFunction = firstFunction + 4;
  const explorationObserverFunction = firstFunction + 5;
  const explorationReadWordFunction = firstFunction + 6;
  const anchorObserverFunction = firstFunction + 7;
  const worldEventWrapperFunction = firstFunction + 8;

  const compassRender = bodies[compassRenderLocal]?.slice()
    ?? fail("Compass render body is missing");
  const expectedCompassCall = concat(
    Uint8Array.of(0x10),
    paddedIndex(COMPASS_CERTIFICATE.mapRenderFunction),
  );
  const callOffset = COMPASS_CERTIFICATE.mapRenderCallSiteOffset;
  if (!expectedCompassCall.every((byte, index) => compassRender[callOffset + index] === byte)) {
    fail("CompassMap render call site changed");
  }
  // Preserve the client's fixed-width call encoding.
  const replacement = concat(
    Uint8Array.of(0x10),
    paddedIndex(compassMapRenderWrapperFunction),
  );
  compassRender.set(replacement, callOffset);

  const nextBodies = [...bodies];
  nextBodies[compassRenderLocal] = compassRender;
  nextBodies.push(
    cartographyContextObserver(allocated.context, contextCertificate),
    compassMapRenderWrapper(COMPASS_CERTIFICATE.mapRenderFunction, allocated.compass),
    nativeFrameObserver(
      compassCertificate,
      allocated.compass,
      allocated.context.areaEpoch,
      allocated.compass.cameraSequence,
    ),
    nativeFrameObserver(
      missionCertificate,
      allocated.mission,
      allocated.context.areaEpoch,
    ),
    missionMapEventWrapper(
      MISSION_MAP_CERTIFICATE.eventDispatcherFunction,
      allocated.projection,
      allocated.context.areaEpoch,
    ),
    explorationObserver(
      allocated.exploration,
      allocated.context.areaEpoch,
      explorationCertificate,
    ),
    explorationReadWord(allocated.exploration),
    worldMapAnchorObserver(
      allocated.anchor,
      allocated.context.areaEpoch,
      anchorCertificate,
    ),
    worldMapEventWrapper(
      WORLD_MAP_CERTIFICATE.eventDispatcherFunction,
      allocated.world,
      allocated.context.areaEpoch,
      worldCertificate,
    ),
  );
  const nextFunctionTypes = [
    ...functionTypes,
    voidType,
    compassMapRenderType,
    voidType,
    voidType,
    missionDispatcherType,
    voidType,
    readWordType,
    voidType,
    worldDispatcherType,
  ];

  const contextEntries = [
    ...CARTOGRAPHY_CONTEXT_SCALARS.map(mutableI32),
    mutableI32(),
    mutableI32(),
  ];
  const nextGlobals = concat(
    uleb(globals.count + allocated.appendedCount),
    globals.entries,
    ...contextEntries,
    ...COMPASS_FRAME_SPIKE_SCALARS.map((_, index) => index < 5 ? mutableI32() : mutableF32()),
    ...MISSION_MAP_FRAME_SPIKE_SCALARS.map((_, index) => index < 4 ? mutableI32() : mutableF32()),
    ...MISSION_MAP_PROJECTION_SPIKE_SCALARS.map((_, index) =>
      index < 3 ? mutableI32() : mutableF32()
    ),
    ...EXPLORATION_SPIKE_SCALARS.map(mutableI32),
    mutableI32(),
    ...WORLD_MAP_ANCHOR_SPIKE_SCALARS.map((_, index) =>
      index < 4 ? mutableI32() : mutableF32()
    ),
    ...WORLD_MAP_FRAME_SPIKE_SCALARS.map((_, index) =>
      index < 5 || index === 11 ? mutableI32() : mutableF32()
    ),
  );
  const scalarPlans = [
    [CARTOGRAPHY_CONTEXT_SCALARS, globals.count],
    [COMPASS_FRAME_SPIKE_SCALARS, allocated.firstCompass],
    [MISSION_MAP_FRAME_SPIKE_SCALARS, allocated.firstMission],
    [MISSION_MAP_PROJECTION_SPIKE_SCALARS, allocated.firstProjection],
    [EXPLORATION_SPIKE_SCALARS, allocated.firstExploration],
    [WORLD_MAP_ANCHOR_SPIKE_SCALARS, allocated.firstAnchor],
    [WORLD_MAP_FRAME_SPIKE_SCALARS, allocated.firstWorld],
  ] as const;
  const functionPlans = [
    [CARTOGRAPHY_CONTEXT_GLOBALS.observe, contextObserverFunction],
    [COMPASS_FRAME_SPIKE_GLOBALS.observe, compassObserverFunction],
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.observe, missionObserverFunction],
    [EXPLORATION_SPIKE_GLOBALS.observe, explorationObserverFunction],
    [EXPLORATION_SPIKE_GLOBALS.readWord, explorationReadWordFunction],
    [WORLD_MAP_ANCHOR_SPIKE_GLOBALS.observe, anchorObserverFunction],
  ] as const;
  const nextExports = concat(
    uleb(exports.count + scalarNames.length + functionNames.length),
    exports.entries,
    ...scalarPlans.flatMap(([names, first]) => names.map((name, index) => concat(
      encodeName(name), Uint8Array.of(0x03), uleb(first + index),
    ))),
    ...functionPlans.map(([name, index]) => concat(
      encodeName(name), Uint8Array.of(0x00), uleb(index),
    )),
  );

  const rewritten = sections.map((section): Section => {
    if (section.id === 1) return { id: 1, body: encodeTypes(nextTypes) };
    if (section.id === 3) return { id: 3, body: encodeIndexVector(nextFunctionTypes) };
    if (section.id === 6) return { id: 6, body: nextGlobals };
    if (section.id === 7) return { id: 7, body: nextExports };
    if (section.id === 9) return {
      id: 9,
      body: rewriteExactTableSlot(
        rewriteExactTableSlot(
          section.body,
          MISSION_MAP_CERTIFICATE.eventDispatcherTableSlot,
          MISSION_MAP_CERTIFICATE.eventDispatcherFunction,
          missionEventWrapperFunction,
        ),
        WORLD_MAP_CERTIFICATE.eventDispatcherTableSlot,
        WORLD_MAP_CERTIFICATE.eventDispatcherFunction,
        worldEventWrapperFunction,
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
