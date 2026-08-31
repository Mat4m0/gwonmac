/** Exact-client proof for the native Cartography observer transform. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transformCartographySpikeWasm } from
  "../../src/main/certification/pathing-spike-transform.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  CARTOGRAPHY_CONTEXT_GLOBALS,
  COMPASS_FRAME_SPIKE_GLOBALS,
  EXPLORATION_SPIKE_GLOBALS,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS,
  WORLD_MAP_ANCHOR_SPIKE_GLOBALS,
  WORLD_MAP_FRAME_SPIKE_GLOBALS,
} from
  "../../src/shared/cartography-spike.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("the certified context is added without intercepting native pathing", {
  timeout: 120_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name the exact official artifact");
  const official = new Uint8Array(await readFile(artifact));
  assert.equal(sha256(official), "e00e8368a1d0e1003bf1882dce2d4b3cd8e2e8b6c4acc72474c8b56e2e35c6bb");
  const before = official.slice();
  const transformed = transformCartographySpikeWasm(official, "official");
  assert.deepEqual(official, before, "the predecessor module was mutated");

  const evidence = wasmEvidence(transformed);
  assert.ok(evidence);
  const decoded = evidence.decodeFunctions([]);
  const loader = decoded.find((candidate) => candidate.functionIndex === 3208);
  assert.ok(loader);
  assert.equal(loader.calls.get(3216), 1, "the client's converter call must remain intact");
  const exportNames = new Set(WebAssembly.Module.exports(new WebAssembly.Module(Uint8Array.from(transformed)))
    .map(({ name }) => name));
  assert.ok(Object.values(CARTOGRAPHY_CONTEXT_GLOBALS)
    .every((name) => exportNames.has(name)));
  assert.ok(Object.values(COMPASS_FRAME_SPIKE_GLOBALS)
    .every((name) => exportNames.has(name)));
  assert.ok(Object.values(MISSION_MAP_PROJECTION_SPIKE_GLOBALS)
    .every((name) => exportNames.has(name)));
  assert.ok(Object.values(EXPLORATION_SPIKE_GLOBALS)
    .every((name) => exportNames.has(name)));
  assert.ok(Object.values(WORLD_MAP_ANCHOR_SPIKE_GLOBALS)
    .every((name) => exportNames.has(name)));
  assert.ok(Object.values(WORLD_MAP_FRAME_SPIKE_GLOBALS)
    .every((name) => exportNames.has(name)));
  assert.equal(
    [...exportNames].some((name) => name.includes("pathing")),
    false,
    "native pathing data must never be exported to the renderer",
  );

  const missionMapWrapper = decoded.find((candidate) =>
    candidate.calls.get(16_136) === 1 && candidate.calls.get(13_562) === 1
  );
  assert.ok(missionMapWrapper);
  assert.deepEqual(evidence.tableRelations.get(missionMapWrapper.functionIndex), [4_006]);
  assert.equal(evidence.tableRelations.get(16_136), undefined);
  const worldMapWrapper = decoded.find((candidate) => candidate.calls.get(16_223) === 1);
  assert.ok(worldMapWrapper);
  assert.deepEqual(evidence.tableRelations.get(worldMapWrapper.functionIndex), [4_152]);
  assert.equal(evidence.tableRelations.get(16_223), undefined);
});
