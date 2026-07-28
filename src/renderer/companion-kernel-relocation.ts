const HEADER_BYTES = 8;
const CODE_SECTION = 10;
const DATA_SECTION = 11;
const MEMORY_ADDR_SLEB = 4;
const MEMORY_ADDR_I32 = 5;
const ALIGNMENT = 16;

interface Cursor { offset: number }
interface Section {
  id: number;
  bodyOffset: number;
  bodyBytes: number;
  standardIndex: number | null;
  customName?: string;
  customPayloadOffset?: number;
}

export interface RelocatableCompanionKernel {
  readonly allocationBytes: number;
  relocate(dataAddress: number): Uint8Array;
}

function fail(message: string): never {
  throw new Error(`Companion kernel relocation failed: ${message}`);
}

function readUleb(bytes: Uint8Array, cursor: Cursor): number {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 5; count += 1) {
    if (cursor.offset >= bytes.byteLength) fail("truncated unsigned value");
    const byte = bytes[cursor.offset++]!;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return value;
    multiplier *= 128;
  }
  return fail("oversized unsigned value");
}

function readSleb(bytes: Uint8Array, cursor: Cursor): number {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 5; count += 1) {
    if (cursor.offset >= bytes.byteLength) fail("truncated signed value");
    const byte = bytes[cursor.offset++]!;
    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    if ((byte & 0x80) === 0) {
      if ((byte & 0x40) !== 0) value -= multiplier;
      return value;
    }
  }
  return fail("oversized signed value");
}

function writePaddedSleb(
  bytes: Uint8Array,
  offset: number,
  value: number,
  width = 5,
): void {
  const maximum = Math.min(0x7fff_ffff, 2 ** (7 * width - 1) - 1);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail("relocated address is outside i32 memory");
  }
  for (let index = 0; index < width; index += 1) {
    bytes[offset + index] =
      (value & 0x7f) | (index === width - 1 ? 0 : 0x80);
    value = Math.floor(value / 128);
  }
}

function parseSections(bytes: Uint8Array): Section[] {
  if (
    bytes.byteLength < HEADER_BYTES
    || bytes[0] !== 0
    || bytes[1] !== 0x61
    || bytes[2] !== 0x73
    || bytes[3] !== 0x6d
  ) {
    fail("invalid WebAssembly header");
  }
  const sections: Section[] = [];
  const cursor = { offset: HEADER_BYTES };
  let standardIndex = 0;
  while (cursor.offset < bytes.byteLength) {
    const id = bytes[cursor.offset++]!;
    const bodyBytes = readUleb(bytes, cursor);
    const bodyOffset = cursor.offset;
    const end = bodyOffset + bodyBytes;
    if (end > bytes.byteLength) fail("truncated section");
    const section: Section = {
      id,
      bodyOffset,
      bodyBytes,
      standardIndex: id === 0 ? null : standardIndex++,
    };
    if (id === 0) {
      const custom = { offset: bodyOffset };
      const nameBytes = readUleb(bytes, custom);
      const nameEnd = custom.offset + nameBytes;
      if (nameEnd > end) fail("truncated custom section name");
      section.customName =
        new TextDecoder().decode(bytes.subarray(custom.offset, nameEnd));
      section.customPayloadOffset = nameEnd;
    }
    sections.push(section);
    cursor.offset = end;
  }
  return sections;
}

function relocationHasAddend(type: number): boolean {
  return [
    3, 4, 5, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25,
  ].includes(type);
}

/**
 * LLVM's relocation records are the sole authority for rewritten addresses.
 * A new memory-relocation shape fails closed instead of scanning constants.
 */
export function inspectCompanionKernel(
  input: ArrayBuffer | Uint8Array,
): RelocatableCompanionKernel {
  const source = new Uint8Array(input);
  const sections = parseSections(source);
  const code = sections.find((section) => section.id === CODE_SECTION);
  const data = sections.find((section) => section.id === DATA_SECTION);
  if (!code || !data) fail("missing code or data section");

  const dataCursor = { offset: data.bodyOffset };
  if (readUleb(source, dataCursor) !== 1) fail("expected one data segment");
  if (readUleb(source, dataCursor) !== 0) fail("expected active data");
  if (source[dataCursor.offset++] !== 0x41) fail("expected constant data address");
  const addressOffset = dataCursor.offset;
  const sourceAddress = readSleb(source, dataCursor);
  const addressBytes = dataCursor.offset - addressOffset;
  if (addressBytes < 1 || source[dataCursor.offset++] !== 0x0b) {
    fail("expected data address");
  }
  const dataBytes = readUleb(source, dataCursor);
  if (
    dataBytes < 1
    || dataCursor.offset + dataBytes !== data.bodyOffset + data.bodyBytes
  ) {
    fail("malformed data image");
  }

  const relocations: Array<{ type: number; offset: number }> = [];
  for (const section of sections) {
    if (section.customName !== "reloc.CODE" && section.customName !== "reloc.DATA") {
      continue;
    }
    const target = section.customName === "reloc.CODE" ? code : data;
    const cursor = { offset: section.customPayloadOffset! };
    if (readUleb(source, cursor) !== target.standardIndex) {
      fail(`${section.customName} targets the wrong section`);
    }
    const count = readUleb(source, cursor);
    for (let index = 0; index < count; index += 1) {
      const type = readUleb(source, cursor);
      const offset = readUleb(source, cursor);
      readUleb(source, cursor);
      if (relocationHasAddend(type)) readSleb(source, cursor);
      if (type === MEMORY_ADDR_SLEB || type === MEMORY_ADDR_I32) {
        relocations.push({ type, offset: target.bodyOffset + offset });
      } else if (
        type === 3
        || type === 11
        || type >= 14 && type <= 17
        || type === 21
        || type === 23
        || type === 25
      ) {
        fail(`unsupported memory relocation type ${type}`);
      }
    }
    if (cursor.offset !== section.bodyOffset + section.bodyBytes) {
      fail(`malformed ${section.customName}`);
    }
  }
  if (relocations.length === 0) fail("missing memory relocations");

  return {
    allocationBytes: dataBytes + ALIGNMENT - 1,
    relocate(dataAddress: number): Uint8Array {
      if (
        !Number.isSafeInteger(dataAddress)
        || dataAddress < 1
        || dataAddress % ALIGNMENT !== 0
        || dataAddress + dataBytes > 0x8000_0000
      ) {
        fail("invalid destination address");
      }
      const output = new Uint8Array(source);
      const delta = dataAddress - sourceAddress;
      writePaddedSleb(output, addressOffset, dataAddress, addressBytes);
      for (const relocation of relocations) {
        if (relocation.type === MEMORY_ADDR_SLEB) {
          const cursor = { offset: relocation.offset };
          const address = readSleb(output, cursor);
          if (cursor.offset - relocation.offset !== 5) {
            fail("memory address is not padded");
          }
          writePaddedSleb(output, relocation.offset, address + delta);
        } else {
          const view = new DataView(
            output.buffer,
            output.byteOffset + relocation.offset,
            4,
          );
          view.setUint32(0, view.getUint32(0, true) + delta, true);
        }
      }
      return output;
    },
  };
}
