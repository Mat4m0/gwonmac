import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ActiveClientSlot,
  type ClientGeneration,
} from "../../src/main/active-client.js";
import type { SnapshotMetadata } from "../../src/shared/contracts.js";

function snapshot(size: number): SnapshotMetadata {
  return {
    size,
    chunkSize: size,
    chunkHashes: ["a".repeat(32)],
    residentBits: new Uint8Array([1]),
  };
}

function generation(
  wasmPath: string,
  size: number,
): ClientGeneration {
  return {
    artifactsDir: `/client/${size}`,
    store: { size } as ClientGeneration["store"],
    snapshotMeta: snapshot(size),
    wasmPath,
    jsPath: wasmPath.replace(/\.wasm$/, ".js"),
    enhancementBuild: null,
  };
}

describe("atomic active client publication", () => {
  it("replaces the complete generation, including its selected WASM", () => {
    const slot = new ActiveClientSlot();
    const previous = slot.publish(generation("/previous/official.wasm", 10));
    const candidate = slot.publish(generation("/candidate/derived.wasm", 20));
    assert.equal(slot.current, candidate);
    assert.equal(slot.current?.snapshotMeta.size, 20);
    assert.equal(slot.current?.wasmPath, "/candidate/derived.wasm");

    const rollback = slot.publish(generation("/previous/official.wasm", 10));
    assert.notEqual(rollback.generation, previous.generation);
    assert.equal(slot.current?.snapshotMeta.size, 10);
    assert.equal(slot.current?.wasmPath, "/previous/official.wasm");
  });

  it("rejects stale residency completion from an older generation", () => {
    const slot = new ActiveClientSlot();
    const previous = slot.publish(generation("/previous.wasm", 10));
    const current = slot.publish(generation("/current.wasm", 20));
    assert.equal(slot.replaceSnapshot(previous.generation, snapshot(99)), false);
    assert.equal(slot.current, current);
    assert.equal(slot.current?.snapshotMeta.size, 20);
  });
});
