/**
 * The Enhancement transform: given one exact certified build, appends the hook
 * dispatch machinery to its WebAssembly and reserves the table slot the
 * companion kernel is installed into.
 *
 * The input hash is checked against the build entry before a byte is read, and
 * every hook's function signature is re-verified against the certified one, so
 * a table entry that has gone stale fails loudly instead of producing a module
 * that traps at runtime. Capability selection is exact — three booleans, no
 * extra keys, and a profile that has no certified output hash is refused rather
 * than derived.
 *
 * Hook ordering is part of the output identity, not an implementation detail:
 * it determines relocated function indices and therefore the resulting bytes,
 * so no capability selection may inherit another's ordering.
 *
 * `inspectEnhancementCandidate` is the read-only half. It reports what a module
 * looks like and certifies nothing.
 */
import { createHash } from "node:crypto";
import {
  enhancementCapabilityProfile,
  enhancementHooksFor,
  ENHANCEMENT_TRANSFORM_ABI,
  type EnhancementCapabilities,
} from "../../shared/contracts.js";
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
} from "../core/wasm-binary.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const ENHANCEMENT_HOOK_EXPORT = "enhancement_hook_slot";
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

function exactCapabilities(value: unknown): EnhancementCapabilities | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 3
    || !Object.hasOwn(record, "nativeCursor")
    || !Object.hasOwn(record, "targetObservation")
    || !Object.hasOwn(record, "toolbox")
    || typeof record.nativeCursor !== "boolean"
    || typeof record.targetObservation !== "boolean"
    || typeof record.toolbox !== "boolean"
  ) {
    return null;
  }
  return Object.freeze({
    nativeCursor: record.nativeCursor,
    targetObservation: record.targetObservation,
    toolbox: record.toolbox,
  });
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

function parseTable(bytes: Uint8Array): {
  flags: number;
  min: number;
  max: number | null;
} {
  const cursor = { offset: 0 };
  if (readUleb(bytes, cursor) !== 1) fail("expected exactly one table");
  if (bytes[cursor.offset++] !== 0x70) fail("expected funcref table");
  const flags = readUleb(bytes, cursor);
  const min = readUleb(bytes, cursor);
  const max = (flags & 1) !== 0 ? readUleb(bytes, cursor) : null;
  if (cursor.offset !== bytes.byteLength) fail("malformed table section");
  return { flags, min, max };
}

function encodeTable(flags: number, min: number, max: number): Uint8Array {
  return concat(
    uleb(1),
    Uint8Array.of(0x70),
    uleb(flags),
    uleb(min),
    uleb(max),
  );
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
    // The game-owned function always runs in the game module and on the
    // game-owned call stack. The optional companion is a passive observer;
    // normal game execution must never depend on crossing into a side module
    // and then re-entering this clone.
    ...args,
    Uint8Array.of(0x10),
    uleb(originalIndex),
    Uint8Array.of(0x23),
    uleb(hookGlobalIndex),
    Uint8Array.of(0x45, 0x04, 0x40),
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

function buildManifestSection(
  build: KnownEnhancementBuild,
  capabilities: EnhancementCapabilities,
): Section {
  const selectedHooks = enhancementHooksFor(capabilities);
  const configWords = enhancementConfigWords(build, capabilities);
  const json = new TextEncoder().encode(
    JSON.stringify({
      transformAbi: ENHANCEMENT_TRANSFORM_ABI,
      programId: build.programId,
      buildId: build.buildId,
      tableSlot: build.tableSlot,
      capabilities,
      hooks: {
        tick: selectedHooks.tick
          ? {
              functionIndex: build.hookFunction,
              params: build.hookParams,
              results: build.hookResults,
            }
          : null,
        cursor: selectedHooks.cursor
          ? {
              functionIndex: build.cursorEvent.functionIndex,
              params: build.cursorEvent.params,
              results: build.cursorEvent.results,
              existingTableSlot: build.cursorEvent.tableSlot,
            }
          : null,
        ui: selectedHooks.ui
          ? {
              functionIndex: build.uiDispatcher.functionIndex,
              params: build.uiDispatcher.params,
              results: build.uiDispatcher.results,
            }
          : null,
      },
      messages: selectedHooks.ui
          ? {
            playerChat: build.uiDispatcher.playerChatMessage,
            hideHeroPanel: build.uiDispatcher.hideHeroPanelMessage,
            showHeroPanel: build.uiDispatcher.showHeroPanelMessage,
            partyDirty: build.uiDispatcher.partyDirtyMessages,
          }
        : null,
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
    const { min, max } = parseTable(sectionById(sections, 4));
    const occupied = tableSlotFunctions(sectionById(sections, 9));
    const firstEmptySlots: number[] = [];
    for (
      let slot = 0;
      slot < min && firstEmptySlots.length < 8;
      slot += 1
    ) {
      if (!occupied.has(slot)) firstEmptySlots.push(slot);
    }
    table = { min, max, firstEmptySlots };
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
  requestedCapabilities: EnhancementCapabilities,
): Uint8Array {
  const capabilities = exactCapabilities(requestedCapabilities)
    ?? fail("capability selection is invalid");
  if (enhancementCapabilityProfile(capabilities) === null) {
    fail("capability profile is not certified");
  }
  const selectedHooks = enhancementHooksFor(capabilities);
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
  type ResolvedHook = ReturnType<typeof resolveHook> & Readonly<{
    dispatchKind: number;
  }>;
  // This is the transform's one ordering rule. It controls relocated-original
  // indices and output bytes, so capability selection can never inherit object
  // iteration order or the order in which a caller happened to request hooks.
  const selected: ResolvedHook[] = [];
  if (selectedHooks.tick) {
    selected.push({
      ...resolveHook(
        "tick",
        build.hookFunction,
        build.hookParams,
        build.hookResults,
      ),
      dispatchKind: DISPATCH_TICK,
    });
  }
  if (selectedHooks.cursor) {
    selected.push({
      ...resolveHook(
        "cursor",
        build.cursorEvent.functionIndex,
        build.cursorEvent.params,
        build.cursorEvent.results,
      ),
      dispatchKind: DISPATCH_CURSOR,
    });
  }
  if (selectedHooks.ui) {
    selected.push({
      ...resolveHook(
        "UI dispatcher",
        build.uiDispatcher.functionIndex,
        build.uiDispatcher.params,
        build.uiDispatcher.results,
      ),
      dispatchKind: DISPATCH_UI,
    });
  }
  if (new Set(selected.map((hook) => hook.localIndex)).size !== selected.length) {
    fail("selected hooks must resolve to distinct functions");
  }

  const table = parseTable(sectionById(sections, 4));
  if (
    table.flags !== 1 ||
    table.max === null ||
    table.min !== table.max ||
    table.max === 0xffff_ffff
  ) {
    fail("expected one bounded fixed-size function table");
  }
  if (build.tableSlot !== table.min) {
    fail(`hook table slot ${build.tableSlot} is not the new terminal slot`);
  }
  const nextTableSize = table.min + 1;
  if (selectedHooks.cursor) {
    const tableSlots = tableSlotFunctions(sectionById(sections, 9));
    if (
      tableSlots.get(build.cursorEvent.tableSlot)
      !== build.cursorEvent.functionIndex
    ) {
      fail(
        `cursor table slot ${build.cursorEvent.tableSlot} does not map to ` +
          `function ${build.cursorEvent.functionIndex}`,
      );
    }
  }

  const globals = vectorPayload(sectionById(sections, 6));
  const exports = vectorPayload(sectionById(sections, 7));
  const existingExports = parseExports(sectionById(sections, 7));
  const addedExportNames = [ENHANCEMENT_HOOK_EXPORT];
  for (const name of addedExportNames) {
    if (existingExports.some((entry) => entry.name === name)) {
      fail(`export ${name} already exists`);
    }
  }
  const originalBaseIndex = importCount + bodies.length;
  const hookGlobalIndex = globals.count;
  const dispatchTypeIndex = types.length;

  const nextTypes = [
    ...types,
    { params: Array<number>(DISPATCH_PARAMS).fill(0x7f), results: [] },
  ];
  const nextFunctionTypes = [
    ...functionTypes,
    ...selected.map((hook) => hook.typeIndex),
  ];
  const nextBodies = [
    ...bodies,
    ...selected.map((hook) => bodies[hook.localIndex]!),
  ];
  selected.forEach((hook, index) => {
    nextBodies[hook.localIndex] = dispatcher(
      hook.type.params.length,
      hook.dispatchKind,
      dispatchTypeIndex,
      originalBaseIndex + index,
      hookGlobalIndex,
    );
  });
  const nextGlobals = concat(
    uleb(globals.count + 1),
    globals.entries,
    Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b),
  );
  const nextExports = concat(
    uleb(exports.count + 1),
    exports.entries,
    encodeName(ENHANCEMENT_HOOK_EXPORT),
    Uint8Array.of(0x03),
    uleb(hookGlobalIndex),
  );

  const rewritten = sections.map((section): Section => {
    if (section.id === 1) return { id: section.id, body: encodeTypes(nextTypes) };
    if (section.id === 3) {
      return { id: section.id, body: encodeIndexVector(nextFunctionTypes) };
    }
    if (section.id === 4) {
      return {
        id: section.id,
        body: encodeTable(table.flags, nextTableSize, nextTableSize),
      };
    }
    if (section.id === 6) return { id: section.id, body: nextGlobals };
    if (section.id === 7) return { id: section.id, body: nextExports };
    if (section.id === 10) return { id: section.id, body: encodeCode(nextBodies) };
    return section;
  });
  const output = concat(
    WASM_HEADER,
    ...rewritten.map(encodeSection),
    encodeSection(buildManifestSection(build, capabilities)),
  );
  if (!WebAssembly.validate(output)) fail("rewritten module failed validation");
  return output;
}
