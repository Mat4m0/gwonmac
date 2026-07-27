// Two parsers, both of which fail in ways that look like something else.
//
// **The archive header** stores the file table's offset at `0x10` and its size
// at `0x18`. In a real archive the size is 4,225,992 and the offset is
// 4,196,085,248 — so reading the pair backwards gives you a *plausible* offset
// four megabytes into the file, lands on random bytes, and looks like a corrupt
// archive rather than a swapped field. That happened; it cost a round of
// scanning for the table's magic to notice.
//
// **The skill table** has no fixed address — it moves with every client build —
// so it is found by its shape. A weak signature finds thousands of matches: a
// scan for "plausible icon file ids" alone returned 2,559 candidate windows,
// and the first one printed convincing-looking garbage. The signature is four
// weak fields together, and the test below is mostly about the near-misses each
// one has to reject.
//
//   node --import ./tests/ts-hook.mjs --experimental-strip-types --test \
//     tests/unit/the-skill-table-is-found-by-shape-not-by-a-pinned-address.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  fileIdIndex,
  findStream,
  parseArchiveHeader,
  readFileTable,
  SLOT_BYTES,
  type ReadAt,
} from "../../src/main/core/gw-archive.ts";
import {
  findSkillTable,
  signatureRun,
  SKILL_RECORD_BYTES,
} from "../../src/main/core/skill-table.ts";

/** A reader over one flat buffer, standing in for the chunk store. */
const readerOver = (bytes: Uint8Array): ReadAt =>
  (offset, length) => bytes.subarray(offset, offset + length);

function slotBytes(
  target: Uint8Array,
  index: number,
  fields: {
    offset?: number;
    size?: number;
    compressed?: boolean;
    payload?: number;
    stream?: number;
    nextSlot?: number;
  },
): void {
  const at = index * SLOT_BYTES;
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setBigUint64(at, BigInt(fields.offset ?? 0), true);
  view.setUint32(at + 8, fields.size ?? 0, true);
  view.setUint16(at + 0x0c, fields.compressed ? 8 : 0, true);
  target[at + 0x0e] = fields.payload ?? 1;
  target[at + 0x0f] = fields.stream ?? 0;
  view.setUint32(at + 0x10, fields.nextSlot ?? 0, true);
}

/** A minimal archive: header, table, and an id index in slot 2. */
function archive(entries: { fileId: number; slot: number }[], slots = 32) {
  const TABLE_AT = 4096;
  const INDEX_AT = 8192;
  const bytes = new Uint8Array(16384);
  const view = new DataView(bytes.buffer);

  bytes.set([0x33, 0x41, 0x4e, 0x1a], 0);
  view.setBigUint64(0x10, BigInt(TABLE_AT), true);
  view.setUint32(0x18, SLOT_BYTES * slots, true);

  const table = bytes.subarray(TABLE_AT, TABLE_AT + SLOT_BYTES * slots);
  table.set([0x4d, 0x66, 0x74, 0x1a], 0);
  new DataView(table.buffer, table.byteOffset).setUint32(0x0c, slots, true);
  slotBytes(table, 2, { offset: INDEX_AT, size: entries.length * 8 });

  const index = new DataView(bytes.buffer, INDEX_AT);
  entries.forEach((entry, i) => {
    index.setInt32(i * 8, entry.fileId, true);
    index.setInt32(i * 8 + 4, entry.slot, true);
  });
  return { bytes, table };
}

test("the header's offset and size are not read backwards", () => {
  const { bytes } = archive([]);
  const header = parseArchiveHeader(readerOver(bytes));
  assert.equal(header.tableOffset, 4096);
  assert.equal(header.tableSize, SLOT_BYTES * 32);
  // The whole point: the two must not be interchangeable. A parser that swapped
  // them would still return two plausible numbers here.
  assert.notEqual(header.tableOffset, header.tableSize);
});

test("something that is not a Guild Wars archive is refused", () => {
  const bytes = new Uint8Array(64);
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0); // a zip
  assert.throws(() => parseArchiveHeader(readerOver(bytes)), /not a Guild Wars archive/);
});

test("a file table without its magic is refused rather than parsed as slots", () => {
  const { bytes } = archive([]);
  bytes.set([0, 0, 0, 0], 4096);
  assert.throws(
    () => readFileTable(readerOver(bytes), parseArchiveHeader(readerOver(bytes))),
    /file table magic/,
  );
});

test("a file id resolves through the index, not by being a slot number", () => {
  // The distinction is the reason slot 2 exists: file id 87236 lives in slot
  // 1074, and using the id as an index reads an unrelated file.
  const { bytes, table } = archive([{ fileId: 87236, slot: 20 }]);
  slotBytes(table, 20, { offset: 1234, size: 4288, compressed: true });

  const read = readerOver(bytes);
  const files = readFileTable(read, parseArchiveHeader(read));
  const index = fileIdIndex(read, files);

  assert.equal(index.get(87236), 20);
  const found = findStream(files, index, 87236);
  assert.ok(found);
  assert.equal(found.offset, 1234);
  assert.equal(found.compressed, true, "icon payloads are GWDat-compressed");
  assert.equal(findStream(files, index, 99999), null, "an unknown id is null");
});

test("a file's streams are followed as a chain", () => {
  const { bytes, table } = archive([{ fileId: 7, slot: 20 }]);
  slotBytes(table, 20, { offset: 100, size: 10, stream: 0, nextSlot: 21 });
  slotBytes(table, 21, { offset: 200, size: 20, stream: 1, nextSlot: 0 });

  const read = readerOver(bytes);
  const files = readFileTable(read, parseArchiveHeader(read));
  const index = fileIdIndex(read, files);

  assert.equal(findStream(files, index, 7, 0)?.offset, 100);
  assert.equal(findStream(files, index, 7, 1)?.offset, 200);
  assert.equal(findStream(files, index, 7, 2), null, "a stream that is absent");
});

test("a chain that loops terminates instead of hanging on a 4 GB file", () => {
  const { bytes, table } = archive([{ fileId: 7, slot: 20 }]);
  slotBytes(table, 20, { offset: 100, size: 10, stream: 9, nextSlot: 21 });
  slotBytes(table, 21, { offset: 200, size: 10, stream: 9, nextSlot: 20 });

  const read = readerOver(bytes);
  const files = readFileTable(read, parseArchiveHeader(read));
  const index = fileIdIndex(read, files);
  assert.equal(findStream(files, index, 7, 0), null);
});

test("an empty base slot carries no payload and is not a hit", () => {
  const { bytes, table } = archive([{ fileId: 7, slot: 20 }]);
  slotBytes(table, 20, { offset: 100, size: 10, payload: 0 });
  const read = readerOver(bytes);
  const files = readFileTable(read, parseArchiveHeader(read));
  assert.equal(findStream(files, fileIdIndex(read, files), 7), null);
});

/** A run of skill records with the shape the scanner looks for. */
function skillRecords(count: number, from = 0): Uint8Array {
  const bytes = new Uint8Array((from + count) * SKILL_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < from + count; i++) {
    const at = i * SKILL_RECORD_BYTES;
    view.setUint32(at, i, true);
    view.setUint32(at + 0x08, i % 5, true);
    view.setUint32(at + 0x10, i % 9 === 0 ? 0x4 : 0, true); // elite flag
    bytes[at + 0x28] = (i % 10) + 1;
    bytes[at + 0x29] = i % 45;
    view.setUint32(at + 0x8c, 50000 + i, true);
  }
  return bytes;
}

test("the whole table is read, from record zero", () => {
  const table = findSkillTable(skillRecords(400));
  assert.ok(table);
  assert.equal(table.at, 0);
  assert.equal(table.skills.length, 400);
  assert.equal(table.skills[0]?.id, 0);
  assert.equal(table.skills[399]?.id, 399);
  assert.equal(table.skills[9]?.iconFileId, 50009);
  assert.equal(table.skills[0]?.elite, true, "special & 0x4 is the elite test");
  assert.equal(table.skills[1]?.elite, false);
});

test("the table is found even when the scan lands in the middle of it", () => {
  // The scan starts wherever a confident run begins, which is not record 0.
  // Record 0 is derived from the id at the hit, because walking backwards by
  // signature stops at the first record that happens to fail it.
  const bytes = new Uint8Array(300 + 400 * SKILL_RECORD_BYTES);
  bytes.set(skillRecords(400), 300);
  const table = findSkillTable(bytes);
  assert.ok(table);
  assert.equal(table.at, 300);
  assert.equal(table.skills.length, 400);
});

test("each weak field of the signature rejects its own near miss", () => {
  // Individually these are all common values. The point of the composite is
  // that a window has to satisfy every one of them at once, and this asserts
  // each is actually being checked rather than carried by the others.
  const cases: readonly [string, number, number][] = [
    ["a profession past the ten that exist", 0x28, 11],
    ["an attribute that is neither real nor the sentinel", 0x29, 60],
    ["a campaign beyond any that shipped", 0x08, 99],
  ];
  for (const [what, field, value] of cases) {
    const bytes = skillRecords(40);
    if (field === 0x08) {
      new DataView(bytes.buffer).setUint32(20 * SKILL_RECORD_BYTES + field, value, true);
    } else {
      bytes[20 * SKILL_RECORD_BYTES + field] = value;
    }
    assert.equal(signatureRun(bytes, 0, 40), 20, what);
  }
});

test("ids that do not ascend end the run", () => {
  // The table is ordered by id, so a repeat or a step backwards is not a table.
  const bytes = skillRecords(40);
  new DataView(bytes.buffer).setUint32(15 * SKILL_RECORD_BYTES, 3, true);
  assert.equal(signatureRun(bytes, 0, 40), 15);
});

test("a binary with no table says so instead of guessing", () => {
  assert.equal(findSkillTable(new Uint8Array(4096)), null);
  // Long enough to be scanned, shaped wrong throughout.
  const noise = new Uint8Array(SKILL_RECORD_BYTES * 200).fill(0xab);
  assert.equal(findSkillTable(noise), null);
});
