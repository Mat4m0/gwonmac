import { createHash } from "node:crypto";
import {
  findToolboxBuild,
  toolboxLayoutWords,
  type KnownToolboxBuild,
} from "./toolbox-builds.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const TOOLBOX_TRANSFORM_ABI = 2;
export const TOOLBOX_HOOK_EXPORT = "toolbox_hook_slot";
export const TOOLBOX_ORIGINAL_EXPORT = "toolbox_tick_original";
export const TOOLBOX_MANIFEST_SECTION = "toolbox_manifest";

const WASM_HEADER = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const VALUE_TYPE_NAMES = new Map([
  [0x7f, "i32"],
  [0x7e, "i64"],
  [0x7d, "f32"],
  [0x7c, "f64"],
]);

interface Section {
  id: number;
  body: Uint8Array;
}

interface FunctionType {
  params: number[];
  results: number[];
}

interface WasmExport {
  name: string;
  kind: number;
  index: number;
}

interface Cursor {
  offset: number;
}

function fail(message: string): never {
  throw new Error(`toolbox transform: ${message}`);
}

function readUleb(bytes: Uint8Array, cursor: Cursor): number {
  let result = 0;
  let shift = 0;
  for (let count = 0; count < 5; count += 1) {
    if (cursor.offset >= bytes.byteLength) fail("truncated LEB128");
    const byte = bytes[cursor.offset++]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result >>> 0;
    shift += 7;
  }
  return fail("oversized LEB128");
}

function uleb(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid unsigned value");
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) byte |= 0x80;
    out.push(byte);
  } while (value !== 0);
  return Uint8Array.from(out);
}

function sleb(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) fail("invalid signed value");
  const out: number[] = [];
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    const sign = (byte & 0x40) !== 0;
    more = !((value === 0 && !sign) || (value === -1 && sign));
    if (more) byte |= 0x80;
    out.push(byte);
  }
  return Uint8Array.from(out);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function encodeName(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(uleb(bytes.byteLength), bytes);
}

function splitSections(bytes: Uint8Array): Section[] {
  if (
    bytes.byteLength < WASM_HEADER.byteLength ||
    !WASM_HEADER.every((byte, index) => bytes[index] === byte)
  ) {
    fail("invalid WebAssembly header");
  }
  const sections: Section[] = [];
  const cursor = { offset: WASM_HEADER.byteLength };
  while (cursor.offset < bytes.byteLength) {
    const id = bytes[cursor.offset++]!;
    const size = readUleb(bytes, cursor);
    const end = cursor.offset + size;
    if (end > bytes.byteLength) fail("truncated section");
    sections.push({ id, body: bytes.slice(cursor.offset, end) });
    cursor.offset = end;
  }
  return sections;
}

function sectionById(sections: readonly Section[], id: number): Uint8Array {
  const found = sections.find((section) => section.id === id);
  return found?.body ?? fail(`missing section ${id}`);
}

function parseTypes(bytes: Uint8Array): FunctionType[] {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const types: FunctionType[] = [];
  for (let i = 0; i < count; i += 1) {
    if (bytes[cursor.offset++] !== 0x60) fail("unsupported type form");
    const paramCount = readUleb(bytes, cursor);
    const params = Array.from(
      bytes.slice(cursor.offset, cursor.offset + paramCount),
    );
    cursor.offset += paramCount;
    const resultCount = readUleb(bytes, cursor);
    const results = Array.from(
      bytes.slice(cursor.offset, cursor.offset + resultCount),
    );
    cursor.offset += resultCount;
    types.push({ params, results });
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed type section");
  return types;
}

function skipLimits(bytes: Uint8Array, cursor: Cursor): void {
  const flags = readUleb(bytes, cursor);
  readUleb(bytes, cursor);
  if ((flags & 1) !== 0) readUleb(bytes, cursor);
}

function countFunctionImports(bytes: Uint8Array): number {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  let functions = 0;
  for (let i = 0; i < count; i += 1) {
    const moduleLength = readUleb(bytes, cursor);
    cursor.offset += moduleLength;
    const nameLength = readUleb(bytes, cursor);
    cursor.offset += nameLength;
    const kind = bytes[cursor.offset++]!;
    if (kind === 0) {
      functions += 1;
      readUleb(bytes, cursor);
    } else if (kind === 1) {
      cursor.offset += 1;
      skipLimits(bytes, cursor);
    } else if (kind === 2) {
      skipLimits(bytes, cursor);
    } else if (kind === 3) {
      cursor.offset += 2;
    } else {
      fail(`unsupported import kind ${kind}`);
    }
  }
  return functions;
}

function parseVectorOfUleb(bytes: Uint8Array): number[] {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) values.push(readUleb(bytes, cursor));
  if (cursor.offset !== bytes.byteLength) fail("malformed index vector");
  return values;
}

function parseCode(bytes: Uint8Array): Uint8Array[] {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const bodies: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    const size = readUleb(bytes, cursor);
    const end = cursor.offset + size;
    if (end > bytes.byteLength) fail("truncated function body");
    bodies.push(bytes.slice(cursor.offset, end));
    cursor.offset = end;
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed code section");
  return bodies;
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

function readSignedConst(bytes: Uint8Array, cursor: Cursor): number {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    if (cursor.offset >= bytes.byteLength) fail("truncated signed LEB128");
    byte = bytes[cursor.offset++]!;
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while ((byte & 0x80) !== 0 && shift < 35);
  if (shift < 32 && (byte & 0x40) !== 0) result |= ~0 << shift;
  return result;
}

function occupiedTableSlots(bytes: Uint8Array): Set<number> {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const occupied = new Set<number>();
  for (let segment = 0; segment < count; segment += 1) {
    const flags = readUleb(bytes, cursor);
    if (flags !== 0) fail(`unsupported element segment flags ${flags}`);
    if (bytes[cursor.offset++] !== 0x41) fail("expected element i32.const");
    const base = readSignedConst(bytes, cursor);
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

function valueTypeName(value: number): string {
  return VALUE_TYPE_NAMES.get(value) ?? `0x${value.toString(16)}`;
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

function encodeIndexVector(values: readonly number[]): Uint8Array {
  return concat(uleb(values.length), ...values.map(uleb));
}

function encodeCode(bodies: readonly Uint8Array[]): Uint8Array {
  return concat(
    uleb(bodies.length),
    ...bodies.map((body) => concat(uleb(body.byteLength), body)),
  );
}

function encodeSection(section: Section): Uint8Array {
  return concat(Uint8Array.of(section.id), uleb(section.body.byteLength), section.body);
}

function buildManifestSection(build: KnownToolboxBuild): Section {
  const layoutWords = toolboxLayoutWords(build.layout);
  const json = new TextEncoder().encode(
    JSON.stringify({
      transformAbi: TOOLBOX_TRANSFORM_ABI,
      snapshotAbi: 1,
      snapshotBytes: 64,
      configBytes: layoutWords.length * 4,
      programId: build.programId,
      buildId: build.buildId,
      tableSlot: build.tableSlot,
      layoutWords,
    }),
  );
  return {
    id: 0,
    body: concat(encodeName(TOOLBOX_MANIFEST_SECTION), json),
  };
}

function assertSignature(type: FunctionType, build: KnownToolboxBuild): void {
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

export interface ToolboxCandidateReport {
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

export function inspectToolboxCandidate(
  input: Uint8Array,
): ToolboxCandidateReport {
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
  const functionTypes = parseVectorOfUleb(sectionById(sections, 3));
  const mainLoopExport = parseExports(sectionById(sections, 7)).find(
    (entry) => entry.kind === 0 && entry.name === "EmscriptenExeThreadMainLoop",
  );
  let mainLoop: ToolboxCandidateReport["mainLoop"] = null;
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
  let table: ToolboxCandidateReport["table"];
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
    certifiedBuildId: findToolboxBuild(sha256)?.buildId ?? null,
    mainLoop,
    table,
  };
}

export function transformToolboxWasm(
  input: Uint8Array,
  build: KnownToolboxBuild,
): Uint8Array {
  const hash = createHash("sha256").update(input).digest("hex");
  if (hash !== build.sha256) fail(`input hash ${hash} is unsupported`);

  const sections = splitSections(input);
  const types = parseTypes(sectionById(sections, 1));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const functionTypes = parseVectorOfUleb(sectionById(sections, 3));
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
    encodeName(TOOLBOX_HOOK_EXPORT),
    Uint8Array.of(0x03),
    uleb(hookGlobalIndex),
    encodeName(TOOLBOX_ORIGINAL_EXPORT),
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
