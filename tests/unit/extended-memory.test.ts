import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveExtendedMemoryWasm,
  EXTENDED_MEMORY_JS_PROOF,
  EXTENDED_MEMORY_MAX_BYTES,
  EXTENDED_MEMORY_MAX_PAGES,
  EXTENDED_MEMORY_PROFILES,
  normalizeExtendedMemoryJsForProof,
  rewriteExtendedMemoryJs,
  rewriteExtendedMemoryWasm,
} from "../../src/main/certification/extended-memory.js";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
} from "../../src/shared/enhancement-contracts.js";
import {
  concat,
  encodeSection,
  splitSections,
  uleb,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import { diagnosticEventRecord } from "../../src/main/diagnostics/schema.js";

function memoryModule(initial = 4_096, maximum = 32_768): Uint8Array {
  return concat(
    WASM_HEADER,
    encodeSection({
      id: 5,
      body: concat(uleb(1), uleb(1), uleb(initial), uleb(maximum)),
    }),
    encodeSection({ id: 7, body: uleb(0) }),
  );
}

describe("certified extended memory transform", () => {
  it("stops one page short of 4 GiB", () => {
    assert.equal(EXTENDED_MEMORY_MAX_PAGES, 65_535);
    assert.equal(EXTENDED_MEMORY_MAX_BYTES, 4_294_901_760);
  });

  it("covers every valid runtime feature profile without a hash cross-product", () => {
    assert.deepEqual(
      [...EXTENDED_MEMORY_PROFILES].sort(),
      ["off", ...Object.keys(ENHANCEMENT_CAPABILITY_PROFILES)].sort(),
    );
  });

  it("normalizes only all 59 ASM_CONSTS keys", () => {
    const entries = Array.from({ length: 59 }, (_, index) =>
      `  ${1000 + index}: () => ${index},  `).join("\r\n");
    const first = `prefix\r\nvar ASM_CONSTS = {\r\n${entries}\r\n};\r\nfunction __asyncjs__tail`;
    const relocated = first.replace(/^ {2}\d+: /gm, (entry) =>
      entry.replace(/\d+/, (value) => String(Number(value) + 5000)));
    assert.equal(
      normalizeExtendedMemoryJsForProof(first),
      normalizeExtendedMemoryJsForProof(relocated),
    );
    assert.equal(
      normalizeExtendedMemoryJsForProof(first.replace("() => 12", "() => 13"))
        === normalizeExtendedMemoryJsForProof(first),
      false,
    );
    assert.match(EXTENDED_MEMORY_JS_PROOF.normalizedSha256, /^[0-9a-f]{64}$/);
  });

  it("refuses changed JavaScript semantics and a changed memory shape", () => {
    assert.throws(
      () => rewriteExtendedMemoryJs("var getHeapMax = () => 2147483648;"),
      /JavaScript glue semantics changed/,
    );
    assert.throws(
      () => rewriteExtendedMemoryWasm(Uint8Array.of(0, 97, 115, 109)),
      /memory declaration|unexpected end|invalid/i,
    );
    assert.throws(() => rewriteExtendedMemoryWasm(memoryModule(4_096, 32_767)));
  });

  it("changes only the sole memory maximum and validates the result", () => {
    const input = memoryModule();
    const output = deriveExtendedMemoryWasm(input);
    assert.equal(WebAssembly.validate(Uint8Array.from(output)), true);
    const before = splitSections(input);
    const after = splitSections(output);
    assert.equal(after.length, before.length);
    assert.deepEqual(
      after.filter((section) => section.id !== 5),
      before.filter((section) => section.id !== 5),
    );
    assert.notDeepEqual(
      after.find((section) => section.id === 5),
      before.find((section) => section.id === 5),
    );
  });

  it("records the effective mode and cap with a closed profile", () => {
    assert.deepEqual(
      diagnosticEventRecord({
        k: "wasm.extendedMemory",
        mode: "active",
        requested: true,
        profile: "cursorParty",
        capBytes: EXTENDED_MEMORY_MAX_BYTES,
        fallbackReason: "none",
      }),
      {
        subsystem: "wasm",
        level: "info",
        name: "wasm.extendedMemory",
        fields: {
          mode: "active",
          requested: true,
          profile: "cursorParty",
          capBytes: EXTENDED_MEMORY_MAX_BYTES,
          fallbackReason: "none",
        },
      },
    );
  });
});
