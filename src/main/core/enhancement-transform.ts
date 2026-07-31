import { createHash } from "node:crypto";
import {
  findEnhancementBuild,
  enhancementConfigWords,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  concat,
  countFunctionImports,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  parseCode,
  parseIndexVector,
  parseTypes,
  readSleb,
  readUleb,
  sectionById,
  sleb,
  splitSections,
  uleb,
  valueTypeName,
  WASM_HEADER,
  type FunctionType,
  type Section,
} from "./wasm-binary.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const ENHANCEMENT_TRANSFORM_ABI = 5;
export const ENHANCEMENT_HOOK_EXPORT = "enhancement_hook_slot";
export const ENHANCEMENT_TICK_ORIGINAL_EXPORT = "enhancement_tick_original";
export const ENHANCEMENT_CURSOR_ORIGINAL_EXPORT = "enhancement_cursor_original";
export const ENHANCEMENT_UI_ORIGINAL_EXPORT = "enhancement_ui_original";
export const ENHANCEMENT_ORIGINAL_EXPORT = ENHANCEMENT_TICK_ORIGINAL_EXPORT;
export const ENHANCEMENT_MANIFEST_SECTION = "enhancement_manifest";

const DISPATCH_PARAMS = 6;
const DISPATCH_TICK = 0;
const DISPATCH_CURSOR = 1;
const DISPATCH_UI = 2;

interface WasmExport {
  name: string;
  kind: number;
  index: number;
}

function fail(message: string): never {
  throw new Error(`enhancement transform: ${message}`);
}

function encodeName(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(uleb(bytes.byteLength), bytes);
}

function parseExports(bytes: Uint8Array): WasmExport[] {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const exports: WasmExport[] = [];
  for (let index = 0; index < count; index += 1) {
    const nameLength = readUleb(bytes, cursor);
    const end = cursor.offset + nameLength;
    if (end > bytes.byteLength) fail("truncated export name");
    const name = new TextDecoder().decode(bytes.slice(cursor.offset, end));
    cursor.offset = end;
    const kind = bytes[cursor.offset++]!;
    exports.push({ name, kind, index: readUleb(bytes, cursor) });
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed export section");
  return exports;
}

function vectorPayload(bytes: Uint8Array): {
  count: number;
  entries: Uint8Array;
} {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  return { count, entries: bytes.slice(cursor.offset) };
}

function parseTable(bytes: Uint8Array): { min: number; max: number | null } {
  const cursor = { offset: 0 };
  if (readUleb(bytes, cursor) !== 1) fail("expected exactly one table");
  if (bytes[cursor.offset++] !== 0x70) fail("expected funcref table");
  const flags = readUleb(bytes, cursor);
  const min = readUleb(bytes, cursor);
  const max = (flags & 1) !== 0 ? readUleb(bytes, cursor) : null;
  return { min, max };
}

function tableSlotFunctions(bytes: Uint8Array): Map<number, number> {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const slots = new Map<number, number>();
  for (let segment = 0; segment < count; segment += 1) {
    const flags = readUleb(bytes, cursor);
    if (flags !== 0) fail(`unsupported element segment flags ${flags}`);
    if (bytes[cursor.offset++] !== 0x41) fail("expected element i32.const");
    const base = readSleb(bytes, cursor);
    if (bytes[cursor.offset++] !== 0x0b) fail("malformed element offset");
    const entries = readUleb(bytes, cursor);
    for (let i = 0; i < entries; i += 1) {
      const functionIndex = readUleb(bytes, cursor);
      const slot = base + i;
      if (slots.has(slot)) fail(`duplicate active table slot ${slot}`);
      slots.set(slot, functionIndex);
    }
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed element section");
  return slots;
}

function dispatcher(
  paramCount: number,
  dispatchKind: number,
  dispatchTypeIndex: number,
  originalIndex: number,
  hookGlobalIndex: number,
): Uint8Array {
  const args = Array.from({ length: paramCount }, (_, index) =>
    concat(Uint8Array.of(0x20), uleb(index)),
  );
  return concat(
    uleb(0),
    Uint8Array.of(0x23),
    uleb(hookGlobalIndex),
    Uint8Array.of(0x45, 0x04, 0x40),
    ...args,
    Uint8Array.of(0x10),
    uleb(originalIndex),
    Uint8Array.of(0x0f, 0x0b),
    Uint8Array.of(0x41),
    sleb(dispatchKind),
    ...args,
    ...Array.from({ length: DISPATCH_PARAMS - 1 - paramCount }, () =>
      concat(Uint8Array.of(0x41), sleb(0)),
    ),
    Uint8Array.of(0x23),
    uleb(hookGlobalIndex),
    Uint8Array.of(0x41),
    sleb(1),
    Uint8Array.of(0x6b, 0x11),
    uleb(dispatchTypeIndex),
    uleb(0),
    Uint8Array.of(0x0b),
  );
}

function buildManifestSection(build: KnownEnhancementBuild): Section {
  const configWords = enhancementConfigWords(build);
  const json = new TextEncoder().encode(
    JSON.stringify({
      transformAbi: ENHANCEMENT_TRANSFORM_ABI,
      programId: build.programId,
      buildId: build.buildId,
      tableSlot: build.tableSlot,
      hooks: {
        tick: { functionIndex: build.hookFunction, params: build.hookParams },
        cursor: {
          functionIndex: build.cursorEvent.functionIndex,
          params: build.cursorEvent.params,
          existingTableSlot: build.cursorEvent.tableSlot,
        },
        ui: {
          functionIndex: build.uiDispatcher.functionIndex,
          params: build.uiDispatcher.params,
        },
      },
      messages: {
        playerChat: build.uiDispatcher.playerChatMessage,
        hideHeroPanel: build.uiDispatcher.hideHeroPanelMessage,
        showHeroPanel: build.uiDispatcher.showHeroPanelMessage,
      },
      configWords,
    }),
  );
  return {
    id: 0,
    body: concat(encodeName(ENHANCEMENT_MANIFEST_SECTION), json),
  };
}

function assertSignature(
  label: string,
  type: FunctionType,
  expectedParams: readonly string[],
  expectedResults: readonly string[],
): void {
  const params = type.params.map(valueTypeName);
  const results = type.results.map(valueTypeName);
  if (
    params.join(",") !== expectedParams.join(",") ||
    results.join(",") !== expectedResults.join(",")
  ) {
    fail(
      `${label} signature is (${params.join(",")}) -> (${results.join(",")}), expected ` +
        `(${expectedParams.join(",")}) -> (${expectedResults.join(",")})`,
    );
  }
}

function encodeTypes(types: readonly FunctionType[]): Uint8Array {
  return concat(
    uleb(types.length),
    ...types.map((type) =>
      concat(
        Uint8Array.of(0x60),
        uleb(type.params.length),
        Uint8Array.from(type.params),
        uleb(type.results.length),
        Uint8Array.from(type.results),
      ),
    ),
  );
}

export interface EnhancementCandidateReport {
  sha256: string;
  validWasm: boolean;
  certifiedBuildId: number | null;
  mainLoop: {
    functionIndex: number;
    params: string[];
    results: string[];
  } | null;
  table: {
    min: number;
    max: number | null;
    firstEmptySlots: number[];
  } | null;
}

export function inspectEnhancementCandidate(
  input: Uint8Array,
): EnhancementCandidateReport {
  const sha256 = createHash("sha256").update(input).digest("hex");
  if (!WebAssembly.validate(input)) {
    return {
      sha256,
      validWasm: false,
      certifiedBuildId: null,
      mainLoop: null,
      table: null,
    };
  }
  const sections = splitSections(input);
  const types = parseTypes(sectionById(sections, 1));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const mainLoopExport = parseExports(sectionById(sections, 7)).find(
    (entry) => entry.kind === 0 && entry.name === "EmscriptenExeThreadMainLoop",
  );
  let mainLoop: EnhancementCandidateReport["mainLoop"] = null;
  if (mainLoopExport && mainLoopExport.index >= importCount) {
    const localIndex = mainLoopExport.index - importCount;
    const typeIndex = functionTypes[localIndex];
    const type = typeIndex === undefined ? undefined : types[typeIndex];
    if (type) {
      mainLoop = {
        functionIndex: mainLoopExport.index,
        params: type.params.map(valueTypeName),
        results: type.results.map(valueTypeName),
      };
    }
  }
  let table: EnhancementCandidateReport["table"];
  try {
    const shape = parseTable(sectionById(sections, 4));
    const occupied = tableSlotFunctions(sectionById(sections, 9));
    const firstEmptySlots: number[] = [];
    for (
      let slot = 0;
      slot < shape.min && firstEmptySlots.length < 8;
      slot += 1
    ) {
      if (!occupied.has(slot)) firstEmptySlots.push(slot);
    }
    table = { ...shape, firstEmptySlots };
  } catch {
    table = null;
  }
  return {
    sha256,
    validWasm: true,
    certifiedBuildId: findEnhancementBuild(sha256)?.buildId ?? null,
    mainLoop,
    table,
  };
}

export function transformEnhancementWasm(
  input: Uint8Array,
  build: KnownEnhancementBuild,
): Uint8Array {
  const hash = createHash("sha256").update(input).digest("hex");
  if (hash !== build.sha256) fail(`input hash ${hash} is unsupported`);

  const sections = splitSections(input);
  const types = parseTypes(sectionById(sections, 1));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const bodies = parseCode(sectionById(sections, 10));
  if (functionTypes.length !== bodies.length) fail("function/code count mismatch");

  const resolveHook = (
    label: string,
    functionIndex: number,
    expectedParams: readonly string[],
    expectedResults: readonly string[],
  ): { localIndex: number; typeIndex: number; type: FunctionType } => {
    const localIndex = functionIndex - importCount;
    if (localIndex < 0 || localIndex >= bodies.length) {
      fail(`${label} function is out of range`);
    }
    const typeIndex = functionTypes[localIndex]!;
    const type = types[typeIndex] ?? fail(`${label} references an unknown type`);
    assertSignature(label, type, expectedParams, expectedResults);
    return { localIndex, typeIndex, type };
  };
  const tick = resolveHook(
    "tick",
    build.hookFunction,
    build.hookParams,
    build.hookResults,
  );
  const cursor = resolveHook(
    "cursor",
    build.cursorEvent.functionIndex,
    build.cursorEvent.params,
    build.cursorEvent.results,
  );
  const ui = resolveHook(
    "UI dispatcher",
    build.uiDispatcher.functionIndex,
    build.uiDispatcher.params,
    build.uiDispatcher.results,
  );

  const table = parseTable(sectionById(sections, 4));
  if (
    build.tableSlot < 0 ||
    build.tableSlot >= table.min ||
    (table.max !== null && build.tableSlot >= table.max)
  ) {
    fail("hook table slot is outside table limits");
  }
  const tableSlots = tableSlotFunctions(sectionById(sections, 9));
  if (tableSlots.has(build.tableSlot)) {
    fail(`hook table slot ${build.tableSlot} is occupied`);
  }
  const emptySlots = Array.from({ length: table.min }, (_, slot) => slot).filter(
    (slot) => !tableSlots.has(slot),
  );
  if (emptySlots.length !== 1 || emptySlots[0] !== build.tableSlot) {
    fail(`hook table slot ${build.tableSlot} is not the sole empty slot`);
  }
  if (
    tableSlots.get(build.cursorEvent.tableSlot)
    !== build.cursorEvent.functionIndex
  ) {
    fail(
      `cursor table slot ${build.cursorEvent.tableSlot} does not map to ` +
        `function ${build.cursorEvent.functionIndex}`,
    );
  }

  const globals = vectorPayload(sectionById(sections, 6));
  const exports = vectorPayload(sectionById(sections, 7));
  const existingExports = parseExports(sectionById(sections, 7));
  const addedExportNames = [
    ENHANCEMENT_HOOK_EXPORT,
    ENHANCEMENT_TICK_ORIGINAL_EXPORT,
    ENHANCEMENT_CURSOR_ORIGINAL_EXPORT,
    ENHANCEMENT_UI_ORIGINAL_EXPORT,
  ];
  for (const name of addedExportNames) {
    if (existingExports.some((entry) => entry.name === name)) {
      fail(`export ${name} already exists`);
    }
  }
  const originalBaseIndex = importCount + bodies.length;
  const tickOriginalIndex = originalBaseIndex;
  const cursorOriginalIndex = originalBaseIndex + 1;
  const uiOriginalIndex = originalBaseIndex + 2;
  const hookGlobalIndex = globals.count;
  const dispatchTypeIndex = types.length;

  const nextTypes = [
    ...types,
    { params: Array<number>(DISPATCH_PARAMS).fill(0x7f), results: [] },
  ];
  const nextFunctionTypes = [
    ...functionTypes,
    tick.typeIndex,
    cursor.typeIndex,
    ui.typeIndex,
  ];
  const nextBodies = [
    ...bodies,
    bodies[tick.localIndex]!,
    bodies[cursor.localIndex]!,
    bodies[ui.localIndex]!,
  ];
  nextBodies[tick.localIndex] = dispatcher(
    tick.type.params.length,
    DISPATCH_TICK,
    dispatchTypeIndex,
    tickOriginalIndex,
    hookGlobalIndex,
  );
  nextBodies[cursor.localIndex] = dispatcher(
    cursor.type.params.length,
    DISPATCH_CURSOR,
    dispatchTypeIndex,
    cursorOriginalIndex,
    hookGlobalIndex,
  );
  nextBodies[ui.localIndex] = dispatcher(
    ui.type.params.length,
    DISPATCH_UI,
    dispatchTypeIndex,
    uiOriginalIndex,
    hookGlobalIndex,
  );
  const nextGlobals = concat(
    uleb(globals.count + 1),
    globals.entries,
    Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b),
  );
  const nextExports = concat(
    uleb(exports.count + 4),
    exports.entries,
    encodeName(ENHANCEMENT_HOOK_EXPORT),
    Uint8Array.of(0x03),
    uleb(hookGlobalIndex),
    encodeName(ENHANCEMENT_TICK_ORIGINAL_EXPORT),
    Uint8Array.of(0x00),
    uleb(tickOriginalIndex),
    encodeName(ENHANCEMENT_CURSOR_ORIGINAL_EXPORT),
    Uint8Array.of(0x00),
    uleb(cursorOriginalIndex),
    encodeName(ENHANCEMENT_UI_ORIGINAL_EXPORT),
    Uint8Array.of(0x00),
    uleb(uiOriginalIndex),
  );

  const rewritten = sections.map((section): Section => {
    if (section.id === 1) return { id: section.id, body: encodeTypes(nextTypes) };
    if (section.id === 3) {
      return { id: section.id, body: encodeIndexVector(nextFunctionTypes) };
    }
    if (section.id === 6) return { id: section.id, body: nextGlobals };
    if (section.id === 7) return { id: section.id, body: nextExports };
    if (section.id === 10) return { id: section.id, body: encodeCode(nextBodies) };
    return section;
  });
  const output = concat(
    WASM_HEADER,
    ...rewritten.map(encodeSection),
    encodeSection(buildManifestSection(build)),
  );
  if (!WebAssembly.validate(output)) fail("rewritten module failed validation");
  return output;
}
