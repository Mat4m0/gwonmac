/**
 * Certified Compass and Cartography client transform.
 *
 * The exact loader-to-converter call is routed through an appended wrapper.
 * Guild Wars performs the complete conversion first; only after success does
 * an appended sampler read the already-validated live PathingMap and retain a
 * fixed scalar sample in exported globals. No address is exported, no game
 * memory is reserved, and every existing function index remains unchanged.
 */
import {
  PATHING_SPIKE_GLOBALS,
  EXPLORATION_SPIKE_GLOBALS,
  EXPLORATION_SPIKE_SCALARS,
  COMPASS_FRAME_SPIKE_GLOBALS,
  COMPASS_FRAME_SPIKE_SCALARS,
  MISSION_MAP_FRAME_SPIKE_GLOBALS,
  MISSION_MAP_FRAME_SPIKE_SCALARS,
  MISSION_MAP_PROJECTION_SPIKE_SCALARS,
  WORLD_MAP_ANCHOR_SPIKE_GLOBALS,
  WORLD_MAP_ANCHOR_SPIKE_SCALARS,
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
  sectionById,
  splitSections,
  uleb,
  vectorPayload,
  WASM_HEADER,
  type Section,
} from "../core/wasm-binary.js";
import { functionBodySha256, wasmEvidence } from "./wasm-evidence.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
  Module: new (bytes: Uint8Array) => object;
};

export const CARTOGRAPHY_SPIKE_TRANSFORM_ABI = 23;
export { PATHING_SPIKE_GLOBALS } from "../../shared/cartography-spike.js";

import {
  CERTIFICATE,
  COMPASS_CERTIFICATE,
  MISSION_MAP_CERTIFICATE,
  EXPLORATION_CERTIFICATE,
  WORLD_MAP_ANCHOR_CERTIFICATE,
  CARTOGRAPHY_MEMORY_LAYOUTS,
  MAX_CAPTURED_PATH_MAPS,
  fail,
  encodeTypes,
  encodeName,
  rewriteExactTableSlot,
  nativeFrameObserver,
  sampler,
  reset,
  readCoordinate,
  wrapper,
  compassMapRenderWrapper,
  missionMapEventWrapper,
  worldMapAnchorObserver,
  explorationObserver,
  explorationReadWord,
  type SamplerGlobals,
  type FrameGlobals,
  type CompassGlobals,
  type MissionMapProjectionGlobals,
  type ExplorationGlobals,
  type WorldMapAnchorGlobals,
  type CartographyMemoryLayout,
} from "./cartography-transform-internals.js";

export type CartographyMemoryLayoutId = keyof typeof CARTOGRAPHY_MEMORY_LAYOUTS;

export function transformCartographySpikeWasm(
  input: Uint8Array,
  memoryLayoutId: CartographyMemoryLayoutId,
): Uint8Array {
  const memoryLayout: CartographyMemoryLayout = CARTOGRAPHY_MEMORY_LAYOUTS[memoryLayoutId];
  const compassCertificate = Object.freeze({
    ...COMPASS_CERTIFICATE,
    frameArray: memoryLayout.frameArray,
    frameCount: memoryLayout.frameCount,
  });
  const missionMapCertificate = Object.freeze({
    ...MISSION_MAP_CERTIFICATE,
    frameArray: memoryLayout.frameArray,
    frameCount: memoryLayout.frameCount,
  });
  const explorationCertificate = Object.freeze({
    ...EXPLORATION_CERTIFICATE,
    contextRoot: memoryLayout.contextRoot,
  });
  const worldMapAnchorCertificate = Object.freeze({
    ...WORLD_MAP_ANCHOR_CERTIFICATE,
    contextRoot: memoryLayout.contextRoot,
    areaInfo: memoryLayout.areaInfo,
  });
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
  const explorationNames = EXPLORATION_SPIKE_SCALARS;
  const worldMapAnchorNames = WORLD_MAP_ANCHOR_SPIKE_SCALARS;
  const allFunctionNames = [
    ...functionNames,
    COMPASS_FRAME_SPIKE_GLOBALS.observe,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.observe,
    EXPLORATION_SPIKE_GLOBALS.observe,
    EXPLORATION_SPIKE_GLOBALS.readWord,
    WORLD_MAP_ANCHOR_SPIKE_GLOBALS.observe,
  ];
  if (
    [
      ...names, ...compassNames, ...missionMapNames,
      ...missionMapProjectionNames, ...explorationNames, ...worldMapAnchorNames,
      ...allFunctionNames,
    ]
      .some((name) => existingExports.has(name))
  ) {
    fail("Cartography observer export already exists");
  }

  const firstGlobal = globals.count;
  const sampleGlobalBase = firstGlobal + 7;
  const sampledMapPointer = firstGlobal + names.length;
  const firstMapPointerGlobal = sampledMapPointer + 1;
  const firstMapCountGlobal = firstMapPointerGlobal + MAX_CAPTURED_PATH_MAPS;
  const firstCompassGlobal = firstMapCountGlobal + MAX_CAPTURED_PATH_MAPS;
  const firstMissionMapGlobal = firstCompassGlobal + compassNames.length;
  const firstMissionMapProjectionGlobal = firstMissionMapGlobal + missionMapNames.length;
  const firstExplorationGlobal = firstMissionMapProjectionGlobal
    + missionMapProjectionNames.length;
  const explorationBufferPointer = firstExplorationGlobal + explorationNames.length;
  const firstWorldMapAnchorGlobal = explorationBufferPointer + 1;
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
  const explorationGlobals: ExplorationGlobals = Object.freeze({
    status: firstExplorationGlobal,
    sequence: firstExplorationGlobal + 1,
    generation: firstExplorationGlobal + 2,
    width: firstExplorationGlobal + 3,
    height: firstExplorationGlobal + 4,
    dwordCount: firstExplorationGlobal + 5,
    bufferPointer: explorationBufferPointer,
  });
  const worldMapAnchorGlobals: WorldMapAnchorGlobals = Object.freeze({
    status: firstWorldMapAnchorGlobal,
    generation: firstWorldMapAnchorGlobal + 1,
    continent: firstWorldMapAnchorGlobal + 2,
    worldAnchorX: firstWorldMapAnchorGlobal + 3,
    worldAnchorY: firstWorldMapAnchorGlobal + 4,
    mapMinX: firstWorldMapAnchorGlobal + 5,
    mapMinY: firstWorldMapAnchorGlobal + 6,
    mapMaxX: firstWorldMapAnchorGlobal + 7,
    mapMaxY: firstWorldMapAnchorGlobal + 8,
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
    { params: [0x7f], results: [0x7f] },
  ];
  const resetType = nextTypes.length - 3;
  const readWordType = nextTypes.length - 1;
  const actualReadCoordinateType = nextTypes.length - 2;
  // samplerType is the first of the four appended types.
  const actualSamplerType = nextTypes.length - 4;
  const samplerFunction = module.functionImportCount + bodies.length;
  const wrapperFunction = samplerFunction + 1;
  const resetFunction = wrapperFunction + 1;
  const readCoordinateFunction = resetFunction + 1;
  const compassMapRenderWrapperFunction = readCoordinateFunction + 1;
  const compassObserverFunction = compassMapRenderWrapperFunction + 1;
  const missionMapObserverFunction = compassObserverFunction + 1;
  const missionMapEventWrapperFunction = missionMapObserverFunction + 1;
  const explorationObserverFunction = missionMapEventWrapperFunction + 1;
  const explorationReadWordFunction = explorationObserverFunction + 1;
  const worldMapAnchorObserverFunction = explorationReadWordFunction + 1;
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
      compassCertificate,
      compassGlobals,
      samplerGlobals.generation,
      compassGlobals.cameraSequence,
    ),
    nativeFrameObserver(missionMapCertificate, missionMapGlobals, samplerGlobals.generation),
    missionMapEventWrapper(
      MISSION_MAP_CERTIFICATE.eventDispatcherFunction,
      missionMapProjectionGlobals,
      samplerGlobals.generation,
    ),
    explorationObserver(
      explorationGlobals,
      samplerGlobals.generation,
      explorationCertificate,
    ),
    explorationReadWord(explorationGlobals),
    worldMapAnchorObserver(
      worldMapAnchorGlobals,
      samplerGlobals.generation,
      worldMapAnchorCertificate,
    ),
  );
  const nextFunctionTypes = [
    ...functionTypes, actualSamplerType, converterType, resetType, actualReadCoordinateType,
    compassMapRenderType, resetType, resetType, missionMapDispatcherType,
    resetType, readWordType, resetType,
  ];
  const appendedGlobalCount = names.length + 1 + MAX_CAPTURED_PATH_MAPS * 2
    + compassNames.length + missionMapNames.length
    + missionMapProjectionNames.length + explorationNames.length + 1
    + worldMapAnchorNames.length;
  const appendedFunctionCount = nextBodies.length - bodies.length;
  if (
    nextFunctionTypes.length - functionTypes.length !== appendedFunctionCount
    || worldMapAnchorObserverFunction + 1
      !== module.functionImportCount + nextBodies.length
    || firstWorldMapAnchorGlobal + worldMapAnchorNames.length
      !== globals.count + appendedGlobalCount
    || new Set(allFunctionNames).size !== allFunctionNames.length
  ) {
    fail("Cartography append plan is internally inconsistent");
  }
  const nextGlobals = concat(
    uleb(globals.count + appendedGlobalCount),
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
    ...Array.from(
      { length: explorationNames.length + 1 },
      () => Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b),
    ),
    ...worldMapAnchorNames.map((_, index) => index < 3
      ? Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b)
      : Uint8Array.of(0x7d, 0x01, 0x43, 0, 0, 0, 0, 0x0b)),
  );
  const nextExports = concat(
    uleb(
      exports.count + names.length + compassNames.length
      + missionMapNames.length + missionMapProjectionNames.length
      + explorationNames.length
      + worldMapAnchorNames.length
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
    ...explorationNames.map((name, index) => concat(
      encodeName(name), Uint8Array.of(0x03), uleb(firstExplorationGlobal + index),
    )),
    ...worldMapAnchorNames.map((name, index) => concat(
      encodeName(name), Uint8Array.of(0x03), uleb(firstWorldMapAnchorGlobal + index),
    )),
    concat(
      encodeName(EXPLORATION_SPIKE_GLOBALS.observe),
      Uint8Array.of(0x00),
      uleb(explorationObserverFunction),
    ),
    concat(
      encodeName(EXPLORATION_SPIKE_GLOBALS.readWord),
      Uint8Array.of(0x00),
      uleb(explorationReadWordFunction),
    ),
    concat(
      encodeName(WORLD_MAP_ANCHOR_SPIKE_GLOBALS.observe),
      Uint8Array.of(0x00),
      uleb(worldMapAnchorObserverFunction),
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
  const outputSections = splitSections(output);
  const expectedExportCount = exports.count + names.length + compassNames.length
    + missionMapNames.length + missionMapProjectionNames.length
    + explorationNames.length + worldMapAnchorNames.length
    + allFunctionNames.length;
  if (
    parseIndexVector(sectionById(outputSections, 3)).length !== nextFunctionTypes.length
    || parseCode(sectionById(outputSections, 10)).length !== nextBodies.length
    || vectorPayload(sectionById(outputSections, 6)).count
      !== globals.count + appendedGlobalCount
    || parseExports(sectionById(outputSections, 7)).length !== expectedExportCount
  ) {
    fail("Cartography append plan did not encode exactly");
  }
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
