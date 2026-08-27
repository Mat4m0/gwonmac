/**
 * Bounded queries over initialized and zero-initialized linear memory.
 * Consumers receive copies or immutable occurrence lists, never owned storage.
 */
import { indexOfBytes, readUleb } from "../core/wasm-binary.js";
import type { ModuleShape } from "./enhancement-evidence-types.js";
import { EvidenceError } from "./wasm-evidence-error.js";

const MAX_DATA_OCCURRENCES = 4_096;
const MAX_CSTRING_BYTES = 4_096;
const dataEvidenceCache = new WeakMap<ModuleShape, WasmDataEvidence>();

function initialMemoryBytes(memory: Uint8Array | null): number {
  if (!memory) throw new EvidenceError("module-shape-unsupported");
  const cursor = { offset: 0 };
  const count = readUleb(memory, cursor);
  const flags = readUleb(memory, cursor);
  const pages = readUleb(memory, cursor);
  if (count !== 1 || (flags !== 0 && flags !== 1)) {
    throw new EvidenceError("module-shape-unsupported");
  }
  if (flags === 1) readUleb(memory, cursor);
  if (cursor.offset !== memory.byteLength) {
    throw new EvidenceError("module-shape-unsupported");
  }
  const bytes = pages * 65_536;
  if (!Number.isSafeInteger(bytes)) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return bytes;
}

export class WasmDataEvidence {
  readonly initialMemoryBytes: number;
  readonly initializedDataEnd: number;
  readonly zeroInitializedBase: number;
  private readonly module: ModuleShape;

  constructor(module: ModuleShape) {
    this.module = module;
    this.initialMemoryBytes = initialMemoryBytes(module.memorySection);
    this.initializedDataEnd = module.dataSegments.reduce(
      (end, segment) => Math.max(end, segment.base + segment.bytes.byteLength),
      0,
    );
    this.zeroInitializedBase = Math.ceil(this.initializedDataEnd / 16) * 16;
    if (
      !Number.isSafeInteger(this.zeroInitializedBase)
      || this.zeroInitializedBase > this.initialMemoryBytes
      || module.dataSegments.some((segment) =>
        segment.base < 0
        || segment.base + segment.bytes.byteLength > this.initialMemoryBytes)
    ) throw new EvidenceError("module-shape-unsupported");
  }

  readCString(address: number): string | null {
    for (const segment of this.module.dataSegments) {
      const offset = address - segment.base;
      if (offset < 0 || offset >= segment.bytes.byteLength) continue;
      const end = segment.bytes.indexOf(0, offset);
      if (end < 0 || end - offset > MAX_CSTRING_BYTES) return null;
      return new TextDecoder().decode(segment.bytes.slice(offset, end));
    }
    return null;
  }

  readBytes(address: number, length: number): Uint8Array | null {
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length) || length < 0) {
      return null;
    }
    for (const segment of this.module.dataSegments) {
      const offset = address - segment.base;
      if (offset >= 0 && offset + length <= segment.bytes.byteLength) {
        return segment.bytes.slice(offset, offset + length);
      }
    }
    return null;
  }

  addresses(needle: Uint8Array): readonly number[] {
    if (needle.byteLength === 0) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const addresses: number[] = [];
    for (const segment of this.module.dataSegments) {
      for (let at = indexOfBytes(segment.bytes, needle, 0); at >= 0;) {
        addresses.push(segment.base + at);
        if (addresses.length > MAX_DATA_OCCURRENCES) {
          throw new EvidenceError("analysis-limit-exceeded");
        }
        at = indexOfBytes(segment.bytes, needle, at + 1);
      }
    }
    return Object.freeze(addresses);
  }

  contains(address: number): boolean {
    return this.module.dataSegments.some((segment) =>
      address >= segment.base
      && address < segment.base + segment.bytes.byteLength);
  }
}

export function dataEvidence(module: ModuleShape): WasmDataEvidence {
  const cached = dataEvidenceCache.get(module);
  if (cached) return cached;
  const evidence = new WasmDataEvidence(module);
  dataEvidenceCache.set(module, evidence);
  return evidence;
}
