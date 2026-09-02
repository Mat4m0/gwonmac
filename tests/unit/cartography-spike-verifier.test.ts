import assert from "node:assert/strict";
import test from "node:test";
import { isCartographySpikeBuild } from
  "../../src/main/certification/cartography-spike-verifier.js";
import { CARTOGRAPHY_SPIKE_TRANSFORM_ABI } from
  "../../src/main/certification/pathing-spike-transform.js";

const inputSha256 = "a".repeat(64);
const outputSha256 = "b".repeat(64);
const build = Object.freeze({
  inputSha256,
  transformAbi: CARTOGRAPHY_SPIKE_TRANSFORM_ABI,
  memoryLayout: "relocated",
  outputSha256,
});

test("accepts only an exact input-bound Cartography certificate", () => {
  assert.equal(isCartographySpikeBuild(build, inputSha256), true);
  assert.equal(isCartographySpikeBuild(build, "c".repeat(64)), false);
  assert.equal(isCartographySpikeBuild({ ...build, memoryLayout: "guessed" }, inputSha256), false);
  assert.equal(isCartographySpikeBuild({ ...build, outputSha256: "short" }, inputSha256), false);
  assert.equal(isCartographySpikeBuild({ ...build, nativePointer: 0x5a6928 }, inputSha256), false);
});
