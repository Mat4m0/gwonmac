import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  createKernel,
  FEATURE_PLAYER_EFFECT_OBSERVATION,
  FEATURE_PLAY_REGION_OBSERVATION,
  installGameGraph,
  installPlayerEffects,
} from "../fixtures/enhancements.ts";

const EFFECT_FEATURES = FEATURE_PLAY_REGION_OBSERVATION
  | FEATURE_PLAYER_EFFECT_OBSERVATION;

describe("controlled-player effect observation kernel", () => {
  it("publishes exact records, refreshes, removals, and timer heartbeats", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPlayerEffects(kernel.view, [
      { effectId: 11, skillId: 123, durationSeconds: 10, timestamp: 5_000 },
      { effectId: 12, skillId: 123, durationSeconds: 0, timestamp: 6_000 },
    ]);
    assert.equal(kernel.init({ features: EFFECT_FEATURES }), 1);

    kernel.tick(0, 12_000);
    let state = kernel.playerEffects();
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.deepEqual(state.effects.map(({ effectId, skillId, durationMs }) =>
      ({ effectId, skillId, durationMs })), [
      { effectId: 11, skillId: 123, durationMs: 10_000 },
      { effectId: 12, skillId: 123, durationMs: 0 },
    ]);
    const generation = state.generation;

    installPlayerEffects(kernel.view, [
      { effectId: 11, skillId: 123, durationSeconds: 18, timestamp: 12_000 },
    ]);
    kernel.uiEvent(0x1000_0056, 0, 0);
    kernel.tick(0, 12_100);
    state = kernel.playerEffects();
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.ok(state.generation > generation);
    assert.equal(state.effects[0]?.durationMs, 18_000);
    assert.equal(state.effects[0]?.appliedAtGameMs, 12_000);

    installPlayerEffects(kernel.view, []);
    kernel.uiEvent(0x1000_0057, 0, 0);
    kernel.tick(0, 12_200);
    state = kernel.playerEffects();
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.deepEqual(state.effects, []);

    const sequence = state.sequence;
    for (let index = 0; index < 6; index += 1) kernel.tick(0, 12_300 + index);
    state = kernel.playerEffects();
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.ok(state.sequence > sequence);
    assert.equal(state.gameTimer, 12_305);
  });

  it("withdraws malformed, overflowed, loading, and PvP state", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPlayerEffects(kernel.view, [
      { effectId: 11, skillId: 123, durationSeconds: Number.NaN, timestamp: 5_000 },
    ]);
    assert.equal(kernel.init({ features: EFFECT_FEATURES }), 1);
    kernel.tick(0, 12_000);
    assert.deepEqual(kernel.playerEffects(), {
      status: "waiting", reason: "effect-record",
    });

    installPlayerEffects(kernel.view, []);
    kernel.view.setUint32(ADDRESSES.agentEffectRows + 0x18, 65, true);
    kernel.view.setUint32(ADDRESSES.agentEffectRows + 0x1c, 65, true);
    kernel.uiEvent(0x1000_0055, 0, 0);
    kernel.tick(0, 12_100);
    assert.deepEqual(kernel.playerEffects(), {
      status: "waiting", reason: "overflow",
    });

    kernel.view.setUint32(ADDRESSES.character + 0x23c, 2, true);
    kernel.uiEvent(0x1000_0055, 0, 0);
    kernel.tick(0, 12_200);
    assert.deepEqual(kernel.playerEffects(), {
      status: "waiting", reason: "loading",
    });

    installPlayerEffects(kernel.view, []);
    kernel.view.setUint32(ADDRESSES.areaInfo + 133 * 0x7c + 0x10, 1, true);
    kernel.view.setUint32(ADDRESSES.character + 0x23c, 1, true);
    kernel.view.setUint32(ADDRESSES.character + 0x19c, 1, true);
    kernel.uiEvent(0x1000_0055, 0, 0);
    kernel.tick(0, 12_300);
    assert.deepEqual(kernel.playerEffects(), {
      status: "waiting", reason: "policy-layout",
    });
  });

  it("uses the established GameContext to WorldContext route", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPlayerEffects(kernel.view, [
      { effectId: 11, skillId: 123, durationSeconds: 10, timestamp: 5_000 },
    ]);
    assert.equal(kernel.init({ features: EFFECT_FEATURES }), 1);
    kernel.tick(0, 12_000);
    assert.equal(kernel.playerEffects().status, "ready");

    kernel.view.setUint32(ADDRESSES.game + 0x2c, 0, true);
    kernel.uiEvent(0x1000_0055, 0, 0);
    kernel.tick(0, 12_100);
    assert.deepEqual(kernel.playerEffects(), {
      status: "waiting", reason: "world-context",
    });
  });

  it("treats empty and sparse outer collections as zero effects", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    const header = ADDRESSES.world + 0x508;
    kernel.view.setUint32(header, 0, true);
    kernel.view.setUint32(header + 4, 0, true);
    kernel.view.setUint32(header + 8, 0, true);
    assert.equal(kernel.init({ features: EFFECT_FEATURES }), 1);
    kernel.tick(0, 12_000);
    let state = kernel.playerEffects();
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.deepEqual(state.effects, []);
    assert.equal(state.playerAgentId, 7);

    kernel.view.setUint32(header, ADDRESSES.agentEffectRows, true);
    kernel.view.setUint32(header + 4, 1, true);
    kernel.view.setUint32(header + 8, 1, true);
    kernel.view.setUint32(ADDRESSES.agentEffectRows, 99, true);
    kernel.uiEvent(0x1000_0055, 0, 0);
    kernel.tick(0, 12_100);
    state = kernel.playerEffects();
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.deepEqual(state.effects, []);
  });
});
