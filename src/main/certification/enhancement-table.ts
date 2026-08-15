/**
 * The Enhancement transform's one-table contract, shared by read-only
 * candidate inspection and the certified module rewrite.
 */
import {
  concat,
  readSleb,
  readUleb,
  uleb,
} from "../core/wasm-binary.js";

function fail(message: string): never {
  throw new Error(`enhancement table: ${message}`);
}

export function parseEnhancementTable(bytes: Uint8Array): {
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

export function encodeEnhancementTable(
  flags: number,
  min: number,
  max: number,
): Uint8Array {
  return concat(
    uleb(1),
    Uint8Array.of(0x70),
    uleb(flags),
    uleb(min),
    uleb(max),
  );
}

export function enhancementTableSlotFunctions(
  bytes: Uint8Array,
): Map<number, number> {
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
    for (let index = 0; index < entries; index += 1) {
      const functionIndex = readUleb(bytes, cursor);
      const slot = base + index;
      if (slots.has(slot)) fail(`duplicate active table slot ${slot}`);
      slots.set(slot, functionIndex);
    }
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed element section");
  return slots;
}
