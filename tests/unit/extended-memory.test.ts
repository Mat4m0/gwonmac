import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXTENDED_MEMORY_JS_BUILD,
  EXTENDED_MEMORY_MAX_BYTES,
  EXTENDED_MEMORY_MAX_PAGES,
  EXTENDED_MEMORY_PROFILES,
  EXTENDED_MEMORY_RESEARCH_ENABLED,
  EXTENDED_MEMORY_WASM_BUILDS,
  findExtendedMemoryWasmBuild,
  rewriteExtendedMemoryJs,
  rewriteExtendedMemoryWasm,
} from "../../src/main/certification/extended-memory.js";
import { NATIVE_DOUBLE_CLICK_BUILDS } from "../../src/main/certification/native-double-click.js";
import { ENHANCEMENT_CAPABILITY_PROFILES } from "../../src/shared/enhancement-contracts.js";
import { diagnosticEventRecord } from "../../src/main/diagnostics/schema.js";

describe("research-only extended memory transform", () => {
  it("requires the explicit research environment and stops one page short of 4 GiB", () => {
    assert.equal(
      EXTENDED_MEMORY_RESEARCH_ENABLED,
      process.env.GWONMAC_EXTENDED_MEMORY_RESEARCH === "1",
    );
    assert.equal(EXTENDED_MEMORY_MAX_PAGES, 65_535);
    assert.equal(EXTENDED_MEMORY_MAX_BYTES, 4_294_901_760);
  });

  it("certifies every post-double-click variant the production chain emits", () => {
    const expectedProfiles = [
      "off",
      ...Object.keys(ENHANCEMENT_CAPABILITY_PROFILES),
    ].sort();
    assert.deepEqual(
      EXTENDED_MEMORY_WASM_BUILDS.map((build) => build.profile).sort(),
      expectedProfiles,
    );
    assert.deepEqual([...EXTENDED_MEMORY_PROFILES].sort(), expectedProfiles);
    const doubleClickOutputs = new Set(
      Object.values(NATIVE_DOUBLE_CLICK_BUILDS[0]!.derivations),
    );
    assert.deepEqual(
      new Set(EXTENDED_MEMORY_WASM_BUILDS.map((build) => build.inputSha256)),
      doubleClickOutputs,
    );
  });

  it("pins unique exact inputs and outputs", () => {
    const hashes = [
      EXTENDED_MEMORY_JS_BUILD.inputSha256,
      EXTENDED_MEMORY_JS_BUILD.outputSha256,
      ...EXTENDED_MEMORY_WASM_BUILDS.flatMap((build) => [
        build.inputSha256,
        build.outputSha256,
      ]),
    ];
    assert.equal(new Set(hashes).size, hashes.length);
    for (const hash of hashes) assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("refuses unknown JavaScript and WASM before rewriting either", () => {
    assert.throws(
      () => rewriteExtendedMemoryJs("var getHeapMax = () => 2147483648;"),
      /uncertified JavaScript input/,
    );
    assert.throws(
      () => rewriteExtendedMemoryWasm(Uint8Array.of(0, 97, 115, 109)),
      /uncertified WASM input/,
    );
    assert.equal(findExtendedMemoryWasmBuild("0".repeat(64)), null);
  });

  it("records the effective mode and cap with a closed profile", () => {
    assert.deepEqual(
      diagnosticEventRecord({
        k: "wasm.extendedMemory",
        mode: "active",
        profile: "cursorToolbox",
        capBytes: EXTENDED_MEMORY_MAX_BYTES,
      }),
      {
        subsystem: "wasm",
        level: "info",
        name: "wasm.extendedMemory",
        fields: {
          mode: "active",
          profile: "cursorToolbox",
          capBytes: EXTENDED_MEMORY_MAX_BYTES,
        },
      },
    );
  });
});
