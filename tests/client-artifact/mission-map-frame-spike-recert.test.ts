/** The development Mission Map locator refuses disagreement in the shared frame proof. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ENHANCEMENT_BUILDS } from
  "../../src/main/certification/enhancement-builds.js";
import { deriveMissionMapFrameSpikeProof } from
  "../../src/main/certification/mission-map-frame-spike-proof.js";
import { wasmEvidence } from
  "../../src/main/certification/wasm-evidence.js";

test("certifies MapWindow geometry and refuses a changed retained layout", {
  timeout: 120_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name the retained official artifact");
  const context = wasmEvidence(new Uint8Array(await readFile(artifact)));
  const retained = ENHANCEMENT_BUILDS[0];
  assert.ok(context && retained?.preGameControls && retained.skillSlotGeometry);

  const proof = deriveMissionMapFrameSpikeProof(
    context,
    retained.preGameControls,
    retained.skillSlotGeometry,
  );
  assert.ok(proof);
  assert.equal(proof.labelHash, 3_378_147_614);
  assert.deepEqual(Object.keys(proof.layout).sort(), [
    "frameArray", "frameBytes", "frameCount", "frameHashId", "frameId",
    "frameScreenBottom", "frameScreenLeft", "frameScreenRight", "frameScreenTop",
    "frameState", "frameViewportHeight", "frameViewportWidth",
  ].sort());

  const changedSkillFrame = {
    ...retained.skillSlotGeometry,
    layout: {
      ...retained.skillSlotGeometry.layout,
      frameState: retained.skillSlotGeometry.layout.frameState + 4,
    },
  };
  assert.equal(
    deriveMissionMapFrameSpikeProof(context, retained.preGameControls, changedSkillFrame),
    null,
  );
});
