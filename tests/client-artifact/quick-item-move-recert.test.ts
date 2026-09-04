/** Proves the bounded Quick Item Move callbacks against an explicit real client. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "../../src/main/certification/local-client-verifier.js";

test("the real client proves and validates Quick Item Move", {
  timeout: 60_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must explicitly name the real Gw.jspi.wasm artifact");
  const verification = verifyLocalClientBytes(new Uint8Array(await readFile(artifact)));
  assert.equal(verification.status, "proved");
  assert.equal(verification.featureVerdicts?.quickItemMove.status, "proved");
  assert.ok(verification.enhancementBuild?.quickItemMove);
  assert.equal(isLocalClientVerification(
    verification,
    verification.officialSha256,
  ), true);
});
