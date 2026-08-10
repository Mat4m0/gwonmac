import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extendedMemoryView } from "../../src/renderer/extended-memory-setting.js";
import { WASM_HEAP_CAP_BYTES } from "../../src/shared/contracts.js";

describe("extended memory Settings projection", () => {
  it("distinguishes unresolved intent from the active standard cap", () => {
    assert.equal(extendedMemoryView(true, null).label, "Checking compatibility…");
    assert.equal(extendedMemoryView(false, {
      requestedAtLaunch: false,
      status: "standard",
      effectiveCapBytes: WASM_HEAP_CAP_BYTES,
      fallbackReason: null,
    }).label, "Using 2 GB");
  });

  it("reports restart only when saved intent differs from this launch", () => {
    const view = extendedMemoryView(false, {
      requestedAtLaunch: true,
      status: "active",
      effectiveCapBytes: 4_294_901_760,
      fallbackReason: null,
    });
    assert.equal(view.label, "Restart required");
    assert.match(view.detail, /still using 4 GB/);
  });

  it("keeps unsupported and preparation failures visibly distinct", () => {
    const base = {
      requestedAtLaunch: true as const,
      status: "unavailable" as const,
      effectiveCapBytes: WASM_HEAP_CAP_BYTES,
    } as const;
    const unsupported = extendedMemoryView(true, {
      ...base,
      fallbackReason: "unsupported-client",
    });
    const failed = extendedMemoryView(true, {
      ...base,
      fallbackReason: "preparation-failed",
    });
    assert.match(unsupported.detail, /has not passed 4 GB certification/);
    assert.match(failed.detail, /could not be prepared safely/);
    assert.notEqual(unsupported.detail, failed.detail);
  });
});
