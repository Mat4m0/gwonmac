import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  toolboxLayoutWords,
  type KnownToolboxBuild,
} from "../../src/main/core/toolbox-builds.js";
import {
  inspectToolboxCandidate,
  TOOLBOX_HOOK_EXPORT,
  TOOLBOX_MANIFEST_SECTION,
  TOOLBOX_ORIGINAL_EXPORT,
  TOOLBOX_TRANSFORM_ABI,
  transformToolboxWasm,
} from "../../src/main/core/toolbox-transform.js";

function uleb(value: number): number[] {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

function fixture(occupied = false): Uint8Array {
  const type = section(1, [1, 0x60, 1, 0x7f, 0]);
  const imports = section(2, [0]);
  const functions = section(3, [1, 0]);
  const table = section(4, [1, 0x70, 1, 1, 1]);
  const globals = section(6, [0]);
  const tableName = [...uleb(3), 116, 98, 108];
  const loopName = [...new TextEncoder().encode("EmscriptenExeThreadMainLoop")];
  const exports = section(7, [
    2,
    ...tableName, 1, 0,
    ...uleb(loopName.length), ...loopName, 0, 0,
  ]);
  const elements = section(
    9,
    occupied ? [1, 0, 0x41, 0, 0x0b, 1, 0] : [0],
  );
  const body = [0, 0x0b];
  const code = section(10, [1, ...uleb(body.length), ...body]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...type, ...imports, ...functions, ...table, ...globals, ...exports,
    ...elements, ...code,
  ]);
}

function manifest(bytes: Uint8Array): KnownToolboxBuild {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    programId: 1,
    buildId: 1,
    hookFunction: 0,
    hookParams: ["i32"],
    hookResults: [],
    tableSlot: 0,
    layout: {
      contextRoot: 1, agentArray: 2, targetAgentId: 3, gameContextSlot: 6,
      characterContext: 4, mapId: 5, isExplorable: 6, currentMapId: 7,
      currentInstanceType: 8, playerNumber: 9, agentId: 10, agentX: 11,
      agentY: 12, agentType: 13, agentPlayerNumber: 14, agentModelType: 15,
    },
  };
}

describe("targeted Toolbox WebAssembly transform", () => {
  it("is deterministic, valid, and exports only the hook contract", () => {
    const input = fixture();
    const build = manifest(input);
    const first = transformToolboxWasm(input, build);
    const second = transformToolboxWasm(input, build);
    assert.deepEqual(first, second);
    assert.equal(WebAssembly.validate(first), true);
    const module = new WebAssembly.Module(first);
    const names = WebAssembly.Module.exports(module).map((entry) => entry.name);
    assert.ok(names.includes(TOOLBOX_HOOK_EXPORT));
    assert.ok(names.includes(TOOLBOX_ORIGINAL_EXPORT));
    const sections = WebAssembly.Module.customSections(
      module,
      TOOLBOX_MANIFEST_SECTION,
    );
    assert.equal(sections.length, 1);
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(sections[0])),
      {
        transformAbi: TOOLBOX_TRANSFORM_ABI,
        snapshotAbi: 1,
        snapshotBytes: 64,
        configBytes: 64,
        programId: build.programId,
        buildId: build.buildId,
        tableSlot: build.tableSlot,
        layoutWords: toolboxLayoutWords(build.layout),
      },
    );
  });

  it("reports the semantic loop signature and reusable empty slots", () => {
    const report = inspectToolboxCandidate(fixture());
    assert.equal(report.validWasm, true);
    assert.deepEqual(report.mainLoop, {
      functionIndex: 0,
      params: ["i32"],
      results: [],
    });
    assert.deepEqual(report.table, {
      min: 1,
      max: 1,
      firstEmptySlots: [0],
    });
  });

  it("rejects an occupied slot, hash mismatch, and signature mismatch", () => {
    const occupied = fixture(true);
    assert.throws(
      () => transformToolboxWasm(occupied, manifest(occupied)),
      /occupied/,
    );
    const input = fixture();
    assert.throws(
      () => transformToolboxWasm(input, { ...manifest(input), sha256: "0".repeat(64) }),
      /unsupported/,
    );
    assert.throws(
      () => transformToolboxWasm(input, { ...manifest(input), hookParams: ["i64"] }),
      /signature/,
    );
  });
});
