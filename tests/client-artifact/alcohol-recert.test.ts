/** Proves alcohol's native notification and refusal against an explicitly supplied client. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyLocalClientBytes, isLocalClientVerification } from "../../src/main/certification/local-client-verifier.ts";
import { transformEnhancementWasm } from "../../src/main/certification/enhancement-transform.ts";
import { rewriteTemplateSaveWasm } from "../../src/main/certification/template-save-compat.ts";
import { ENHANCEMENT_CAPABILITY_PRESETS } from "../../src/shared/enhancement-contracts.ts";
import { deriveAlcoholObservation, ALCOHOL_PRODUCER_ROLE } from "../../src/main/certification/enhancement-alcohol-proof.ts";
import { wasmEvidence, valuesForRole, soleValue, functionBody } from "../../src/main/certification/wasm-evidence.ts";

test("alcohol proves the native payload and refuses producer or dispatch changes", async () => {
  assert.ok(process.env.GW_CLIENT_WASM, "GW_CLIENT_WASM must explicitly name the real artifact");
  const bytes = await readFile(process.env.GW_CLIENT_WASM);
  const local = verifyLocalClientBytes(bytes, { ...ENHANCEMENT_CAPABILITY_PRESETS.effects, alcoholObservation: true });
  assert.equal(isLocalClientVerification(local, local.officialSha256, { ...ENHANCEMENT_CAPABILITY_PRESETS.effects, alcoholObservation: true }), true);
  assert.ok(local.templateSaveBuild); assert.ok(local.enhancementBuild);
  const transformed = transformEnhancementWasm(rewriteTemplateSaveWasm(bytes, local.templateSaveBuild),
    local.enhancementBuild, { ...ENHANCEMENT_CAPABILITY_PRESETS.effects, alcoholObservation: true });
  assert.equal(WebAssembly.validate(Uint8Array.from(transformed)), true);
  const proof = local.enhancementBuild.alcoholObservation;
  assert.ok(proof);
  const module = wasmEvidence(bytes)?.moduleView(); assert.ok(module);
  const body = functionBody(module, proof.functionIndex);
  const dispatcher = soleValue(valuesForRole(body, ALCOHOL_PRODUCER_ROLE), "alcohol.ui"); assert.ok(dispatcher);
  assert.deepEqual(deriveAlcoholObservation(module, dispatcher), proof);
  assert.equal(deriveAlcoholObservation(module, dispatcher + 1), null);
  const changed = body.slice(); changed[changed.length - 2] = changed[changed.length - 2]! ^ 1;
  const bodies = module.bodies.slice(); bodies[proof.functionIndex - module.functionImportCount] = changed;
  assert.equal(deriveAlcoholObservation({ ...module, bodies }, dispatcher), null);
});
