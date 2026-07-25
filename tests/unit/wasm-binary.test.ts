import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  concat,
  countFunctionImports,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  functionImportIndex,
  paddedIndex,
  parseCode,
  parseIndexVector,
  parseTypes,
  readSleb,
  readUleb,
  sectionById,
  sleb,
  splitSections,
  uleb,
  valueTypeName,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("wasm binary codec", () => {
  it("round-trips unsigned LEB128", () => {
    for (const value of [0, 1, 63, 64, 127, 128, 624, 17_819, 1_131_422]) {
      assert.equal(readUleb(uleb(value), { offset: 0 }), value);
    }
    assert.deepEqual(Array.from(uleb(207)), [0xcf, 0x01]);
    assert.throws(() => uleb(-1), /invalid unsigned value/);
  });

  it("round-trips signed LEB128, including the client's dirfd markers", () => {
    for (const value of [0, 1, -1, 63, -64, 128, -70_001, -70_005]) {
      assert.equal(readSleb(sleb(value), { offset: 0 }), value);
    }
    // The marker the derived module actually carries.
    assert.deepEqual(Array.from(sleb(-70_001)), [0x8f, 0xdd, 0x7b]);
  });

  // LLVM emits relocatable call targets at a fixed five bytes, which is what
  // lets a repoint overwrite a call without changing any body length.
  it("emits fixed-width indices and refuses ones that do not fit", () => {
    assert.equal(paddedIndex(0).byteLength, 5);
    assert.equal(paddedIndex(17_819).byteLength, 5);
    assert.deepEqual(Array.from(paddedIndex(17_819)), [0x9b, 0x8b, 0x81, 0x80, 0x00]);
    assert.equal(readUleb(paddedIndex(17_819), { offset: 0 }), 17_819);
    assert.throws(() => paddedIndex(2 ** 32), /padded call width/);
    assert.throws(() => paddedIndex(-1), /padded call width/);
  });

  it("refuses an oversized LEB rather than truncating it", () => {
    assert.throws(
      () => readUleb(bytes(0x80, 0x80, 0x80, 0x80, 0x80, 0x01), { offset: 0 }),
      /oversized LEB128/,
    );
    assert.throws(() => readUleb(bytes(0x80), { offset: 0 }), /truncated LEB128/);
  });

  it("round-trips sections", () => {
    const body = bytes(1, 2, 3, 4);
    const module = concat(WASM_HEADER, encodeSection({ id: 7, body }));
    const sections = splitSections(module);
    assert.equal(sections.length, 1);
    assert.deepEqual(Array.from(sectionById(sections, 7)), [1, 2, 3, 4]);
    assert.throws(() => sectionById(sections, 3), /missing section 3/);
    assert.throws(() => splitSections(bytes(0, 1, 2)), /invalid WebAssembly header/);
  });

  it("round-trips code bodies and index vectors", () => {
    const bodies = [bytes(0x00, 0x0b), bytes(0x00, 0x41, 0x02, 0x0b)];
    assert.deepEqual(
      parseCode(encodeCode(bodies)).map((body) => Array.from(body)),
      bodies.map((body) => Array.from(body)),
    );
    const indices = [0, 5, 200, 17_600];
    assert.deepEqual(parseIndexVector(encodeIndexVector(indices)), indices);
  });

  it("parses function types by resolved signature", () => {
    // (i32,i32)->i32 and (i32,i32,i32)->()
    const section = bytes(
      2,
      0x60, 2, 0x7f, 0x7f, 1, 0x7f,
      0x60, 3, 0x7f, 0x7f, 0x7f, 0,
    );
    const types = parseTypes(section);
    assert.deepEqual(types[0], { params: [0x7f, 0x7f], results: [0x7f] });
    assert.deepEqual(types[1], { params: [0x7f, 0x7f, 0x7f], results: [] });
    assert.equal(valueTypeName(0x7f), "i32");
    assert.equal(valueTypeName(0x70), "0x70");
  });

  it("counts and names function imports, skipping the other kinds", () => {
    const name = (value: string) =>
      concat(uleb(value.length), new TextEncoder().encode(value));
    const importSection = concat(
      uleb(3),
      name("env"), name("first"), bytes(0x00), uleb(4),
      name("env"), name("memory"), bytes(0x02), bytes(0x00), uleb(1),
      name("env"), name("__syscall_newfstatat"), bytes(0x00), uleb(6),
    );
    assert.equal(countFunctionImports(importSection), 2);
    assert.equal(functionImportIndex(importSection, "first"), 0);
    assert.equal(functionImportIndex(importSection, "__syscall_newfstatat"), 1);
    assert.equal(functionImportIndex(importSection, "absent"), null);
  });
});
