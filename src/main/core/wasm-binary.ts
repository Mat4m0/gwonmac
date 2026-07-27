// WebAssembly section codec shared by everything that rewrites or inspects
// ArenaNet's client: the Enhancement transform, the template-save compatibility
// transform, and the re-certifier that re-derives a build entry.
//
// Callers keep their own domain-prefixed `fail()` for their own invariants;
// everything here throws `wasm: …` so a structural fault is distinguishable
// from a policy one.

export interface Section {
  id: number;
  body: Uint8Array;
}

export interface Cursor {
  offset: number;
}

export interface FunctionType {
  params: number[];
  results: number[];
}

export const WASM_HEADER = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);

/** Width LLVM uses for relocatable call targets, so a repoint fits in place. */
export const PADDED_INDEX_BYTES = 5;

const VALUE_TYPE_NAMES = new Map([
  [0x7f, "i32"],
  [0x7e, "i64"],
  [0x7d, "f32"],
  [0x7c, "f64"],
]);

function fail(message: string): never {
  throw new Error(`wasm: ${message}`);
}

/**
 * A real copy, whatever the caller passed. `Buffer.prototype.slice` returns a
 * view, so slicing a `readFile` result would hand out aliases into the caller's
 * input — and a transform that rewrites a body would then corrupt it.
 */
function copyRange(bytes: Uint8Array, start: number, end: number): Uint8Array {
  return new Uint8Array(bytes.subarray(start, end));
}

export function valueTypeName(value: number): string {
  return VALUE_TYPE_NAMES.get(value) ?? `0x${value.toString(16)}`;
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function uleb(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid unsigned value");
  const out: number[] = [];
  do {
    const byte = value & 0x7f;
    value = Math.floor(value / 128);
    out.push(value === 0 ? byte : byte | 0x80);
  } while (value !== 0);
  return Uint8Array.from(out);
}

export function sleb(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) fail("invalid signed value");
  const out: number[] = [];
  for (;;) {
    const byte = value & 0x7f;
    value >>= 7;
    const sign = (byte & 0x40) !== 0;
    if ((value === 0 && !sign) || (value === -1 && sign)) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    out.push(byte | 0x80);
  }
}

/**
 * Deliberately capped at five bytes: this module is read-only over an 8 MB
 * client, and a wider read would silently accept a malformed index rather than
 * reporting it.
 */
export function readUleb(bytes: Uint8Array, cursor: Cursor): number {
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

export function readSleb(bytes: Uint8Array, cursor: Cursor): number {
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

/**
 * Fixed-width index, so a rewritten `call` stays byte-for-byte as long. The
 * bound is checked up front because `>>>` truncates to 32 bits, which would
 * make a trailing check silently unreachable.
 */
export function paddedIndex(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    fail("index does not fit the padded call width");
  }
  const out = new Uint8Array(PADDED_INDEX_BYTES);
  for (let index = 0; index < PADDED_INDEX_BYTES; index += 1) {
    out[index] = (value & 0x7f) | (index === PADDED_INDEX_BYTES - 1 ? 0 : 0x80);
    value >>>= 7;
  }
  return out;
}

export function splitSections(bytes: Uint8Array): Section[] {
  if (
    bytes.byteLength < WASM_HEADER.byteLength
    || !WASM_HEADER.every((byte, index) => bytes[index] === byte)
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
    sections.push({ id, body: copyRange(bytes, cursor.offset, end) });
    cursor.offset = end;
  }
  return sections;
}

export function sectionById(
  sections: readonly Section[],
  id: number,
): Uint8Array {
  return (
    sections.find((section) => section.id === id)?.body
    ?? fail(`missing section ${id}`)
  );
}

export function encodeSection(section: Section): Uint8Array {
  return concat(
    Uint8Array.of(section.id),
    uleb(section.body.byteLength),
    section.body,
  );
}

export function parseTypes(bytes: Uint8Array): FunctionType[] {
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

export function parseIndexVector(bytes: Uint8Array): number[] {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) values.push(readUleb(bytes, cursor));
  if (cursor.offset !== bytes.byteLength) fail("malformed index vector");
  return values;
}

export function encodeIndexVector(values: readonly number[]): Uint8Array {
  return concat(uleb(values.length), ...values.map(uleb));
}

export function parseCode(bytes: Uint8Array): Uint8Array[] {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const bodies: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    const size = readUleb(bytes, cursor);
    const end = cursor.offset + size;
    if (end > bytes.byteLength) fail("truncated function body");
    bodies.push(copyRange(bytes, cursor.offset, end));
    cursor.offset = end;
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed code section");
  return bodies;
}

export function encodeCode(bodies: readonly Uint8Array[]): Uint8Array {
  return concat(
    uleb(bodies.length),
    ...bodies.map((body) => concat(uleb(body.byteLength), body)),
  );
}

function skipLimits(bytes: Uint8Array, cursor: Cursor): void {
  const flags = readUleb(bytes, cursor);
  readUleb(bytes, cursor);
  if ((flags & 1) !== 0) readUleb(bytes, cursor);
}

/**
 * Walk the import section, reporting each imported function in order. Function
 * indices start at the imports, so the callback index is the function index.
 */
function eachFunctionImport(
  bytes: Uint8Array,
  visit: (index: number, module: string, name: string) => void,
): number {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const text = new TextDecoder();
  let functions = 0;
  for (let i = 0; i < count; i += 1) {
    const moduleLength = readUleb(bytes, cursor);
    const module = text.decode(
      bytes.slice(cursor.offset, cursor.offset + moduleLength),
    );
    cursor.offset += moduleLength;
    const nameLength = readUleb(bytes, cursor);
    const name = text.decode(
      bytes.slice(cursor.offset, cursor.offset + nameLength),
    );
    cursor.offset += nameLength;
    const kind = bytes[cursor.offset++]!;
    if (kind === 0) {
      visit(functions, module, name);
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

export function countFunctionImports(bytes: Uint8Array): number {
  return eachFunctionImport(bytes, () => {});
}

/** Function index of an imported function by field name, or null. */
export function functionImportIndex(
  bytes: Uint8Array,
  name: string,
): number | null {
  let found: number | null = null;
  eachFunctionImport(bytes, (index, _module, field) => {
    if (field === name && found === null) found = index;
  });
  return found;
}
