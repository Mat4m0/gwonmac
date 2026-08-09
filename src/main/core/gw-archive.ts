/**
 * Reading Guild Wars' own archive: header, file table, and the id index.
 *
 * The web port's `Gw.snapshot` is a Guild Wars `.dat` — the same container as
 * the desktop client, magic and all. Every field offset below was measured
 * against a real 4.2 GB archive rather than taken from a document.
 *
 * A file id is not a slot number: ids resolve through the index in slot 2, and
 * a file's payload can be a chain of streams rather than one. `skill-catalogue`
 * uses this to locate icon textures and language shards.
 *
 * ## No I/O
 *
 * Every function takes a `ReadAt`. The archive is 4.2 GB spread over some
 * 16,000 content-addressed chunks and cannot be a Buffer, so the caller owns
 * assembly and this file owns the format. That also makes the parsing testable
 * against a few hundred synthetic bytes instead of a game install.
 */

/** Read `length` bytes at an absolute archive offset. */
export type ReadAt = (offset: number, length: number) => Uint8Array;

const u32 = (bytes: Uint8Array, at: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

const u16 = (bytes: Uint8Array, at: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at, true);

const u64 = (bytes: Uint8Array, at: number): number =>
  Number(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
      at,
      true,
    ),
  );

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));

export const ARCHIVE_MAGIC = "3AN";
export const TABLE_MAGIC = "Mft";

/** The 32-byte archive header. Two of its fields are easy to read backwards. */
export interface ArchiveHeader {
  readonly tableOffset: number;
  readonly tableSize: number;
}

/**
 * Parse the archive header.
 *
 * The trap this encodes: at `0x10` sits the file *table's offset* and at `0x18`
 * its *size*, and for a real archive the size (4,225,992) is a perfectly
 * plausible offset while the offset (4,196,085,248) looks like a size. Reading
 * them the wrong way round lands on random bytes 4 MB into the file and looks
 * like a corrupt archive rather than a swapped pair.
 */
export function parseArchiveHeader(read: ReadAt): ArchiveHeader {
  const head = read(0, 32);
  const magic = ascii(head, 0, 4);
  if (magic !== ARCHIVE_MAGIC) {
    throw new Error(`not a Guild Wars archive: magic ${JSON.stringify(magic)}`);
  }
  return { tableOffset: u64(head, 0x10), tableSize: u32(head, 0x18) };
}

/**
 * One 24-byte file table slot.
 *
 * A file is a *chain* of slots, one per stream, not a single record — which is
 * why `stream` and `nextSlot` exist. Icons live in stream 0.
 */
export interface Slot {
  readonly offset: number;
  readonly size: number;
  /** Non-zero means the payload is GWDat-compressed. */
  readonly compressed: boolean;
  /** Zero marks an empty base slot carrying no payload. */
  readonly payload: number;
  readonly stream: number;
  /** Slot of the next stream in this file's chain; 0 ends it. */
  readonly nextSlot: number;
}

export const SLOT_BYTES = 24;
/** Slots below this are the table's own header and reserved entries. */
export const FIRST_FILE_SLOT = 16;

export function parseSlot(table: Uint8Array, index: number): Slot {
  const at = index * SLOT_BYTES;
  return {
    offset: u64(table, at),
    size: u32(table, at + 8),
    compressed: u16(table, at + 0x0c) !== 0,
    payload: table[at + 0x0e]!,
    stream: table[at + 0x0f]!,
    nextSlot: u32(table, at + 0x10),
  };
}

/** The whole file table, and the slot count from its header record. */
export interface FileTable {
  readonly bytes: Uint8Array;
  readonly slotCount: number;
}

export function readFileTable(read: ReadAt, header: ArchiveHeader): FileTable {
  const head = read(header.tableOffset, SLOT_BYTES);
  const magic = ascii(head, 0, 4);
  if (magic !== TABLE_MAGIC) {
    throw new Error(`file table magic is ${JSON.stringify(magic)}`);
  }
  // Slot count is at 0x0C. It is *not* at 0x10, which reads zero — a plausible
  // enough answer to look like an empty archive rather than a wrong offset.
  const slotCount = u32(head, 0x0c);
  return { bytes: read(header.tableOffset, SLOT_BYTES * slotCount), slotCount };
}

/**
 * `file id -> base slot`, from the index the archive keeps in slot 2.
 *
 * The game addresses content by file id, and file ids are not slot numbers.
 * Slot 2 holds pairs of `(file id, slot)`; without it a file id is unusable.
 */
export function fileIdIndex(
  read: ReadAt,
  table: FileTable,
): ReadonlyMap<number, number> {
  const list = parseSlot(table.bytes, 2);
  const raw = read(list.offset, list.size);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const index = new Map<number, number>();
  for (let at = 0; at + 8 <= raw.byteLength; at += 8) {
    const fileId = view.getInt32(at, true) >>> 0;
    const slot = view.getInt32(at + 4, true);
    // Out-of-range slots are dead entries, not an error: the table is sized
    // generously and the archive tolerates holes.
    if (slot >= FIRST_FILE_SLOT && slot < table.slotCount) index.set(fileId, slot);
  }
  return index;
}

/**
 * The slot holding `stream` of `fileId`, or `null`.
 *
 * Streams are a linked list, so this walks the chain. The guard is not
 * defensive noise — a corrupt `nextSlot` pointing back into the chain would
 * otherwise hang the extractor on a 4 GB file.
 */
export function findStream(
  table: FileTable,
  index: ReadonlyMap<number, number>,
  fileId: number,
  stream = 0,
): Slot | null {
  let slot = index.get(fileId);
  if (slot === undefined) return null;
  for (let hops = 0; hops < 256; hops++) {
    if (slot < FIRST_FILE_SLOT || slot >= table.slotCount) return null;
    const candidate = parseSlot(table.bytes, slot);
    if (candidate.stream === stream) {
      return candidate.payload !== 0 && candidate.size > 0 ? candidate : null;
    }
    if (candidate.nextSlot <= 0) return null;
    slot = candidate.nextSlot;
  }
  return null;
}
