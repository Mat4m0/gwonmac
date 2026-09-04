import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlayerEffectObservationProof } from
  "../../src/main/certification/enhancement-player-effect-proof.ts";

function proof() {
  return {
    accessors: [
      [8905, ["i32", "i32", "i32", "i32", "i32"], "7df2376537653cac9b32172fb51073fa57503b1a2bcceb317a6d282d1e13fb0b"],
      [8906, ["i32", "i32"], "18899c4be6bf2fd51f6dbf6e52241456cdaed94d912ed23f307c95917bf615b8"],
      [8907, ["i32", "i32", "i32", "i32", "i32"], "1f2d462100add0c160d62265d2eaf292a00bfd1cde84c38c1e51f2aac0a2cc57"],
      [8908, ["i32", "i32", "i32", "i32", "f32"], "a560a223d9756fc3579f057137601853ec23c2b6bbd57248216b77ce550d29af"],
      [8909, ["i32", "i32", "i32", "f32"], "ecfa62c1bfaaebe98c2047ad986e137e9695a3cf2f0f7d5f6367b6e44cc10894"],
      [8910, ["i32", "i32"], "3fecf883ff7543db3cfdd8f3d77fc5cf3ef1e78282252f4f3caedbbe4f80bac0"],
    ].map(([functionIndex, params, bodySha256]) => ({
      functionIndex,
      params,
      results: [],
      bodySha256,
    })),
    mutations: {
      addTimed: { functionIndex: 7209, bodySha256: "fe97a736b61e83cc5ea5a84f38aecedd384476339c5b02594fcefeebc5ce5203" },
      renewTimed: { functionIndex: 7210, bodySha256: "cafd172e56cbc1efcc64eb281fd8dadcfb6aa305eb4c165c0959f0903f98f769" },
      remove: { functionIndex: 7211, bodySha256: "5e0ab6365510501ff760de8c3bdfb8682bf918e092d9263441d8fc7f56403533" },
    },
    timer: {
      functionIndex: 249,
      params: [],
      results: ["i32"],
      bodySha256: "c1f93ac7e783305bff7d976dbf55365b67fa6696243305685aa1fb0fb7901030",
    },
    dirtyMessages: [0x10000055, 0x10000056, 0x10000057, 0x10000141],
    layout: {
      worldPartyEffects: 0x508,
      agentEffectsStride: 0x24,
      agentEffectsAgentId: 0,
      agentEffectsEffects: 0x14,
      effectStride: 0x18,
      effectSkillId: 0,
      effectAttributeLevel: 4,
      effectId: 8,
      effectMaintainerAgentId: 0x0c,
      effectDuration: 0x10,
      effectTimestamp: 0x14,
    },
  };
}

test("player-effect proof accepts only the exact fixed semantic contract", () => {
  const valid = proof();
  assert.equal(isPlayerEffectObservationProof(valid), true);
  assert.equal(isPlayerEffectObservationProof({ ...valid, extra: false }), false);
  assert.equal(isPlayerEffectObservationProof({
    ...valid,
    accessors: valid.accessors.map((entry, index) =>
      index === 0 ? { ...entry, params: ["i32"] } : entry),
  }), false);
  assert.equal(isPlayerEffectObservationProof({
    ...valid,
    mutations: {
      ...valid.mutations,
      renewTimed: { ...valid.mutations.renewTimed, bodySha256: "0".repeat(64) },
    },
  }), false);
  assert.equal(isPlayerEffectObservationProof({
    ...valid,
    dirtyMessages: [0x10000055, 0x10000056, 0x10000057, 0x10000057],
  }), false);
  assert.equal(isPlayerEffectObservationProof({
    ...valid,
    layout: { ...valid.layout, effectDuration: 0x14 },
  }), false);
});
