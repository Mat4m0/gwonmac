/**
 * Bounded, capability-free WASM parsing and relationship primitives for proofs.
 * Only feature modules may turn its facts into authority.
 */
import { createHash } from "node:crypto";
import {
  indexOfBytes,
  parseCode,
  parseIndexVector,
  parseTypes,
  readSleb,
  readUleb,
  splitSections,
  valueTypeName,
  type FunctionType,
  type Section,
} from "../core/wasm-binary.js";
import { relocationAwareFingerprint, type RelocationSpan } from "./semantic-proof.js";
import type {
  DecodedFunction,
  EnhancementEvidenceFailure,
  FunctionSignatureEvidence,
  ModuleShape,
  PlayerChatMessageAnchors,
  SemanticRole,
  TickEvidenceReport,
  WasmExport,
} from "./enhancement-evidence-types.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_TYPES = 100_000;
const MAX_FUNCTIONS = 100_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_INSTRUCTIONS = 25_000_000;
export const MAX_CONSIDERED = 4_096;

export interface EnhancementProofContext {
  readonly inputIdentity: Uint8Array;
  readonly inputSha256: string;
  readonly module: ModuleShape;
  readonly tick: TickEvidenceReport;
  readonly tableRelations: Map<number, number[]>;
  readonly decodeFunctions: (
    messageAnchors: PlayerChatMessageAnchors | readonly number[],
  ) => DecodedFunction[];
}

const proofContexts = new WeakMap<Uint8Array, EnhancementProofContext>();

const I32 = 0x7f;

interface Offset {
  value: number;
}

export class EvidenceError extends Error {
  readonly code: EnhancementEvidenceFailure;

  constructor(code: EnhancementEvidenceFailure) {
    super(code);
    this.code = code;
  }
}


function readUnsigned(
  bytes: Uint8Array,
  cursor: Offset,
  maxBytes = 5,
): number {
  let result = 0;
  let shift = 0;
  for (let count = 0; count < maxBytes; count += 1) {
    if (cursor.value >= bytes.byteLength) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const byte = bytes[cursor.value++]!;
    result += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(result) || result > 0xffff_ffff) {
        throw new EvidenceError("module-shape-unsupported");
      }
      return result;
    }
    shift += 7;
  }
  throw new EvidenceError("module-shape-unsupported");
}

function readSigned(
  bytes: Uint8Array,
  cursor: Offset,
  maxBytes: number,
): number {
  let result = 0;
  let shift = 0;
  for (let count = 0; count < maxBytes; count += 1) {
    if (cursor.value >= bytes.byteLength) {
      throw new EvidenceError("instruction-set-unsupported");
    }
    const byte = bytes[cursor.value++]!;
    result += (byte & 0x7f) * (2 ** shift);
    shift += 7;
    if ((byte & 0x80) === 0) {
      if ((byte & 0x40) !== 0) result -= 2 ** shift;
      return result;
    }
  }
  throw new EvidenceError("instruction-set-unsupported");
}

function skipBytes(bytes: Uint8Array, cursor: Offset, count: number): void {
  if (
    !Number.isSafeInteger(count)
    || count < 0
    || cursor.value + count > bytes.byteLength
  ) {
    throw new EvidenceError("module-shape-unsupported");
  }
  cursor.value += count;
}

function skipName(bytes: Uint8Array, cursor: Offset): string {
  const length = readUnsigned(bytes, cursor);
  const start = cursor.value;
  skipBytes(bytes, cursor, length);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(start, cursor.value),
    );
  } catch {
    throw new EvidenceError("module-shape-unsupported");
  }
}

function skipLimits(bytes: Uint8Array, cursor: Offset): void {
  const flags = readUnsigned(bytes, cursor);
  readUnsigned(bytes, cursor);
  if ((flags & 1) !== 0) readUnsigned(bytes, cursor);
}

function parseFunctionImports(bytes: Uint8Array | null): number[] {
  if (!bytes) return [];
  const cursor = { value: 0 };
  const count = readUnsigned(bytes, cursor);
  if (count > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const typeIndices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    skipName(bytes, cursor);
    skipName(bytes, cursor);
    if (cursor.value >= bytes.byteLength) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const kind = bytes[cursor.value++]!;
    if (kind === 0) {
      typeIndices.push(readUnsigned(bytes, cursor));
    } else if (kind === 1) {
      skipBytes(bytes, cursor, 1);
      skipLimits(bytes, cursor);
    } else if (kind === 2) {
      skipLimits(bytes, cursor);
    } else if (kind === 3) {
      skipBytes(bytes, cursor, 2);
    } else {
      throw new EvidenceError("module-shape-unsupported");
    }
  }
  if (cursor.value !== bytes.byteLength) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return typeIndices;
}

function parseExports(bytes: Uint8Array | null): WasmExport[] {
  if (!bytes) return [];
  const cursor = { value: 0 };
  const count = readUnsigned(bytes, cursor);
  if (count > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const result: WasmExport[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = skipName(bytes, cursor);
    if (cursor.value >= bytes.byteLength) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const kind = bytes[cursor.value++]!;
    result.push({ name, kind, index: readUnsigned(bytes, cursor) });
  }
  if (cursor.value !== bytes.byteLength) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return result;
}

function optionalSection(
  sections: readonly Section[],
  id: number,
): Uint8Array | null {
  const matches = sections.filter((section) => section.id === id);
  if (matches.length > 1) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return matches[0]?.body ?? null;
}

function requiredSection(
  sections: readonly Section[],
  id: number,
): Uint8Array {
  return optionalSection(sections, id)
    ?? (() => {
      throw new EvidenceError("module-shape-unsupported");
    })();
}

export function parseModule(input: Uint8Array): ModuleShape {
  let sections: Section[];
  try {
    sections = splitSections(input);
  } catch {
    throw new EvidenceError("module-shape-unsupported");
  }
  let types: FunctionType[];
  let definedTypeIndices: number[];
  let bodies: Uint8Array[];
  try {
    types = parseTypes(requiredSection(sections, 1));
    definedTypeIndices = parseIndexVector(requiredSection(sections, 3));
    bodies = parseCode(requiredSection(sections, 10));
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    throw new EvidenceError("module-shape-unsupported");
  }
  if (types.length > MAX_TYPES || bodies.length > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  if (definedTypeIndices.length !== bodies.length) {
    throw new EvidenceError("module-shape-unsupported");
  }
  const importedTypeIndices = parseFunctionImports(optionalSection(sections, 2));
  const functionTypeIndices = [...importedTypeIndices, ...definedTypeIndices];
  if (functionTypeIndices.length > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  for (const typeIndex of functionTypeIndices) {
    if (types[typeIndex] === undefined) {
      throw new EvidenceError("module-shape-unsupported");
    }
  }
  return {
    types,
    functionTypeIndices,
    functionImportCount: importedTypeIndices.length,
    bodies,
    bodySha256: new Array<string | undefined>(bodies.length),
    exports: parseExports(optionalSection(sections, 7)),
    elementSection: optionalSection(sections, 9),
    dataSegments: parseStaticData(optionalSection(sections, 11)),
  };
}

/**
 * One capability-free analysis transaction, bound to the exact byte object and
 * digest. Expensive facts are lazy so requesting one feature does no work for
 * unrelated features; all requested proofs share the same parse and decode.
 */
export function enhancementProofContext(
  input: Uint8Array,
): EnhancementProofContext | null {
  if (input.byteLength > MAX_INPUT_BYTES || !WebAssembly.validate(input)) return null;
  const inputSha256 = createHash("sha256").update(input).digest("hex");
  const cached = proofContexts.get(input);
  if (cached?.inputSha256 === inputSha256) return cached;
  try {
    const module = parseModule(input);
    let tick: TickEvidenceReport | undefined;
    let tableRelations: Map<number, number[]> | undefined;
    const context = Object.freeze({
      inputIdentity: input,
      inputSha256,
      module,
      get tick() {
        return tick ??= tickEvidence(module);
      },
      get tableRelations() {
        return tableRelations ??= parseActiveTableRelations(module.elementSection);
      },
      decodeFunctions(messageAnchors: PlayerChatMessageAnchors | readonly number[]) {
        return decodeFunctions(module, messageAnchors);
      },
    });
    proofContexts.set(input, context);
    return context;
  } catch {
    return null;
  }
}

function parseStaticData(
  bytes: Uint8Array | null,
): readonly Readonly<{ base: number; bytes: Uint8Array }>[] {
  if (!bytes) return [];
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  if (count > MAX_FUNCTIONS) throw new EvidenceError("analysis-limit-exceeded");
  const segments: Readonly<{ base: number; bytes: Uint8Array }>[] = [];
  for (let index = 0; index < count; index += 1) {
    if (readUleb(bytes, cursor) !== 0 || bytes[cursor.offset++] !== 0x41) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const base = readSleb(bytes, cursor);
    if (base < 0 || bytes[cursor.offset++] !== 0x0b) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const size = readUleb(bytes, cursor);
    const end = cursor.offset + size;
    if (end > bytes.byteLength) {
      throw new EvidenceError("module-shape-unsupported");
    }
    segments.push(Object.freeze({
      base,
      bytes: bytes.slice(cursor.offset, end),
    }));
    cursor.offset = end;
  }
  if (cursor.offset !== bytes.byteLength) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return Object.freeze(segments);
}

function exactSignature(
  type: FunctionType | undefined,
  parameterCount: number,
): boolean {
  return Boolean(
    type
    && type.params.length === parameterCount
    && type.params.every((value) => value === I32)
    && type.results.length === 0,
  );
}

export function signatureEvidence(
  module: ModuleShape,
  functionIndex: number,
): FunctionSignatureEvidence | null {
  const typeIndex = module.functionTypeIndices[functionIndex];
  const type = typeIndex === undefined ? undefined : module.types[typeIndex];
  return type
    ? {
      params: type.params.map(valueTypeName),
      results: type.results.map(valueTypeName),
    }
    : null;
}

export function functionHasSignature(
  module: ModuleShape,
  functionIndex: number,
  parameterCount: number,
): boolean {
  const typeIndex = module.functionTypeIndices[functionIndex];
  return exactSignature(
    typeIndex === undefined ? undefined : module.types[typeIndex],
    parameterCount,
  );
}

export function functionBodySha256(module: ModuleShape, functionIndex: number): string {
  const localIndex = functionIndex - module.functionImportCount;
  const body = module.bodies[localIndex];
  if (!body) throw new EvidenceError("module-shape-unsupported");
  const cached = module.bodySha256[localIndex];
  if (cached) return cached;
  const digest = createHash("sha256").update(body).digest("hex");
  module.bodySha256[localIndex] = digest;
  return digest;
}

export function tickEvidence(module: ModuleShape): TickEvidenceReport {
  const exports = module.exports.filter(
    (entry) => entry.name === "EmscriptenExeThreadMainLoop",
  );
  const considered = exports.map((entry) => ({
    functionIndex: entry.index,
    signature: entry.kind === 0
      ? signatureEvidence(module, entry.index)
      : null,
  }));
  const exact = exports.filter(
    (entry) => entry.kind === 0 && functionHasSignature(module, entry.index, 1),
  );
  if (exports.length === 1 && exact.length === 1) {
    const functionIndex = exact[0]!.index;
    return {
      status: "candidate",
      exportCount: 1,
      considered,
      candidate: {
        functionIndex,
        signature: signatureEvidence(module, functionIndex)!,
        bodySha256: functionBodySha256(module, functionIndex),
      },
    };
  }
  return {
    status: exact.length > 1 ? "ambiguous" : "unavailable",
    exportCount: exports.length,
    considered,
    candidate: null,
  };
}

function readInstructionUnsigned(bytes: Uint8Array, cursor: Offset): number {
  try {
    return readUnsigned(bytes, cursor);
  } catch (error) {
    if (
      error instanceof EvidenceError
      && error.code === "module-shape-unsupported"
    ) {
      throw new EvidenceError("instruction-set-unsupported");
    }
    throw error;
  }
}

const decodedFunctionCache = new WeakMap<
  ModuleShape,
  Map<string, DecodedFunction[]>
>();

function trackedMessageValues(
  messageAnchors: PlayerChatMessageAnchors | readonly number[],
): number[] {
  return [...new Set("playerChatMessage" in messageAnchors
    ? [messageAnchors.playerChatMessage, ...messageAnchors.nearbyPlayerMessages]
    : messageAnchors)].sort((left, right) => left - right);
}

export function decodeFunctions(
  module: ModuleShape,
  messageAnchors: PlayerChatMessageAnchors | readonly number[],
): DecodedFunction[] {
  const trackedMessages = new Set(trackedMessageValues(messageAnchors));
  const cacheKey = [...trackedMessages].join(",");
  const moduleCache = decodedFunctionCache.get(module) ?? new Map();
  decodedFunctionCache.set(module, moduleCache);
  const cached = moduleCache.get(cacheKey);
  if (cached) return cached;
  let instructionCount = 0;
  const decoded: DecodedFunction[] = [];
  for (let localIndex = 0; localIndex < module.bodies.length; localIndex += 1) {
    const body = module.bodies[localIndex]!;
    if (body.byteLength > MAX_BODY_BYTES) {
      throw new EvidenceError("analysis-limit-exceeded");
    }
    const cursor = { value: 0 };
    const localGroups = readInstructionUnsigned(body, cursor);
    if (localGroups > MAX_FUNCTIONS) {
      throw new EvidenceError("analysis-limit-exceeded");
    }
    for (let group = 0; group < localGroups; group += 1) {
      readInstructionUnsigned(body, cursor);
      if (cursor.value >= body.byteLength) {
        throw new EvidenceError("instruction-set-unsupported");
      }
      cursor.value += 1;
    }
    const calls = new Map<number, number>();
    const messageSites: Record<number, number> = {};
    while (cursor.value < body.byteLength) {
      instructionCount += 1;
      if (instructionCount > MAX_INSTRUCTIONS) {
        throw new EvidenceError("analysis-limit-exceeded");
      }
      const opcode = body[cursor.value++]!;
      if (
        opcode === 0x00
        || opcode === 0x01
        || opcode === 0x05
        || opcode === 0x0b
        || opcode === 0x0f
        || opcode === 0x1a
        || opcode === 0x1b
        || opcode === 0xd1
        || (opcode >= 0x45 && opcode <= 0xc4)
      ) {
        continue;
      }
      if (opcode >= 0x02 && opcode <= 0x04) {
        if (cursor.value >= body.byteLength) {
          throw new EvidenceError("instruction-set-unsupported");
        }
        const next = body[cursor.value]!;
        if (
          next === 0x40
          || next === 0x7f
          || next === 0x7e
          || next === 0x7d
          || next === 0x7c
          || next === 0x7b
          || next === 0x70
          || next === 0x6f
        ) {
          cursor.value += 1;
        } else {
          readSigned(body, cursor, 5);
        }
        continue;
      }
      if (opcode === 0x0e) {
        const targetCount = readInstructionUnsigned(body, cursor);
        if (targetCount > MAX_FUNCTIONS) {
          throw new EvidenceError("analysis-limit-exceeded");
        }
        for (let index = 0; index <= targetCount; index += 1) {
          readInstructionUnsigned(body, cursor);
        }
        continue;
      }
      if (opcode === 0x11) {
        readInstructionUnsigned(body, cursor);
        readInstructionUnsigned(body, cursor);
        continue;
      }
      if (opcode === 0x1c) {
        const count = readInstructionUnsigned(body, cursor);
        if (count > MAX_TYPES) {
          throw new EvidenceError("analysis-limit-exceeded");
        }
        if (cursor.value + count > body.byteLength) {
          throw new EvidenceError("instruction-set-unsupported");
        }
        cursor.value += count;
        continue;
      }
      if (opcode === 0x41) {
        const value = readSigned(body, cursor, 5);
        if (trackedMessages.has(value)) {
          messageSites[value] = (messageSites[value] ?? 0) + 1;
        }
        continue;
      }
      if (opcode === 0x42) {
        readSigned(body, cursor, 10);
        continue;
      }
      if (opcode === 0x43 || opcode === 0x44) {
        const width = opcode === 0x43 ? 4 : 8;
        if (cursor.value + width > body.byteLength) {
          throw new EvidenceError("instruction-set-unsupported");
        }
        cursor.value += width;
        continue;
      }
      if (opcode >= 0x28 && opcode <= 0x3e) {
        const alignment = readInstructionUnsigned(body, cursor);
        readInstructionUnsigned(body, cursor);
        if ((alignment & 0x40) !== 0) readInstructionUnsigned(body, cursor);
        continue;
      }
      if (opcode === 0x10) {
        const target = readInstructionUnsigned(body, cursor);
        calls.set(target, (calls.get(target) ?? 0) + 1);
        continue;
      }
      if (
        opcode === 0x0c
        || opcode === 0x0d
        || (opcode >= 0x20 && opcode <= 0x26)
        || opcode === 0x3f
        || opcode === 0x40
        || opcode === 0xd2
      ) {
        readInstructionUnsigned(body, cursor);
        continue;
      }
      if (opcode === 0xd0) {
        readSigned(body, cursor, 5);
        continue;
      }
      if (opcode === 0xfc) {
        const subopcode = readInstructionUnsigned(body, cursor);
        let immediateCount: number;
        if (subopcode <= 7) immediateCount = 0;
        else if (subopcode === 8 || subopcode === 10 || subopcode === 12 || subopcode === 14) {
          immediateCount = 2;
        } else if (
          subopcode === 9
          || subopcode === 11
          || subopcode === 13
          || subopcode === 15
          || subopcode === 16
          || subopcode === 17
        ) {
          immediateCount = 1;
        } else {
          throw new EvidenceError("instruction-set-unsupported");
        }
        for (let index = 0; index < immediateCount; index += 1) {
          readInstructionUnsigned(body, cursor);
        }
        continue;
      }
      throw new EvidenceError("instruction-set-unsupported");
    }
    decoded.push({
      functionIndex: module.functionImportCount + localIndex,
      calls,
      messageSites,
    });
  }
  moduleCache.set(cacheKey, decoded);
  return decoded;
}


export function parseActiveTableRelations(
  bytes: Uint8Array | null,
): Map<number, number[]> {
  if (!bytes) return new Map();
  const cursor = { value: 0 };
  let segments: number;
  try {
    segments = readUnsigned(bytes, cursor);
  } catch {
    throw new EvidenceError("active-table-unsupported");
  }
  if (segments > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const slots = new Map<number, number>();
  try {
    for (let segment = 0; segment < segments; segment += 1) {
      const flags = readUnsigned(bytes, cursor);
      let activeBase: number | null = null;
      if (flags === 0 || flags === 2) {
        if (flags === 2 && readUnsigned(bytes, cursor) !== 0) {
          throw new EvidenceError("active-table-unsupported");
        }
        if (bytes[cursor.value++] !== 0x41) {
          throw new EvidenceError("active-table-unsupported");
        }
        activeBase = readSigned(bytes, cursor, 5);
        if (activeBase < 0 || bytes[cursor.value++] !== 0x0b) {
          throw new EvidenceError("active-table-unsupported");
        }
        if (flags === 2 && bytes[cursor.value++] !== 0) {
          throw new EvidenceError("active-table-unsupported");
        }
      } else if (flags === 1 || flags === 3) {
        if (bytes[cursor.value++] !== 0) {
          throw new EvidenceError("active-table-unsupported");
        }
      } else {
        throw new EvidenceError("active-table-unsupported");
      }
      const entries = readUnsigned(bytes, cursor);
      if (entries > MAX_FUNCTIONS) {
        throw new EvidenceError("analysis-limit-exceeded");
      }
      for (let entry = 0; entry < entries; entry += 1) {
        const functionIndex = readUnsigned(bytes, cursor);
        if (activeBase !== null) {
          const slot = activeBase + entry;
          if (!Number.isSafeInteger(slot) || slot > 0xffff_ffff) {
            throw new EvidenceError("active-table-unsupported");
          }
          // Later active segments overwrite earlier ones during instantiation.
          slots.set(slot, functionIndex);
        }
      }
    }
  } catch (error) {
    if (error instanceof EvidenceError) {
      if (error.code === "analysis-limit-exceeded") throw error;
      throw new EvidenceError("active-table-unsupported");
    }
    throw new EvidenceError("active-table-unsupported");
  }
  if (cursor.value !== bytes.byteLength) {
    throw new EvidenceError("active-table-unsupported");
  }
  const byFunction = new Map<number, number[]>();
  for (const [slot, functionIndex] of [...slots].sort(
    ([left], [right]) => left - right,
  )) {
    const values = byFunction.get(functionIndex) ?? [];
    values.push(slot);
    byFunction.set(functionIndex, values);
  }
  return byFunction;
}


export const mutableSpans = (
  entries: readonly (readonly [number, number, string])[],
): readonly RelocationSpan[] => Object.freeze(entries.map(([start, end, role]) =>
  Object.freeze({ start, end, role, addressClass: "mutable-static" as const })));

export const semanticRole = (
  bodyLength: number,
  fingerprint: string,
  spans: readonly RelocationSpan[],
  params: readonly string[],
  results: readonly string[],
): SemanticRole => Object.freeze({ bodyLength, fingerprint, spans, params, results });

export function functionBody(module: ModuleShape, functionIndex: number): Uint8Array {
  const body = module.bodies[functionIndex - module.functionImportCount];
  if (!body) throw new EvidenceError("module-shape-unsupported");
  return body;
}

export function signatureMatches(
  module: ModuleShape,
  functionIndex: number,
  params: readonly string[],
  results: readonly string[],
): boolean {
  const typeIndex = module.functionTypeIndices[functionIndex];
  const signature = typeIndex === undefined ? undefined : module.types[typeIndex];
  return signature !== undefined
    && signature.params.length === params.length
    && signature.results.length === results.length
    && signature.params.every(
      (value, index) => valueTypeName(value) === params[index],
    )
    && signature.results.every(
      (value, index) => valueTypeName(value) === results[index],
    );
}

export function bodyMatchesRole(body: Uint8Array, role: SemanticRole): boolean {
  return body.byteLength === role.bodyLength
    && relocationAwareFingerprint(body, role.spans) === role.fingerprint;
}

export function uniqueRoleFunction(module: ModuleShape, role: SemanticRole): number | null {
  const matches = roleFunctions(module, role);
  return matches.length === 1 ? matches[0]! : null;
}

const roleFunctionCache = new WeakMap<
  ModuleShape,
  WeakMap<SemanticRole, number[]>
>();

export function roleFunctions(module: ModuleShape, role: SemanticRole): number[] {
  const moduleCache = roleFunctionCache.get(module) ?? new WeakMap();
  roleFunctionCache.set(module, moduleCache);
  const cached = moduleCache.get(role);
  if (cached) return cached;
  const matches: number[] = [];
  for (
    let functionIndex = module.functionImportCount;
    functionIndex < module.functionTypeIndices.length;
    functionIndex += 1
  ) {
    const body = functionBody(module, functionIndex);
    if (
      body.byteLength === role.bodyLength
      && signatureMatches(module, functionIndex, role.params, role.results)
      && bodyMatchesRole(body, role)
    ) matches.push(functionIndex);
  }
  moduleCache.set(role, matches);
  return matches;
}

export function uniqueExactFunction(
  module: ModuleShape,
  bodySha256: string,
  params: readonly string[],
  results: readonly string[],
): number | null {
  const matches: number[] = [];
  for (
    let functionIndex = module.functionImportCount;
    functionIndex < module.functionTypeIndices.length;
    functionIndex += 1
  ) {
    if (
      signatureMatches(module, functionIndex, params, results)
      && functionBodySha256(module, functionIndex) === bodySha256
    ) matches.push(functionIndex);
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0]! : null;
}

function encodedU32(body: Uint8Array, start: number, end: number): number {
  const cursor = { value: start };
  const value = readUnsigned(body, cursor);
  if (cursor.value !== end) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return value;
}

export function unsignedOperand(body: Uint8Array, start: number): number {
  const cursor = { value: start };
  return readUnsigned(body, cursor);
}

export function signedOperand(body: Uint8Array, start: number): number {
  const cursor = { value: start };
  return readSigned(body, cursor, 5);
}

export function paddedOperand(value: number): Uint8Array {
  const bytes = new Uint8Array(5);
  let remaining = value >>> 0;
  for (let index = 0; index < 4; index += 1) {
    bytes[index] = (remaining & 0x7f) | 0x80;
    remaining >>>= 7;
  }
  bytes[4] = remaining & 0x0f;
  return bytes;
}

export function codeOperandOccurrences(module: ModuleShape, value: number): number {
  const needle = paddedOperand(value);
  let count = 0;
  for (const body of module.bodies) {
    let offset = body.indexOf(needle[0]!);
    while (offset >= 0 && offset <= body.byteLength - needle.byteLength) {
      if (
        body[offset + 1] === needle[1]
        && body[offset + 2] === needle[2]
        && body[offset + 3] === needle[3]
        && body[offset + 4] === needle[4]
      ) count += 1;
      offset = body.indexOf(needle[0]!, offset + 1);
    }
  }
  return count;
}

export function staticBytes(
  module: ModuleShape,
  address: number,
  length: number,
): Uint8Array | null {
  if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length) || length < 0) {
    return null;
  }
  for (const segment of module.dataSegments) {
    const offset = address - segment.base;
    if (offset >= 0 && offset + length <= segment.bytes.byteLength) {
      return segment.bytes.subarray(offset, offset + length);
    }
  }
  return null;
}

export function staticCStringHash(module: ModuleShape, address: number): string | null {
  for (const segment of module.dataSegments) {
    const offset = address - segment.base;
    if (offset < 0 || offset >= segment.bytes.byteLength) continue;
    const end = segment.bytes.indexOf(0, offset);
    if (end < 0 || end - offset > 4_096) return null;
    return createHash("sha256")
      .update(segment.bytes.subarray(offset, end + 1))
      .digest("hex");
  }
  return null;
}

export function staticBytesHash(
  module: ModuleShape,
  address: number,
  length: number,
): string | null {
  const bytes = staticBytes(module, address, length);
  return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
}

export function staticBytesOccurrenceCount(module: ModuleShape, needle: Uint8Array): number {
  let count = 0;
  for (const segment of module.dataSegments) {
    for (let offset = indexOfBytes(segment.bytes, needle, 0); offset >= 0;) {
      count += 1;
      offset = indexOfBytes(segment.bytes, needle, offset + 1);
    }
  }
  return count;
}

export function valuesForRole(body: Uint8Array, role: SemanticRole): Map<string, number[]> {
  const values = new Map<string, number[]>();
  for (const span of role.spans) {
    const group = values.get(span.role) ?? [];
    group.push(encodedU32(body, span.start, span.end));
    values.set(span.role, group);
  }
  return values;
}

export function soleValue(values: Map<string, number[]>, role: string): number {
  const found = values.get(role) ?? [];
  if (found.length === 0 || found.some((value) => value !== found[0])) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return found[0]!;
}

export function commonRelocationDelta(
  entries: readonly (readonly [number, number])[],
): number | null {
  const deltas = entries.map(([candidate, baseline]) => candidate - baseline);
  return deltas.every((delta) => delta === deltas[0]) ? deltas[0]! : null;
}

export function callsAt(
  body: Uint8Array,
  operands: readonly number[],
  target: number,
): boolean {
  return operands.every((offset) => unsignedOperand(body, offset) === target);
}

export function isolatedProof<Value>(proof: () => Value | null): Value | null {
  try {
    return proof();
  } catch {
    return null;
  }
}
