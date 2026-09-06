/** Qualifies the whisper proof against the retained official client, offline. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyLocalClientBytes, isLocalClientVerification } from "../../src/main/certification/local-client-verifier.ts";
import { NO_ENHANCEMENT_CAPABILITIES } from "../../src/shared/enhancement-contracts.ts";
import { concat, encodeCode, encodeSection, parseCode, sectionById, splitSections, WASM_HEADER } from "../../src/main/core/wasm-binary.ts";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.ts";

const requested = { ...NO_ENHANCEMENT_CAPABILITIES, playRegionObservation: true, chatFiltering: true, whisperChat: true };
test("whisper certification binds the current sender, copier and observer encoders", { timeout: 120_000 }, async () => {
  assert.ok(process.env.GW_CLIENT_WASM, "GW_CLIENT_WASM must name a retained official artifact");
  const bytes = new Uint8Array(await readFile(process.env.GW_CLIENT_WASM));
  const result = verifyLocalClientBytes(bytes, requested);
  assert.equal(result.featureVerdicts?.whisperChat.status, "proved");
  assert.equal(isLocalClientVerification(result, result.officialSha256, requested), true);
  assert.ok(result.enhancementBuild?.whisperChat);
  const imported = wasmEvidence(bytes)!.moduleView().functionImportCount;
  for (const changed of [358, 11733, 5865, 5871, 7875]) {
    const sections = splitSections(bytes);
    const bodies = parseCode(sectionById(sections, 10));
    const body = bodies[changed - imported]!;
    // An inserted nop preserves WASM validity but invalidates the reviewed body.
    bodies[changed - imported] = concat(body.slice(0, -1), Uint8Array.of(1), body.slice(-1));
    const edited = concat(WASM_HEADER, ...sections.map(s => encodeSection(s.id === 10 ? { id: 10, body: encodeCode(bodies) } : s)));
    assert.equal(WebAssembly.validate(Uint8Array.from(edited)), true);
    const refusal = verifyLocalClientBytes(edited, requested);
    assert.notEqual(refusal.featureVerdicts?.whisperChat.status, "proved", `changed function ${changed}`);
    assert.equal(refusal.featureVerdicts?.playRegionObservation.status, "proved");
  }
});
