import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActiveClientSlot, type ClientGeneration } from "../../src/main/active-client.js";

const available = { status: "available" } as const;
const unavailable = { status: "unavailable", reason: "game-update" } as const;

function generation(wasmPath: string, size: number): ClientGeneration {
  const supported = size === 10;
  return {
    artifactsDir: `/client/${size}`,
    store: { size } as ClientGeneration["store"],
    wasmPath,
    jsPath: wasmPath.replace(/\.wasm$/, ".js"),
    compatibility: {
      clientSha256: String(size).padStart(64, "0"),
      features: {
        gameFileSaving: supported ? available : unavailable,
        nativeCursor: supported ? available : unavailable,
        playRegionObservation: { status: "off" },
        targetObservation: { status: "off" },
        partyObservation: { status: "off" },
        teamApply: { status: "off" },
        travelAction: { status: "off" },
        xunlaiAction: { status: "off" },
        chatAliases: { status: "off" },
        skillSlotGeometry: { status: "off" },
        skillCooldownObservation: { status: "off" },
      },
    },
    extendedMemory: supported
      ? { requestedAtLaunch: false, status: "standard", effectiveCapBytes: 2_147_483_648, fallbackReason: null }
      : { requestedAtLaunch: true, status: "active", effectiveCapBytes: 4_294_967_296, fallbackReason: null },
  };
}

describe("atomic active client publication", () => {
  it("publishes the selected module and its complete effective feature map together", () => {
    const slot = new ActiveClientSlot();
    const previous = slot.publish(generation("/previous/official.wasm", 10));
    const candidate = slot.publish(generation("/candidate/derived.wasm", 20));
    assert.equal(slot.current, candidate);
    assert.equal(slot.current?.wasmPath, "/candidate/derived.wasm");
    assert.equal(slot.current?.compatibility?.features.nativeCursor.status, "unavailable");
    assert.equal(slot.current?.extendedMemory.status, "active");

    const rollback = slot.publish(generation("/previous/official.wasm", 10));
    assert.notEqual(rollback.generation, previous.generation);
    assert.equal(slot.current?.compatibility?.features.nativeCursor.status, "available");
    assert.equal(slot.current?.extendedMemory.status, "standard");
  });
});
