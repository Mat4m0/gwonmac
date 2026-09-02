/**
 * Strict reader for the original TexMod TPF container. It accepts only the
 * legacy XOR + ZipCrypto ZIP variant and returns bounded in-memory mappings.
 */
import { inflateRawSync } from "node:zlib";
import type { TexturePackFailureCode } from "../../shared/texture-packs.js";

const XOR_KEY = [0xa4, 0x3f, 0xa4, 0x3f] as const;
const TPF_PASSWORD = Uint8Array.from([
  0x73, 0x2a, 0x63, 0x7d, 0x5f, 0x0a, 0xa6, 0xbd, 0x7d, 0x65, 0x7e, 0x67,
  0x61, 0x2a, 0x7f, 0x7f, 0x74, 0x61, 0x67, 0x5b, 0x60, 0x70, 0x45, 0x74,
  0x5c, 0x22, 0x74, 0x5d, 0x6e, 0x6a, 0x73, 0x41, 0x77, 0x6e, 0x46, 0x47,
  0x77, 0x49, 0x0c, 0x4b, 0x46, 0x6f,
]);
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 1_024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_DEFINITION_BYTES = 1024 * 1024;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crcUpdate(crc: number, byte: number): number {
  return (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcUpdate(crc, byte);
  return (crc ^ 0xffffffff) >>> 0;
}

export class TpfError extends Error {
  readonly code: TexturePackFailureCode;

  constructor(code: TexturePackFailureCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly modifiedTime: number;
  readonly crc: number;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly localOffset: number;
}

export interface TpfMapping {
  readonly target: number;
  readonly name: string;
  readonly bytes: Uint8Array;
}

function safeName(name: string): boolean {
  if (!name || name.includes("\0") || name.startsWith("/") || name.startsWith("\\")) return false;
  const parts = name.replaceAll("\\", "/").split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  return new TextDecoder(utf8 ? "utf-8" : "windows-1252", { fatal: true }).decode(bytes);
}

function xorDecode(source: Uint8Array): Uint8Array {
  if (source.byteLength < 22 || source.byteLength > MAX_SOURCE_BYTES) {
    throw new TpfError("limit_exceeded", "TPF size is outside the supported range");
  }
  // Buffer.slice() aliases its input. Copy explicitly so validation can never
  // mutate the exact source bytes the manager later publishes.
  const decoded = Uint8Array.from(source);
  for (let index = 0; index < decoded.byteLength; index += 1) {
    decoded[index] = decoded[index]! ^ XOR_KEY[index & 3]!;
  }
  if (decoded[0] !== 0x50 || decoded[1] !== 0x4b || decoded[2] !== 0x03 || decoded[3] !== 0x04) {
    throw new TpfError("not_tpf", "file does not contain a legacy TexMod archive");
  }
  return decoded;
}

function findEndRecord(bytes: Uint8Array): number {
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) return offset;
  }
  throw new TpfError("tpf_corrupt", "ZIP end record is missing");
}

function parseEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(bytes);
  const disk = view.getUint16(end + 4, true);
  const directoryDisk = view.getUint16(end + 6, true);
  const count = view.getUint16(end + 10, true);
  const directoryBytes = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (disk !== 0 || directoryDisk !== 0 || count === 0xffff || directoryBytes === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new TpfError("unsupported_tpf_variant", "split and Zip64 archives are not supported");
  }
  if (count === 0 || count > MAX_ENTRIES || directoryOffset > bytes.byteLength - directoryBytes) {
    throw new TpfError("limit_exceeded", "TPF entry table is outside the supported range");
  }
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  let expandedTotal = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset > bytes.byteLength - 46 || view.getUint32(offset, true) !== 0x02014b50) {
      throw new TpfError("tpf_corrupt", "ZIP directory entry is invalid");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const modifiedTime = view.getUint16(offset + 12, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedBytes = view.getUint32(offset + 20, true);
    const expandedBytes = view.getUint32(offset + 24, true);
    const nameBytes = view.getUint16(offset + 28, true);
    const extraBytes = view.getUint16(offset + 30, true);
    const commentBytes = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (next > bytes.byteLength || nameBytes === 0 || compressedBytes > MAX_ENTRY_BYTES || expandedBytes > MAX_ENTRY_BYTES) {
      throw new TpfError("limit_exceeded", "TPF entry is outside the supported range");
    }
    if ((flags & 0x1) === 0 || (flags & 0x40) !== 0 || (method !== 0 && method !== 8)) {
      throw new TpfError("unsupported_tpf_variant", "TPF entry encryption or compression is unsupported");
    }
    let name: string;
    try {
      name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameBytes), (flags & 0x800) !== 0);
    } catch {
      throw new TpfError("unsafe_archive", "TPF entry name cannot be decoded safely");
    }
    if (!safeName(name)) throw new TpfError("unsafe_archive", "TPF contains an unsafe entry name");
    expandedTotal += expandedBytes;
    if (expandedTotal > MAX_EXPANDED_BYTES) throw new TpfError("limit_exceeded", "TPF expands past the safety limit");
    entries.push({ name, flags, method, modifiedTime, crc, compressedBytes, expandedBytes, localOffset });
    offset = next;
  }
  if (offset > directoryOffset + directoryBytes) throw new TpfError("tpf_corrupt", "ZIP directory size is inconsistent");
  return entries;
}

class ZipCrypto {
  private first = 0x12345678;
  private second = 0x23456789;
  private third = 0x34567890;

  constructor(password: Uint8Array) {
    for (const byte of password) this.update(byte);
  }

  private update(byte: number): void {
    this.first = crcUpdate(this.first, byte);
    this.second = (Math.imul((this.second + (this.first & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    this.third = crcUpdate(this.third, this.second >>> 24);
  }

  decrypt(byte: number): number {
    const temporary = (this.third | 2) >>> 0;
    const plain = byte ^ ((Math.imul(temporary, temporary ^ 1) >>> 8) & 0xff);
    this.update(plain);
    return plain;
  }
}

function readEntry(archive: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const offset = entry.localOffset;
  if (offset > archive.byteLength - 30 || view.getUint32(offset, true) !== 0x04034b50) {
    throw new TpfError("tpf_corrupt", "ZIP local entry is invalid");
  }
  const nameBytes = view.getUint16(offset + 26, true);
  const extraBytes = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameBytes + extraBytes;
  if (entry.compressedBytes < 12 || start > archive.byteLength - entry.compressedBytes) {
    throw new TpfError("tpf_corrupt", "encrypted ZIP entry is truncated");
  }
  const crypt = new ZipCrypto(TPF_PASSWORD);
  const decrypted = new Uint8Array(entry.compressedBytes);
  for (let index = 0; index < decrypted.byteLength; index += 1) decrypted[index] = crypt.decrypt(archive[start + index]!);
  const expectedCheck = (entry.flags & 0x8) !== 0 ? entry.modifiedTime >>> 8 : entry.crc >>> 24;
  if (decrypted[11] !== expectedCheck) throw new TpfError("tpf_corrupt", "TPF password check failed");
  let output: Uint8Array;
  try {
    output = entry.method === 0
      ? decrypted.subarray(12).slice()
      : inflateRawSync(decrypted.subarray(12), { maxOutputLength: entry.expandedBytes });
  } catch {
    throw new TpfError("tpf_corrupt", "TPF entry cannot be decompressed");
  }
  if (output.byteLength !== entry.expandedBytes || crc32(output) !== entry.crc) {
    throw new TpfError("tpf_corrupt", "TPF entry checksum failed");
  }
  return output;
}

function parseDefinition(bytes: Uint8Array): readonly { target: number; name: string }[] {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DEFINITION_BYTES) throw new TpfError("definition_invalid", "texmod.def is empty or too large");
  const text = new TextDecoder("windows-1252", { fatal: true })
    .decode(bytes)
    .replace(/^\ufeff/u, "")
    .replace(/\0+$/u, "");
  const mappings: { target: number; name: string }[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(0x[0-9a-f]{1,8})\|(.+)$/iu.exec(line);
    if (!match) {
      if (/^0x[0-9a-f]{9,16}\|/iu.test(line)) throw new TpfError("unsupported_hash_width", "64-bit TexMod hashes are not supported");
      throw new TpfError("definition_invalid", "texmod.def contains an invalid mapping");
    }
    const name = match[2]!.trim();
    if (!safeName(name)) throw new TpfError("unsafe_archive", "texmod.def contains an unsafe image name");
    mappings.push({ target: Number.parseInt(match[1]!.slice(2), 16) >>> 0, name });
    if (mappings.length > MAX_ENTRIES) throw new TpfError("limit_exceeded", "texmod.def has too many mappings");
  }
  if (mappings.length === 0) throw new TpfError("definition_invalid", "texmod.def contains no mappings");
  return mappings;
}

export function readTpf(source: Uint8Array): readonly TpfMapping[] {
  const archive = xorDecode(source);
  const entries = parseEntries(archive);
  const definitions = entries.filter((entry) => entry.name.toLowerCase() === "texmod.def");
  if (definitions.length !== 1) throw new TpfError("definition_missing", "TPF must contain one texmod.def");
  const mappings = parseDefinition(readEntry(archive, definitions[0]!));
  const byName = new Map<string, ZipEntry>();
  for (const entry of entries) if (!byName.has(entry.name.toLowerCase())) byName.set(entry.name.toLowerCase(), entry);
  const targets = new Map<number, { name: string; entry: ZipEntry }>();
  for (const mapping of mappings) {
    const entry = byName.get(mapping.name.toLowerCase());
    if (!entry) throw new TpfError("mapping_missing_image", "texmod.def references a missing image");
    const existing = targets.get(mapping.target);
    if (existing && existing.name.toLowerCase() !== mapping.name.toLowerCase()) {
      throw new TpfError("duplicate_target", "one target maps to different images");
    }
    if (!existing) targets.set(mapping.target, { name: mapping.name, entry });
  }
  const decoded = new Map<string, Uint8Array>();
  const bytesFor = (entry: ZipEntry): Uint8Array => {
    const key = entry.name.toLowerCase();
    const existing = decoded.get(key);
    if (existing) return existing;
    const bytes = readEntry(archive, entry);
    decoded.set(key, bytes);
    return bytes;
  };
  return [...targets.entries()].map(([target, value]) => ({
    target,
    name: value.name,
    bytes: bytesFor(value.entry),
  }));
}
