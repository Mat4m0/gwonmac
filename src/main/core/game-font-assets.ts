/**
 * The original Guild Wars Latin UI font, derived from the active local game.
 *
 * The archive contains a high-resolution bitmap strike rather than an ordinary
 * font file. This class reads only that bounded stream, asks the existing local
 * helper to decompress it, and converts it to TrueType in memory. A missing or
 * changed asset returns `null`, so the renderer keeps its normal serif fallback.
 */

import type { ChunkStore } from "./chunk-store.js";
import {
  fileIdIndex,
  findStream,
  parseArchiveHeader,
  parseSlot,
  readFileTable,
} from "./gw-archive.js";
import {
  decodedArchiveBytes,
  runGwDatDecoder,
} from "./gw-dat-decoder.js";
import {
  buildGuildWarsTrueType,
  GUILD_WARS_LATIN_FONT_FILE_ID,
} from "./gw-font.js";

const MAX_COMPRESSED_FONT_BYTES = 64 * 1024;
const MAX_DECODED_FONT_BYTES = 64 * 1024;

export interface GameFontSource {
  readonly store: Pick<ChunkStore, "readRange">;
  readonly decoderPath: string;
}

export type GameFontRefusal = "unsupported" | "read-or-format";

/** Read and decompress only the bounded local strike used by the converter. */
export async function readGameFontStrike(
  source: GameFontSource,
): Promise<Buffer | null> {
  const { store } = source;
  const headerBytes = await store.readRange(0, 32);
  const header = parseArchiveHeader(() => headerBytes);
  const tableBytes = await store.readRange(header.tableOffset, header.tableSize);
  const files = readFileTable(
    (offset, length) => tableBytes.subarray(
      offset - header.tableOffset,
      offset - header.tableOffset + length,
    ),
    header,
  );
  const indexSlot = parseSlot(files.bytes, 2);
  const indexBytes = await store.readRange(indexSlot.offset, indexSlot.size);
  const index = fileIdIndex(
    (offset, length) => indexBytes.subarray(
      offset - indexSlot.offset,
      offset - indexSlot.offset + length,
    ),
    files,
  );
  const stream = findStream(files, index, GUILD_WARS_LATIN_FONT_FILE_ID);
  if (!stream?.compressed || stream.size > MAX_COMPRESSED_FONT_BYTES) return null;
  const compressed = await store.readRange(stream.offset, stream.size);
  return runGwDatDecoder(source.decoderPath, compressed, {
    args: ["--raw"],
    maxOutput: MAX_DECODED_FONT_BYTES + 8,
    parse: (bytes) => decodedArchiveBytes(bytes, MAX_DECODED_FONT_BYTES),
  });
}

export class GameFontAssets {
  private readonly source: GameFontSource;
  private result: Promise<Buffer | null> | null = null;
  private refusalCode: GameFontRefusal | null = null;

  constructor(source: GameFontSource) {
    this.source = source;
  }

  async font(): Promise<Buffer | null> {
    return this.result ??= this.convert().catch(() => {
      this.refusalCode = "read-or-format";
      return null;
    });
  }

  refusal(): GameFontRefusal | null {
    return this.refusalCode;
  }

  private async convert(): Promise<Buffer | null> {
    const raw = await readGameFontStrike(this.source);
    if (!raw) {
      this.refusalCode = "unsupported";
      return null;
    }
    return buildGuildWarsTrueType(raw);
  }
}
