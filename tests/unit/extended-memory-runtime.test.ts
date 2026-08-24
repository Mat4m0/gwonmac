import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXTENDED_MEMORY_MAX_BYTES } from "../../src/main/certification/extended-memory.js";
import { extendedMemoryRuntimeStatus } from "../../src/main/extended-memory-runtime.js";
import { WASM_HEAP_CAP_BYTES } from "../../src/shared/contracts.js";

describe("extended memory runtime result", () => {
  it("keeps unresolved selection outside the result and maps standard mode", () => {
    const unresolved = null;
    assert.equal(unresolved, null);
    assert.deepEqual(extendedMemoryRuntimeStatus({ status: "disabled" }), {
      requestedAtLaunch: false,
      status: "standard",
      effectiveCapBytes: WASM_HEAP_CAP_BYTES,
      fallbackReason: null,
    });
  });

  it("reports the certified active profile and cap", () => {
    assert.deepEqual(extendedMemoryRuntimeStatus({
      status: "active",
      profile: "features-20d",
      effectiveCapBytes: EXTENDED_MEMORY_MAX_BYTES,
    }), {
      requestedAtLaunch: true,
      status: "active",
      effectiveCapBytes: EXTENDED_MEMORY_MAX_BYTES,
      fallbackReason: null,
    });
  });

  for (const reason of ["unsupported-client", "preparation-failed"] as const) {
    it(`falls back truthfully after ${reason}`, () => {
      const error = new Error("closed test error");
      const mode = reason === "preparation-failed"
        ? { status: "unavailable" as const, reason, error }
        : { status: "unavailable" as const, reason };
      assert.deepEqual(extendedMemoryRuntimeStatus(mode), {
        requestedAtLaunch: true,
        status: "unavailable",
        effectiveCapBytes: WASM_HEAP_CAP_BYTES,
        fallbackReason: reason,
      });
    });
  }
});
