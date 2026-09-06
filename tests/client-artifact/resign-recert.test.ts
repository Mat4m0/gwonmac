/** Proves fixed native Resign authority and its refusal on a changed sender. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyLocalClientBytes, isLocalClientVerification } from "../../src/main/certification/local-client-verifier.js";
import { NO_ENHANCEMENT_CAPABILITIES } from "../../src/shared/enhancement-contracts.js";
import { deriveResignAction } from "../../src/main/certification/enhancement-resign-proof.js";
import { enhancementProofContext } from "../../src/main/certification/wasm-evidence.js";

test("the real client proves Resign and refuses a changed native sender", { timeout: 60_000 }, async () => {
  const filename = process.env.GW_CLIENT_WASM;
  assert.ok(filename, "GW_CLIENT_WASM must name the real official artifact");
  const bytes = new Uint8Array(await readFile(filename));
  const result = verifyLocalClientBytes(bytes);
  assert.equal(result.featureVerdicts?.resignAction.status, "proved");
  assert.equal(isLocalClientVerification(result, result.officialSha256), true);
  const requested = { ...NO_ENHANCEMENT_CAPABILITIES, playRegionObservation: true, resignAction: true };
  const isolated = verifyLocalClientBytes(bytes, requested);
  assert.equal(isolated.featureVerdicts?.resignAction.status, "proved");
  assert.equal(isLocalClientVerification(isolated, isolated.officialSha256, requested), true);
  assert.ok(result.enhancementBuild?.resignAction);
  assert.equal(isLocalClientVerification({ ...result, enhancementBuild: {
    ...result.enhancementBuild, resignAction: {
      ...result.enhancementBuild.resignAction, functionIndex: 1,
    },
  } }, result.officialSha256), false, "the process boundary rejects a substituted native target");
  const context = enhancementProofContext(bytes);
  assert.ok(context);
  const original = context.moduleView();
  const proof = deriveResignAction(original);
  assert.ok(proof);
  const bodies = original.bodies.map(body => Uint8Array.from(body));
  const sender = bodies[proof.functionIndex - original.functionImportCount]!;
  const opcode = sender.findIndex((value, index) => value === 0x41 && sender[index + 1] === 0xe4 && sender[index + 2] === 0);
  assert.ok(opcode >= 0);
  sender[opcode + 1] = 0xe5;
  assert.equal(deriveResignAction({ ...original, bodies }), null);
});
