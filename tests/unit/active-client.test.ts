import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ActiveClientSlot,
  type ClientGeneration,
} from "../../src/main/active-client.js";

function generation(
  wasmPath: string,
  size: number,
): ClientGeneration {
  return {
    artifactsDir: `/client/${size}`,
    store: { size } as ClientGeneration["store"],
    wasmPath,
    jsPath: wasmPath.replace(/\.wasm$/, ".js"),
    compatibility: {
      state: size === 10 ? "certified" : "uncertified",
      clientSha256: String(size).padStart(64, "0"),
      enhancementActive: size === 20,
    },
    extendedMemory: size === 10
      ? {
          requestedAtLaunch: false,
          status: "standard",
          effectiveCapBytes: 2_147_483_648,
          fallbackReason: null,
        }
      : {
          requestedAtLaunch: true,
          status: "active",
          effectiveCapBytes: 4_294_967_296,
          fallbackReason: null,
        },
  };
}

describe("atomic active client publication", () => {
  it("replaces the complete generation, including its selected WASM", () => {
    const slot = new ActiveClientSlot();
    const previous = slot.publish(generation("/previous/official.wasm", 10));
    const candidate = slot.publish(generation("/candidate/derived.wasm", 20));
    assert.equal(slot.current, candidate);
    assert.equal(slot.current?.wasmPath, "/candidate/derived.wasm");
    assert.equal(slot.current?.compatibility?.state, "uncertified");
    assert.equal(slot.current?.extendedMemory.status, "active");

    const rollback = slot.publish(generation("/previous/official.wasm", 10));
    assert.notEqual(rollback.generation, previous.generation);
    assert.equal(slot.current?.wasmPath, "/previous/official.wasm");
    assert.equal(slot.current?.compatibility?.state, "certified");
    assert.equal(slot.current?.extendedMemory.status, "standard");
  });

  it("does not expose prepared facts until the complete generation publishes", () => {
    const slot = new ActiveClientSlot();
    const previous = slot.publish(generation("/previous.wasm", 10));
    const prepared = generation("/candidate.wasm", 20);

    assert.equal(slot.current, previous);
    assert.equal(slot.current?.compatibility?.state, "certified");
    assert.equal(slot.current?.extendedMemory.status, "standard");

    const candidate = slot.publish(prepared);
    assert.equal(slot.current, candidate);
    assert.equal(slot.current?.wasmPath, "/candidate.wasm");
    assert.equal(slot.current?.compatibility?.state, "uncertified");
    assert.equal(slot.current?.extendedMemory.status, "active");
  });
});
