import { createHash } from "node:crypto";
import {
  findEnhancementBuild,
  enhancementLayoutWords,
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

export const ENHANCEMENT_TRANSFORM_ABI = 4;
export const ENHANCEMENT_HOOK_EXPORT = "enhancement_hook_slot";
export const ENHANCEMENT_ORIGINAL_EXPORT = "enhancement_tick_original";
export const ENHANCEMENT_MANIFEST_SECTION = "enhancement_manifest";

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

function occupiedTableSlots(bytes: Uint8Array): Set<number> {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const occupied = new Set<number>();
  for (let segment = 0; segment < count; segment += 1) {
    const flags = readUleb(bytes, cursor);
    if (flags !== 0) fail(`unsupported element segment flags ${flags}`);
    if (bytes[cursor.offset++] !== 0x41) fail("expected element i32.const");
    const base = readSleb(bytes, cursor);
    if (bytes[cursor.offset++] !== 0x0b) fail("malformed element offset");
    const entries = readUleb(bytes, cursor);
    for (let i = 0; i < entries; i += 1) {
      readUleb(bytes, cursor);
      occupied.add(base + i);
    }
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed element section");
  return occupied;
}

function dispatcher(
  paramCount: number,
  typeIndex: number,
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
    ...args,
    Uint8Array.of(0x23),
    uleb(hookGlobalIndex),
    Uint8Array.of(0x41),
    sleb(1),
    Uint8Array.of(0x6b, 0x11),
    uleb(typeIndex),
    uleb(0),
    Uint8Array.of(0x0b),
  );
}

function buildManifestSection(build: KnownEnhancementBuild): Section {
  const layoutWords = enhancementLayoutWords(build.layout);
  const json = new TextEncoder().encode(
    JSON.stringify({
      transformAbi: ENHANCEMENT_TRANSFORM_ABI,
      snapshotAbi: 1,
      snapshotBytes: 64,
      cursorSnapshotAbi: 1,
      cursorSnapshotBytes: 4160,
      configBytes: layoutWords.length * 4,
      programId: build.programId,
      buildId: build.buildId,
      tableSlot: build.tableSlot,
      layoutWords,
    }),
  );
  return {
    id: 0,
    body: concat(encodeName(ENHANCEMENT_MANIFEST_SECTION), json),
  };
}

function assertSignature(type: FunctionType, build: KnownEnhancementBuild): void {
  const params = type.params.map(valueTypeName);
  const results = type.results.map(valueTypeName);
  if (
    params.join(",") !== build.hookParams.join(",") ||
    results.join(",") !== build.hookResults.join(",")
  ) {
    fail(
      `hook signature is (${params.join(",")}) -> (${results.join(",")}), expected ` +
        `(${build.hookParams.join(",")}) -> (${build.hookResults.join(",")})`,
    );
  }
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
    const occupied = occupiedTableSlots(sectionById(sections, 9));
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

  const localIndex = build.hookFunction - importCount;
  if (localIndex < 0 || localIndex >= bodies.length) fail("hook function is out of range");
  const typeIndex = functionTypes[localIndex]!;
  const type = types[typeIndex] ?? fail("hook references an unknown type");
  assertSignature(type, build);

  const table = parseTable(sectionById(sections, 4));
  if (
    build.tableSlot < 0 ||
    build.tableSlot >= table.min ||
    (table.max !== null && build.tableSlot >= table.max)
  ) {
    fail("hook table slot is outside table limits");
  }
  if (occupiedTableSlots(sectionById(sections, 9)).has(build.tableSlot)) {
    fail(`hook table slot ${build.tableSlot} is occupied`);
  }

  const globals = vectorPayload(sectionById(sections, 6));
  const exports = vectorPayload(sectionById(sections, 7));
  const originalIndex = importCount + bodies.length;
  const hookGlobalIndex = globals.count;

  const nextFunctionTypes = [...functionTypes, typeIndex];
  const nextBodies = [...bodies, bodies[localIndex]!];
  nextBodies[localIndex] = dispatcher(
    type.params.length,
    typeIndex,
    originalIndex,
    hookGlobalIndex,
  );
  const nextGlobals = concat(
    uleb(globals.count + 1),
    globals.entries,
    Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b),
  );
  const nextExports = concat(
    uleb(exports.count + 2),
    exports.entries,
    encodeName(ENHANCEMENT_HOOK_EXPORT),
    Uint8Array.of(0x03),
    uleb(hookGlobalIndex),
    encodeName(ENHANCEMENT_ORIGINAL_EXPORT),
    Uint8Array.of(0x00),
    uleb(originalIndex),
  );

  const rewritten = sections.map((section): Section => {
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
