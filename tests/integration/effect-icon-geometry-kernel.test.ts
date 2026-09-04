/**
 * Verifies bounded native Effects-frame matching and fail-closed withdrawal.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  createKernel,
  FEATURE_EFFECT_ICON_GEOMETRY,
  FEATURE_PLAYER_EFFECT_OBSERVATION,
  FEATURE_PLAY_REGION_OBSERVATION,
  installEffectIconGraph,
  installGameGraph,
  installPlayerEffects,
} from "../fixtures/enhancements.ts";

const EFFECTS_HASH = 0x66e6_211f;
const FEATURES = FEATURE_PLAY_REGION_OBSERVATION
  | FEATURE_PLAYER_EFFECT_OBSERVATION
  | FEATURE_EFFECT_ICON_GEOMETRY;

describe("native effect icon geometry kernel", () => {
  it("matches effect skills to stock children and preserves clipped geometry", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPlayerEffects(kernel.view, [
      { effectId: 11, skillId: 123, durationSeconds: 10, timestamp: 5_000 },
    ]);
    installEffectIconGraph(kernel.view, 123);
    const child = ADDRESSES.frameBuffer + 2 * 0x1c8;
    kernel.view.setFloat32(child + 0x110, -12, true);
    kernel.view.setFloat32(child + 0x118, 36, true);
    assert.equal(kernel.init({ features: FEATURES }), 1);

    kernel.tick(0, 12_000, EFFECTS_HASH);

    const state = kernel.effectIcons();
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.equal(state.frameId, 1);
    assert.deepEqual(state.icons, [{
      skillId: 123,
      left: 100,
      bottom: -12,
      right: 148,
      top: 36,
    }]);
  });

  it("withdraws all geometry when the feature becomes inactive", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPlayerEffects(kernel.view, [
      { effectId: 11, skillId: 123, durationSeconds: 10, timestamp: 5_000 },
    ]);
    installEffectIconGraph(kernel.view, 123);
    assert.equal(kernel.init({ features: FEATURES }), 1);
    kernel.tick(0, 12_000, EFFECTS_HASH);
    assert.equal(kernel.effectIcons().status, "ready");

    kernel.activeFeatures(FEATURE_PLAY_REGION_OBSERVATION
      | FEATURE_PLAYER_EFFECT_OBSERVATION);
    kernel.tick(0, 12_100, EFFECTS_HASH);
    assert.deepEqual(kernel.effectIcons(), { status: "waiting", reason: "inactive" });
  });

  it("refuses two visible children for the same effect skill", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPlayerEffects(kernel.view, [
      { effectId: 11, skillId: 123, durationSeconds: 10, timestamp: 5_000 },
    ]);
    installEffectIconGraph(kernel.view, 123);
    const parent = ADDRESSES.frameBuffer + 0x1c8;
    const duplicate = ADDRESSES.frameBuffer + 3 * 0x1c8;
    kernel.view.setUint32(ADDRESSES.frameCountGlobal, 4, true);
    kernel.view.setUint32(ADDRESSES.frameTable + 3 * 4, duplicate, true);
    kernel.view.setUint32(duplicate + 0xbc, 3, true);
    kernel.view.setUint32(duplicate + 0x18c, 0x4, true);
    kernel.view.setUint32(duplicate + 0xb8, 127, true);
    kernel.view.setUint32(duplicate + 0x128, parent + 0x128, true);
    assert.equal(kernel.init({ features: FEATURES }), 1);

    kernel.tick(0, 12_000, EFFECTS_HASH);

    assert.deepEqual(kernel.effectIcons(), {
      status: "waiting",
      reason: "ambiguous",
      candidateCount: 2,
    });
  });
});
