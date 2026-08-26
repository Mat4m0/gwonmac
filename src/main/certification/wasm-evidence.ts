/**
 * Bounded, capability-free WASM parsing and relationship primitives for proofs.
 * Only feature modules may turn its facts into authority.
 */
import { createHash } from "node:crypto";
import {
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
  FunctionSignatureEvidence,
  ModuleShape,
  SemanticRole,
  WasmExport,
} from "./enhancement-evidence-types.js";
import { decodeFunctions } from "./wasm-instruction-evidence.js";
export { decodeFunctions } from "./wasm-instruction-evidence.js";
import { EvidenceError } from "./wasm-evidence-error.js";
import { dataEvidence, type WasmDataEvidence } from "./wasm-data-evidence.js";
import { readonlyMapView } from "./readonly-map-view.js";
export { EvidenceError } from "./wasm-evidence-error.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_TYPES = 100_000;
const MAX_FUNCTIONS = 100_000;
export const MAX_CONSIDERED = 4_096;

export interface WasmEvidence {
  readonly inputIdentity: Uint8Array;
  readonly inputSha256: string;
  readonly moduleView: () => ModuleShape;
  readonly tableRelations: ReadonlyMap<number, readonly number[]>;
  readonly data: WasmDataEvidence;
  readonly decodeFunctions: (
    trackedConstants: readonly number[],
  ) => DecodedFunction[];
}

/** Compatibility name while feature-owned locators migrate independently. */
export type EnhancementProofContext = WasmEvidence;

const proofContexts = new WeakMap<Uint8Array, WasmEvidence>();

const I32 = 0x7f;

function copyBytes(bytes: Uint8Array | null): Uint8Array | null {
  return bytes?.slice() ?? null;
}

function cloneModuleShape(module: ModuleShape): ModuleShape {
  return {
    types: module.types.map((type) => ({
      params: [...type.params],
      results: [...type.results],
    })),
    functionTypeIndices: [...module.functionTypeIndices],
    functionImportCount: module.functionImportCount,
    bodies: module.bodies.map((body) => body.slice()),
    exports: module.exports.map((entry) => ({ ...entry })),
    importSection: copyBytes(module.importSection),
    memorySection: copyBytes(module.memorySection),
    tableSection: copyBytes(module.tableSection),
    elementSection: copyBytes(module.elementSection),
    dataSegments: module.dataSegments.map((segment) => ({
      base: segment.base,
      bytes: segment.bytes.slice(),
    })),
  };
}

interface Offset {
  value: number;
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

function parseModule(input: Uint8Array): ModuleShape {
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
    exports: parseExports(optionalSection(sections, 7)),
    importSection: optionalSection(sections, 2),
    memorySection: optionalSection(sections, 5),
    tableSection: optionalSection(sections, 4),
    elementSection: optionalSection(sections, 9),
    dataSegments: parseStaticData(optionalSection(sections, 11)),
  };
}

/**
 * One capability-free analysis transaction, bound to the exact byte object and
 * digest. Expensive facts are lazy so requesting one feature does no work for
 * unrelated features; all requested proofs share the same parse and decode.
 */
export function wasmEvidence(
  input: Uint8Array,
): WasmEvidence | null {
  if (input.byteLength > MAX_INPUT_BYTES || !WebAssembly.validate(input)) return null;
  const inputSha256 = createHash("sha256").update(input).digest("hex");
  const cached = proofContexts.get(input);
  if (cached?.inputSha256 === inputSha256) return cached;
  try {
    const module = parseModule(input);
    let tableRelations: ReadonlyMap<number, readonly number[]> | undefined;
    let data: WasmDataEvidence | undefined;
    const context = Object.freeze({
      inputIdentity: input,
      inputSha256,
      moduleView() {
        return cloneModuleShape(module);
      },
      get data() {
        return data ??= dataEvidence(module);
      },
      get tableRelations() {
        return tableRelations ??= parseActiveTableRelations(module.elementSection);
      },
      decodeFunctions(trackedConstants: readonly number[]) {
        return decodeFunctions(module, trackedConstants);
      },
    });
    proofContexts.set(input, context);
    return context;
  } catch {
    return null;
  }
}

export const enhancementProofContext = wasmEvidence;

export function matchesEvidenceInput(
  evidence: WasmEvidence | null | undefined,
  input: Uint8Array,
): evidence is WasmEvidence {
  return evidence?.inputIdentity === input
    && evidence.inputSha256 === createHash("sha256").update(input).digest("hex");
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

const bodyHashCache = new WeakMap<ModuleShape, (string | undefined)[]>();

export function functionBodySha256(module: ModuleShape, functionIndex: number): string {
  const localIndex = functionIndex - module.functionImportCount;
  const body = module.bodies[localIndex];
  if (!body) throw new EvidenceError("module-shape-unsupported");
  const hashes = bodyHashCache.get(module) ?? new Array<string | undefined>(module.bodies.length);
  bodyHashCache.set(module, hashes);
  const cached = hashes[localIndex];
  if (cached) return cached;
  const digest = createHash("sha256").update(body).digest("hex");
  hashes[localIndex] = digest;
  return digest;
}

export function activeTableEvidence(
  bytes: Uint8Array | null,
): Readonly<{
  relations: ReadonlyMap<number, readonly number[]>;
  overwrittenSlots: readonly number[];
}> {
  if (!bytes) return { relations: new Map(), overwrittenSlots: [] };
  const cursor = { value: 0 };
  const overwrittenSlots: number[] = [];
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
          if (slots.has(slot)) overwrittenSlots.push(slot);
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
  for (const [functionIndex, values] of byFunction) {
    byFunction.set(functionIndex, Object.freeze(values) as number[]);
  }
  return {
    relations: readonlyMapView(byFunction),
    overwrittenSlots: Object.freeze(overwrittenSlots),
  };
}

export function parseActiveTableRelations(
  bytes: Uint8Array | null,
): ReadonlyMap<number, readonly number[]> {
  return activeTableEvidence(bytes).relations;
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
  WeakMap<SemanticRole, readonly number[]>
>();

export function roleFunctions(module: ModuleShape, role: SemanticRole): readonly number[] {
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
  const immutableMatches = Object.freeze(matches);
  moduleCache.set(role, immutableMatches);
  return immutableMatches;
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
  return dataEvidence(module).readBytes(address, length);
}

export function staticCStringHash(module: ModuleShape, address: number): string | null {
  const value = dataEvidence(module).readCString(address);
  return value === null
    ? null
    : createHash("sha256").update(`${value}\0`).digest("hex");
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
  return dataEvidence(module).addresses(needle).length;
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
