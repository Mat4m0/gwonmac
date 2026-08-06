import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findLanguageFileIds,
  formatSkillDescription,
  parseStringShard,
  stringShardIndex,
} from "../../src/main/core/skill-strings.ts";

function uleb(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return bytes;
}

function sleb(value: number): number[] {
  const bytes: number[] = [];
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    const sign = (byte & 0x40) !== 0;
    more = !((value === 0 && !sign) || (value === -1 && sign));
    if (more) byte |= 0x80;
    bytes.push(byte);
  }
  return bytes;
}

function languageTableWasm(): Uint8Array {
  const count = 18 * 99;
  const address = 0x1000;
  const tableBytes = count * 4;
  const data = new Uint8Array(tableBytes + count * 6);
  const view = new DataView(data.buffer);
  for (let index = 0; index < count; index++) {
    const pointer = address + tableBytes + index * 6;
    view.setUint32(index * 4, pointer, true);
    view.setUint16(tableBytes + index * 6, 0x100 + index % 100, true);
    view.setUint16(tableBytes + index * 6 + 2, 0x100 + Math.floor(index / 100), true);
  }
  const payload = Uint8Array.from([
    ...uleb(1),
    0,
    0x41,
    ...sleb(address),
    0x0b,
    ...uleb(data.length),
    ...data,
  ]);
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x0b,
    ...uleb(payload.length),
    ...payload,
  ]);
}

function stringShard(): Uint8Array {
  const encoded = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let index = 0; index < 1_024; index++) {
    const utf16 = new Uint8Array(index === 17 ? 8 : 0);
    if (index === 17) {
      const view = new DataView(utf16.buffer);
      for (const [at, value] of [..."Test"].entries()) {
        view.setUint16(at * 2, value.charCodeAt(0), true);
      }
    }
    const record = new Uint8Array(6 + utf16.length);
    const view = new DataView(record.buffer);
    view.setUint16(0, record.length, true);
    view.setUint16(2, 0, true);
    record[4] = 16;
    record.set(utf16, 6);
    chunks.push(record);
    length += record.length;
  }
  const trailing = encoded.encode("trailing archive metadata is not a string record");
  const output = new Uint8Array(length + trailing.length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  output.set(trailing, offset);
  return output;
}

function compactRecord(): Uint8Array {
  const payload = Uint8Array.from([0x52, 0xaf, 0x19, 0x44]);
  const record = new Uint8Array(6 + payload.length);
  const view = new DataView(record.buffer);
  view.setUint16(0, record.length, true);
  view.setUint16(2, 67, true);
  record[4] = 7;
  record.set(payload, 6);
  return record;
}

describe("client language-file table", () => {
  it("finds all 18 language rows by their complete pointer/hash shape", () => {
    const rows = findLanguageFileIds(languageTableWasm());
    assert.ok(rows);
    assert.equal(rows.length, 18);
    assert.equal(rows[0]?.length, 99);
    assert.equal(rows[0]?.[0], 1);
    assert.equal(rows[1]?.[1], 65_281);
  });
});

describe("client language shards", () => {
  it("parses exactly 1,024 bounded UTF-16 records and ignores the trailer", () => {
    const strings = parseStringShard(stringShard());
    assert.equal(strings.length, 1_024);
    assert.equal(strings[17], "Test");
  });

  it("keeps unrelated context-keyed records opaque without losing the shard", () => {
    const compact = compactRecord();
    const empty = new Uint8Array(6);
    new DataView(empty.buffer).setUint16(0, 6, true);
    empty[4] = 16;
    const bytes = new Uint8Array(
      compact.length + empty.length * 1_023,
    );
    bytes.set(compact);
    for (let index = 1, offset = compact.length; index < 1_024; index++) {
      bytes.set(empty, offset);
      offset += empty.length;
    }
    const strings = parseStringShard(bytes);
    assert.equal(strings[0], null);
    assert.equal(strings[1], "");
  });

  it("maps string ids across shard boundaries", () => {
    assert.deepEqual(stringShardIndex(1_023), { file: 0, record: 1_023 });
    assert.deepEqual(stringShardIndex(1_024), { file: 1, record: 0 });
    assert.throws(() => stringShardIndex(-1), /invalid client string id/u);
  });

  it("substitutes all three skill ranges without interpreting markup as HTML", () => {
    assert.equal(
      formatSkillDescription(
        "Gain %str1% Health for %str3% seconds; %str2%%% stronger.[s]",
        ["6–26", "10", "2–8"],
      ),
      "Gain 6–26 Health for 2–8 seconds; 10% stronger.s",
    );
  });
});
