/**
 * Proves the companion admits friend data only through the certified lifecycle
 * order and withdraws it before a session or feature transition can reuse it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPANION_ABI, COMPANION_FEATURE_BITS } from "../../src/shared/companion-abi.ts";
import { ADDRESSES, createKernel, installGameGraph } from "../fixtures/enhancements.ts";

const FEATURES = COMPANION_FEATURE_BITS.playRegionObservation
  | COMPANION_FEATURE_BITS.friendObservation;

function utf16(view: DataView, address: number, value: string): void {
  [...value].forEach((character, index) => {
    view.setUint16(address + index * 2, character.codePointAt(0)!, true);
  });
}

function installFriend(view: DataView): void {
  view.setUint32(ADDRESSES.friendRoot, ADDRESSES.friendArray, true);
  view.setUint32(ADDRESSES.friendRoot + 4, 2, true);
  view.setUint32(ADDRESSES.friendRoot + 8, 2, true);
  view.setUint32(ADDRESSES.friendArray, 0, true);
  view.setUint32(ADDRESSES.friendArray + 4, ADDRESSES.friendRecord, true);
  view.setUint32(ADDRESSES.friendRecord, 1, true);
  view.setUint32(ADDRESSES.friendRecord + 4, 1, true);
  view.setUint32(ADDRESSES.friendRecord + 8, 0x0403_0201, true);
  view.setUint32(ADDRESSES.friendRecord + 12, 0x0807_0605, true);
  view.setUint32(ADDRESSES.friendRecord + 16, 0x0c0b_0a09, true);
  view.setUint32(ADDRESSES.friendRecord + 20, 0x100f_0e0d, true);
  utf16(view, ADDRESSES.friendRecord + 24, "Romi");
  utf16(view, ADDRESSES.friendRecord + 64, "Example Ranger");
  view.setUint32(ADDRESSES.friendRecord + 104, 1, true);
  view.setUint32(ADDRESSES.friendRecord + 108, 133, true);
}

function admit(kernel: Awaited<ReturnType<typeof createKernel>>): void {
  kernel.friendLifecycle(2, 7, 9);
  kernel.friendLifecycle(3, 7, 9, 1);
  kernel.friendLifecycle(4);
  kernel.friendLifecycle(5);
  kernel.friendLifecycle(6);
}

describe("friend observation kernel", () => {
  it("publishes only an admitted complete roster and withdraws synchronously", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    installFriend(kernel.view);
    assert.equal(kernel.init({
      features: FEATURES,
      friendRoot: ADDRESSES.friendRoot,
    }), 1);

    kernel.tick();
    assert.deepEqual(kernel.friends(), { status: "waiting", reason: "unavailable" });
    admit(kernel);
    kernel.tick();
    const ready = kernel.friends();
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.friends.length, 1);
    assert.deepEqual(ready.friends[0], {
      key: ready.friends[0]!.key,
      status: "online",
      mapId: 133,
      alias: "Romi",
      character: "Example Ranger",
    });
    assert.notEqual(ready.friends[0]!.key, "0000000000000000");

    kernel.friendLifecycle(1);
    assert.deepEqual(kernel.friends(), { status: "waiting", reason: "unavailable" });

    admit(kernel);
    kernel.tick();
    assert.equal(kernel.friends().status, "ready");
    kernel.activeFeatures(COMPANION_FEATURE_BITS.playRegionObservation);
    assert.deepEqual(kernel.friends(), { status: "waiting", reason: "unavailable" });
  });

  it("refuses a root without its exact feature and host-owned region", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.init({
      features: COMPANION_FEATURE_BITS.playRegionObservation,
      friendRoot: ADDRESSES.friendRoot,
    }), 0);
    assert.equal(kernel.init({ features: FEATURES, friendRoot: ADDRESSES.friendRoot, friendSize: 0 }), 0);
    assert.equal(COMPANION_ABI.friends.bytes, 12_312);
  });
});
