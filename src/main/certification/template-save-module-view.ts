/**
 * Parses the bounded WebAssembly view used by Template-saving semantic proof.
 * It owns binary decoding only and grants no launch authority.
 */
import {
  countFunctionImports,
  indexOfBytes,
  paddedIndex,
  parseCode,
  parseIndexVector,
  parseTypes,
  readSleb,
  readUleb,
  sectionById,
  splitSections,
  uleb,
  valueTypeName,
  type FunctionType,
} from "../core/wasm-binary.js";

function fail(message: string): never {
  throw new Error(`template-save recertify: ${message}`);
}

function signatureText(type: FunctionType): string {
  const side = (values: number[]) => values.map(valueTypeName).join(",");
  return `(${side(type.params)})->(${side(type.results)})`;
}

function alignUp(value: number, alignment: number): number {
  const aligned = Math.ceil(value / alignment) * alignment;
  if (!Number.isSafeInteger(aligned)) fail("linear-memory boundary is invalid");
  return aligned;
}

function parseInitialMemoryBytes(
  sections: readonly { id: number; body: Uint8Array }[],
): number {
  const memory = sections.find((entry) => entry.id === 5)
    ?? fail("missing memory section");
  const cursor = { offset: 0 };
  const count = readUleb(memory.body, cursor);
  const flags = readUleb(memory.body, cursor);
  const initialPages = readUleb(memory.body, cursor);
  if (count !== 1 || (flags !== 0 && flags !== 1)) {
    fail("unsupported memory declaration");
  }
  if (flags === 1) readUleb(memory.body, cursor);
  if (cursor.offset !== memory.body.byteLength) fail("malformed memory section");
  const initialBytes = initialPages * 65_536;
  if (!Number.isSafeInteger(initialBytes)) fail("initial memory size is invalid");
  return initialBytes;
}

function parseDataSegments(
  sections: readonly { id: number; body: Uint8Array }[],
): { base: number; bytes: Uint8Array }[] {
  const section = sections.find((entry) => entry.id === 11);
  if (!section) return [];
  const bytes = section.body;
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const segments: { base: number; bytes: Uint8Array }[] = [];
  for (let index = 0; index < count; index += 1) {
    const flags = readUleb(bytes, cursor);
    if (flags !== 0) fail("unsupported data segment flags");
    if (bytes[cursor.offset++] !== 0x41) fail("unsupported data segment offset");
    const base = readSleb(bytes, cursor);
    if (bytes[cursor.offset++] !== 0x0b) fail("malformed data segment offset");
    const size = readUleb(bytes, cursor);
    if (cursor.offset + size > bytes.byteLength) fail("truncated data segment");
    segments.push({ base, bytes: bytes.slice(cursor.offset, cursor.offset + size) });
    cursor.offset += size;
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed data section");
  return segments;
}

export function templateCallNeedle(functionIndex: number): Uint8Array {
  const padded = paddedIndex(functionIndex);
  const needle = new Uint8Array(padded.byteLength + 1);
  needle[0] = 0x10;
  needle.set(padded, 1);
  return needle;
}

/** Parsed module facts shared by every template locator and semantic proof. */
export class TemplateSaveModuleView {
  readonly input: Uint8Array;
  readonly importSection: Uint8Array;
  readonly importCount: number;
  readonly bodies: Uint8Array[];
  readonly signatures: string[];
  readonly dataSegments: { base: number; bytes: Uint8Array }[];
  readonly zeroInitializedBase: number;
  readonly initialMemoryBytes: number;
  private readonly callerCache = new Map<number, Set<number>>();

  constructor(input: Uint8Array) {
    this.input = input;
    const sections = splitSections(input);
    this.importSection = sectionById(sections, 2);
    this.importCount = countFunctionImports(this.importSection);
    const types = parseTypes(sectionById(sections, 1));
    this.signatures = parseIndexVector(sectionById(sections, 3)).map(
      (index) => signatureText(types[index] ?? fail(`unknown type ${index}`)),
    );
    this.bodies = parseCode(sectionById(sections, 10));
    if (this.signatures.length !== this.bodies.length) {
      fail("function and code sections disagree");
    }
    this.dataSegments = parseDataSegments(sections);
    this.zeroInitializedBase = alignUp(
      this.dataSegments.reduce(
        (end, segment) => Math.max(end, segment.base + segment.bytes.byteLength),
        0,
      ),
      16,
    );
    this.initialMemoryBytes = parseInitialMemoryBytes(sections);
    if (
      this.zeroInitializedBase > this.initialMemoryBytes
      || this.dataSegments.some(
        (segment) => segment.base < 0
          || segment.base + segment.bytes.byteLength > this.initialMemoryBytes,
      )
    ) {
      fail("data segments lie outside the initial memory");
    }
  }

  functionIndex(local: number): number {
    return this.importCount + local;
  }

  callers(functionIndex: number): Set<number> {
    const cached = this.callerCache.get(functionIndex);
    if (cached) return cached;
    const needle = templateCallNeedle(functionIndex);
    const found = new Set<number>();
    this.bodies.forEach((body, local) => {
      if (indexOfBytes(body, needle, 0) >= 0) found.add(local);
    });
    this.callerCache.set(functionIndex, found);
    return found;
  }

  callSites(caller: number, functionIndex: number): number[] {
    const body = this.bodies[caller] ?? fail(`function ${caller} is out of range`);
    const needle = templateCallNeedle(functionIndex);
    const offsets: number[] = [];
    for (let at = indexOfBytes(body, needle, 0); at >= 0;) {
      offsets.push(at);
      at = indexOfBytes(body, needle, at + 1);
    }
    return offsets;
  }

  readString(address: number): string | null {
    for (const segment of this.dataSegments) {
      const offset = address - segment.base;
      if (offset < 0 || offset >= segment.bytes.byteLength) continue;
      let end = offset;
      while (end < segment.bytes.byteLength && segment.bytes[end] !== 0) end += 1;
      if (end === segment.bytes.byteLength) return null;
      return new TextDecoder().decode(segment.bytes.slice(offset, end));
    }
    return null;
  }

  readData(address: number, length: number): Uint8Array | null {
    for (const segment of this.dataSegments) {
      const offset = address - segment.base;
      if (offset < 0 || offset + length > segment.bytes.byteLength) continue;
      return segment.bytes.slice(offset, offset + length);
    }
    return null;
  }

  dataOccurrenceCount(needle: Uint8Array): number {
    return this.dataAddresses(needle).length;
  }

  dataAddresses(needle: Uint8Array): number[] {
    const addresses: number[] = [];
    for (const segment of this.dataSegments) {
      for (let at = indexOfBytes(segment.bytes, needle, 0); at >= 0;) {
        addresses.push(segment.base + at);
        at = indexOfBytes(segment.bytes, needle, at + 1);
      }
    }
    return addresses;
  }

  containsInitializedData(address: number): boolean {
    return this.dataSegments.some((segment) =>
      address >= segment.base
      && address < segment.base + segment.bytes.byteLength);
  }

  stringOccurrenceCount(value: string): number {
    const needle = new TextEncoder().encode(`${value}\0`);
    let count = 0;
    for (const segment of this.dataSegments) {
      for (let at = indexOfBytes(segment.bytes, needle, 0); at >= 0;) {
        count += 1;
        at = indexOfBytes(segment.bytes, needle, at + 1);
      }
    }
    return count;
  }
}

/** Possible canonical calls are diagnostic only; exact padded call counts gate. */
export function canonicalTemplateCallCount(
  view: TemplateSaveModuleView,
  functionIndex: number,
): number {
  const canonical = uleb(functionIndex);
  const needle = new Uint8Array(canonical.byteLength + 1);
  needle[0] = 0x10;
  needle.set(canonical, 1);
  let total = 0;
  for (const body of view.bodies) {
    for (let at = indexOfBytes(body, needle, 0); at >= 0;) {
      total += 1;
      at = indexOfBytes(body, needle, at + 1);
    }
  }
  return total;
}

export function intersectFunctionSets(
  left: Set<number>,
  right: Set<number>,
): number[] {
  return [...left].filter((value) => right.has(value)).sort((a, b) => a - b);
}

export function onlyFunction(
  candidates: readonly number[],
  what: string,
  extra = "",
): number {
  if (candidates.length === 1) return candidates[0]!;
  fail(
    `expected exactly one ${what}, found ${candidates.length}`
      + ` [${candidates.join(", ")}]${extra ? `. ${extra}` : ""}`,
  );
}
