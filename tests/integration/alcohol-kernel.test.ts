/** Exercises real Rust alcohol observation with disposable native memory. */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANION_FEATURE_BITS } from "../../src/shared/companion-abi.ts";
import { readCompanionAlcohol } from "../../src/renderer/companion-alcohol-snapshot.ts";
import { ADDRESSES, createKernel, installGameGraph } from "../fixtures/enhancements.ts";
const FEATURES = COMPANION_FEATURE_BITS.playRegionObservation | COMPANION_FEATURE_BITS.playerEffectObservation | COMPANION_FEATURE_BITS.alcoholObservation;
async function fixture() {
  const kernel = await createKernel({ partyDetail: true }); installGameGraph(kernel.view);
  assert.equal(kernel.init({ features: FEATURES }), 1);
  const state = () => readCompanionAlcohol(kernel.memory.buffer, ADDRESSES.alcohol);
  const drink = (level: number, tint = 0) => {
    kernel.view.setUint32(0x70000, tint, true); kernel.view.setFloat32(0x70004, level / 5, true);
    const before = new Uint8Array(kernel.memory.buffer, 0x70000, 8).slice();
    kernel.uiEvent(0x10000034, 0x70000, 0);
    assert.deepEqual(new Uint8Array(kernel.memory.buffer, 0x70000, 8), before, "native message remains unchanged");
  };
  const remaining = () => { const s = state(); assert.equal(s.status, "ready"); return s.status === "ready" ? s.remainingMs : -1; };
  return { kernel, state, drink, remaining };
}
test("alcohol starts unknown, counts down, accepts top-ups and expires across clock wrap", async () => {
  const { kernel, state, drink, remaining } = await fixture();
  kernel.tick(0, 1000); assert.equal(state().status, "waiting");
  drink(1); assert.equal(remaining(), 60000);
  kernel.tick(0, 11000); assert.equal(remaining(), 50000);
  drink(2); assert.equal(remaining(), 110000);
  kernel.tick(0, 61000); drink(1); assert.equal(remaining(), 60000);
  kernel.tick(0, 121001); assert.equal(remaining(), 0);
  kernel.tick(0, 0xfffffff0); drink(5);
  kernel.tick(0, 0x10); assert.equal(remaining(), 299968);
});
test("alcohol retains same-character zoning and withdraws on character changes and disable", async () => {
  const { kernel, state, drink, remaining } = await fixture();
  kernel.tick(0, 1000); drink(5);
  kernel.view.setUint32(ADDRESSES.character + 0x23c, 2, true);
  kernel.tick(0, 11000); assert.equal(state().status, "waiting");
  kernel.view.setUint32(ADDRESSES.character + 0x23c, 0, true);
  kernel.tick(0, 21000); assert.equal(remaining(), 280000);
  kernel.view.setUint32(ADDRESSES.character + 0x64, 123, true);
  kernel.tick(0, 22000); assert.equal(state().status, "waiting");
  drink(1); assert.equal(remaining(), 60000);
  kernel.activeFeatures(FEATURES & ~COMPANION_FEATURE_BITS.alcoholObservation);
  kernel.tick(0, 23000); assert.equal(state().status, "waiting");
  kernel.activeFeatures(FEATURES); kernel.tick(0, 24000); assert.equal(state().status, "waiting");
});
test("salad and direct lunar effects do not start a countdown; brandy level progression does", async () => {
  const { kernel, state, drink, remaining } = await fixture(); kernel.tick(0, 1000);
  drink(5, 8); assert.equal(state().status, "waiting");
  drink(5, 6); assert.equal(state().status, "waiting");
  for (let level = 1; level <= 5; level++) drink(level, 6);
  assert.equal(remaining(), 300000);
  kernel.tick(0, 11000); drink(5, 6); assert.equal(remaining(), 290000);
  drink(Number.NaN); assert.equal(remaining(), 290000);
});
