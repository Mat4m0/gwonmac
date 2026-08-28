/** Exact-client proof for the development-only converter wrapper transform. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transformCartographySpikeWasm } from
  "../../src/main/certification/pathing-spike-transform.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  COMPASS_FRAME_SPIKE_GLOBALS,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS,
} from
  "../../src/shared/cartography-spike.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("the exact converter call is wrapped without moving existing functions", {
  timeout: 120_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name the exact official artifact");
  const official = new Uint8Array(await readFile(artifact));
  assert.equal(sha256(official), "e00e8368a1d0e1003bf1882dce2d4b3cd8e2e8b6c4acc72474c8b56e2e35c6bb");
  const before = official.slice();
  const transformed = transformCartographySpikeWasm(official);
  assert.deepEqual(official, before, "the predecessor module was mutated");

  const evidence = wasmEvidence(transformed);
  assert.ok(evidence);
  const decoded = evidence.decodeFunctions([]);
  const loader = decoded.find((candidate) => candidate.functionIndex === 3208);
  assert.ok(loader);
  assert.equal(loader.calls.get(3216) ?? 0, 0);
  const wrapper = decoded.find((candidate) => candidate.calls.get(3216) === 1);
  assert.ok(wrapper);
  assert.ok(wrapper.functionIndex > 3216);
  assert.equal(loader.calls.get(wrapper.functionIndex), 1);
  const exportNames = new Set(WebAssembly.Module.exports(new WebAssembly.Module(Uint8Array.from(transformed)))
    .map(({ name }) => name));
  assert.ok(Object.values(COMPASS_FRAME_SPIKE_GLOBALS)
    .every((name) => exportNames.has(name)));
  assert.ok(Object.values(MISSION_MAP_PROJECTION_SPIKE_GLOBALS)
    .every((name) => exportNames.has(name)));

  const missionMapWrapper = decoded.find((candidate) =>
    candidate.calls.get(16_136) === 1 && candidate.calls.get(13_562) === 1
  );
  assert.ok(missionMapWrapper);
  assert.deepEqual(evidence.tableRelations.get(missionMapWrapper.functionIndex), [4_006]);
  assert.equal(evidence.tableRelations.get(16_136), undefined);
});
