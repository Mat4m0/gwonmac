import {
  Reader,
  ZipReader,
  ZipWriter,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readdir,
  rm,
  stat,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 384 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 16;

const DIAGNOSTIC_ZIP_FILES = new Set([
  "capture-summary.json",
  "chromium-trace.json",
  "environment.json",
  "events.jsonl",
  "frames.bin",
  "histograms.json",
  "manifest.json",
  "previous-events.jsonl",
  "report.json",
  "settings-redacted.json",
  "summary.json",
]);

class NodeFileReader extends Reader<string> {
  private readonly file: string;
  private handle: FileHandle | null = null;

  constructor(file: string) {
    super(file);
    this.file = file;
  }

  override async init(): Promise<void> {
    await super.init?.();
    this.handle = await open(this.file, "r");
    this.size = (await this.handle.stat()).size;
  }

  override async readUint8Array(
    offset: number,
    length: number,
  ): Promise<Uint8Array> {
    if (!this.handle) throw new Error("diagnostic ZIP reader is not open");
    const available = Math.max(0, this.size - offset);
    const bytes = Buffer.allocUnsafe(Math.max(0, Math.min(length, available)));
    let read = 0;
    while (read < bytes.byteLength) {
      const result = await this.handle.read(
        bytes,
        read,
        bytes.byteLength - read,
        offset + read,
      );
      if (result.bytesRead <= 0) break;
      read += result.bytesRead;
    }
    // zip.js attaches an `offset` marker to returned arrays while locating the
    // central directory. A Node Buffer already exposes an `offset`-shaped
    // property, so return a plain Uint8Array view rather than the Buffer.
    return new Uint8Array(bytes.buffer, bytes.byteOffset, read);
  }

  async closeFile(): Promise<void> {
    await this.handle?.close();
    this.handle = null;
  }
}

function nodeWritable(file: string): WritableStream<Uint8Array> {
  return Writable.toWeb(
    createWriteStream(file, { flags: "wx", mode: 0o600 }),
  ) as WritableStream<Uint8Array>;
}

function assertDiagnosticEntry(
  entry: Entry,
  seen: Set<string>,
): asserts entry is FileEntry {
  const name = entry.filename;
  if (!DIAGNOSTIC_ZIP_FILES.has(name)) {
    throw new Error(`diagnostic ZIP contains unknown entry: ${name}`);
  }
  if (seen.has(name)) {
    throw new Error(`diagnostic ZIP contains duplicate entry: ${name}`);
  }
  seen.add(name);
  if (
    entry.directory ||
    name.includes("/") ||
    name.includes("\\") ||
    path.isAbsolute(name)
  ) {
    throw new Error("diagnostic ZIP entry path is unsafe");
  }
  if (entry.encrypted) throw new Error("encrypted diagnostic ZIP is unsupported");
  if (entry.zip64) throw new Error("ZIP64 diagnostic entry exceeds supported bounds");
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new Error("diagnostic ZIP compression method is unsupported");
  }
  if (
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 0 ||
    entry.uncompressedSize > MAX_ENTRY_BYTES
  ) {
    throw new Error("diagnostic ZIP entry size exceeds the limit");
  }
  const unixType = entry.unixMode === undefined
    ? 0
    : entry.unixMode & 0o170000;
  if (unixType !== 0 && unixType !== 0o100000) {
    throw new Error("diagnostic ZIP links and special files are unsupported");
  }
  if (entry.diskNumberStart !== 0) {
    throw new Error("split diagnostic ZIP archives are unsupported");
  }
}

export async function writeDiagnosticZip(
  sourceDirectory: string,
  outputFile: string,
): Promise<void> {
  const names = (await readdir(sourceDirectory)).sort();
  if (names.length === 0 || names.length > MAX_ENTRIES) {
    throw new Error("diagnostic ZIP entry count is invalid");
  }
  for (const name of names) {
    if (!DIAGNOSTIC_ZIP_FILES.has(name)) {
      throw new Error(`refusing unknown diagnostic file: ${name}`);
    }
    const info = await stat(path.join(sourceDirectory, name));
    if (!info.isFile() || info.size > MAX_ENTRY_BYTES) {
      throw new Error(`diagnostic file is not a bounded regular file: ${name}`);
    }
  }

  const writer = new ZipWriter(nodeWritable(outputFile), {
    bufferedWrite: false,
    keepOrder: true,
    level: 6,
    useCompressionStream: false,
    useWebWorkers: false,
  });
  try {
    for (const name of names) {
      const file = path.join(sourceDirectory, name);
      const size = (await stat(file)).size;
      const source = new NodeFileReader(file);
      try {
        await writer.add(name, source, {
          uncompressedSize: size,
          useCompressionStream: false,
          useWebWorkers: false,
          zip64: false,
        });
      } finally {
        await source.closeFile();
      }
    }
    await writer.close();
  } catch (error) {
    await writer.close().catch(() => undefined);
    await rm(outputFile, { force: true });
    throw error;
  }
  if ((await stat(outputFile)).size > MAX_ARCHIVE_BYTES) {
    await rm(outputFile, { force: true });
    throw new Error("diagnostic ZIP exceeds the archive size limit");
  }
  if (process.platform !== "win32") await chmod(outputFile, 0o600);
}

export async function readDiagnosticZip(
  archiveFile: string,
  destination: string,
): Promise<void> {
  const archive = await stat(archiveFile);
  if (!archive.isFile() || archive.size > MAX_ARCHIVE_BYTES) {
    throw new Error("diagnostic ZIP exceeds the archive size limit");
  }
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length !== 0) {
    throw new Error("diagnostic ZIP destination must be empty");
  }
  const source = new NodeFileReader(archiveFile);
  const reader = new ZipReader(source, {
    checkOverlappingEntry: true,
    strictness: "strict",
    useCompressionStream: false,
    useWebWorkers: false,
  });
  const extracted: string[] = [];
  try {
    const entries = await reader.getEntries();
    if (entries.length === 0 || entries.length > MAX_ENTRIES) {
      throw new Error("diagnostic ZIP entry count is invalid");
    }
    if (reader.prependedData?.byteLength || reader.appendedData?.byteLength) {
      throw new Error("diagnostic ZIP has data outside the archive");
    }
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const entry of entries) {
      assertDiagnosticEntry(entry, seen);
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("diagnostic ZIP expanded size exceeds the limit");
      }
      const target = path.join(destination, entry.filename);
      extracted.push(target);
      await entry.getData(nodeWritable(target), {
        checkOverlappingEntry: true,
        checkSignature: true,
        strictness: "strict",
        useCompressionStream: false,
        useWebWorkers: false,
      });
      if (process.platform !== "win32") await chmod(target, 0o600);
    }
  } catch (error) {
    await Promise.all(extracted.map((file) => rm(file, { force: true })));
    throw error;
  } finally {
    await reader.close().catch(() => undefined);
    await source.closeFile();
  }
}
