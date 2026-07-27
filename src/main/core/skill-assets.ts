import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { ChunkStore } from "./chunk-store.js";
import {
  fileIdIndex,
  findStream,
  parseArchiveHeader,
  parseSlot,
  readFileTable,
  type FileTable,
} from "./gw-archive.js";
import { findSkillTable, type SkillRecord } from "./skill-table.js";

const PROFESSION = new Map<number, string>([
  [1, "W"], [2, "R"], [3, "Mo"], [4, "N"], [5, "Me"],
  [6, "E"], [7, "A"], [8, "Rt"], [9, "P"], [10, "D"],
]);
const MAX_HELPER_OUTPUT = 256 * 256 * 4 + 8;
const HELPER_TIMEOUT_MS = 5_000;
const MEMORY_ICONS = 256;

export interface SkillAssetFacts {
  readonly id: number;
  readonly name: string;
  readonly profession: string | null;
  readonly elite: boolean;
  readonly hasIcon: boolean;
}

interface SkillAssetSource {
  readonly store: ChunkStore;
  readonly wasmPath: string;
  readonly namesPath: string;
  readonly decoderPath: string;
}

interface Ready {
  readonly skills: readonly SkillRecord[];
  readonly files: FileTable;
  readonly fileIndex: ReadonlyMap<number, number>;
  readonly names: ReadonlyMap<number, string>;
}

function displayName(identifier: string): string {
  return identifier
    .replace(/^UNUSED_/u, "")
    .replace(/^REMOVE_/u, "")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/gu, "$1 $2");
}

export function parseSkillNames(source: string): ReadonlyMap<number, string> {
  const start = source.indexOf("enum class SkillID");
  if (start < 0) throw new Error("SkillID enum is missing");
  const open = source.indexOf("{", start);
  const close = source.indexOf("};", open);
  if (open < 0 || close < 0) throw new Error("SkillID enum is incomplete");
  const result = new Map<number, string>();
  let next = 0;
  for (const raw of source.slice(open + 1, close).split(",")) {
    const item = raw.replace(/\/\/.*$/gmu, "").trim();
    if (!item) continue;
    const match = /^([A-Za-z][A-Za-z0-9_]*)(?:\s*=\s*(0x[0-9a-f]+|\d+))?$/iu.exec(item);
    if (!match) continue;
    if (match[2]) next = Number.parseInt(match[2], 0);
    result.set(next, displayName(match[1]!));
    next += 1;
  }
  return result;
}

function u16(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint16(at, true);
}

/**
 * The attributed decoder labels RGB565's low five bits `r`, but BC1 stores
 * those bits as blue. Its byte stream is therefore B,G,R,A despite the RGBA
 * name. BMP also stores pixels B,G,R,A, so preserve that order here rather
 * than performing the ordinary RGBA-to-BGRA swap.
 */
export function decodedIconToBmp(decoded: Uint8Array): Buffer {
  if (
    decoded.length < 8
    || String.fromCharCode(...decoded.subarray(0, 4)) !== "GWIC"
  ) {
    throw new Error("skill icon helper returned an invalid header");
  }
  const width = u16(decoded, 4);
  const height = u16(decoded, 6);
  const pixels = decoded.subarray(8);
  if (
    width <= 0 || height <= 0 || width > 256 || height > 256
    || pixels.length !== width * height * 4
  ) {
    throw new Error("skill icon helper returned invalid dimensions");
  }
  const bmp = Buffer.alloc(54 + pixels.length);
  bmp.write("BM", 0, "ascii");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(32, 28);
  bmp.writeUInt32LE(pixels.length, 34);
  for (let y = 0; y < height; y++) {
    const sourceRow = y * width * 4;
    const targetRow = 54 + (height - y - 1) * width * 4;
    for (let x = 0; x < width; x++) {
      const source = sourceRow + x * 4;
      const target = targetRow + x * 4;
      bmp[target] = pixels[source]!;
      bmp[target + 1] = pixels[source + 1]!;
      bmp[target + 2] = pixels[source + 2]!;
      bmp[target + 3] = pixels[source + 3]!;
    }
  }
  return bmp;
}

function decodeIcon(executable: string, input: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("skill icon helper timed out")),
      HELPER_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_HELPER_OUTPUT) {
        fail(new Error("skill icon helper exceeded its output bound"));
      } else {
        chunks.push(chunk);
      }
    });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error("skill icon helper refused the local asset"));
        return;
      }
      try {
        resolve(decodedIconToBmp(Buffer.concat(chunks, length)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

export class SkillAssets {
  private readonly source: SkillAssetSource;
  private ready: Promise<Ready> | null = null;
  private readonly icons = new Map<number, Buffer>();
  private readonly pending = new Map<number, Promise<Buffer | null>>();

  constructor(source: SkillAssetSource) {
    this.source = source;
  }

  private initialize(): Promise<Ready> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const [wasm, namesText] = await Promise.all([
        readFile(this.source.wasmPath),
        readFile(this.source.namesPath, "utf8"),
      ]);
      const table = findSkillTable(wasm);
      if (!table) throw new Error("the local client has no recognisable skill table");

      const headerBytes = await this.source.store.readRange(0, 32);
      const header = parseArchiveHeader(() => headerBytes);
      const tableBytes = await this.source.store.readRange(
        header.tableOffset,
        header.tableSize,
      );
      const files = readFileTable(
        (offset, length) => {
          const relative = offset - header.tableOffset;
          return tableBytes.subarray(relative, relative + length);
        },
        header,
      );
      const indexSlot = parseSlot(files.bytes, 2);
      const indexBytes = await this.source.store.readRange(
        indexSlot.offset,
        indexSlot.size,
      );
      const fileIndex = fileIdIndex(
        (offset, length) => {
          const relative = offset - indexSlot.offset;
          return indexBytes.subarray(relative, relative + length);
        },
        files,
      );
      return {
        skills: table.skills,
        files,
        fileIndex,
        names: parseSkillNames(namesText),
      };
    })();
    return this.ready;
  }

  async catalogue(): Promise<readonly SkillAssetFacts[]> {
    const ready = await this.initialize();
    return ready.skills.map((skill) => ({
      id: skill.id,
      name: ready.names.get(skill.id) ?? `Skill ${skill.id}`,
      profession: PROFESSION.get(skill.profession) ?? null,
      elite: skill.elite,
      hasIcon:
        skill.iconFileId !== 0
        && findStream(ready.files, ready.fileIndex, skill.iconFileId) !== null,
    }));
  }

  async icon(skillId: number): Promise<Buffer | null> {
    const hit = this.icons.get(skillId);
    if (hit) {
      this.icons.delete(skillId);
      this.icons.set(skillId, hit);
      return hit;
    }
    const existing = this.pending.get(skillId);
    if (existing) return existing;
    const request = this.decode(skillId).finally(() => {
      this.pending.delete(skillId);
    });
    this.pending.set(skillId, request);
    return request;
  }

  private async decode(skillId: number): Promise<Buffer | null> {
    const ready = await this.initialize();
    const skill = ready.skills[skillId];
    if (!skill || skill.id !== skillId || skill.iconFileId === 0) return null;
    const stream = findStream(ready.files, ready.fileIndex, skill.iconFileId);
    if (!stream || !stream.compressed || stream.size > 1024 * 1024) return null;
    const compressed = await this.source.store.readRange(stream.offset, stream.size);
    const bmp = await decodeIcon(this.source.decoderPath, compressed);
    this.icons.set(skillId, bmp);
    while (this.icons.size > MEMORY_ICONS) {
      const oldest = this.icons.keys().next().value;
      if (oldest === undefined) break;
      this.icons.delete(oldest);
    }
    return bmp;
  }
}
