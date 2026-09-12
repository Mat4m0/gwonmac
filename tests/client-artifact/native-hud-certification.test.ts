/** Proves native HUD refusal stays independent of the observation capabilities. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyLocalClientBytes, isLocalClientVerification } from "../../src/main/certification/local-client-verifier.js";
import { rewriteTemplateSaveWasm } from "../../src/main/certification/template-save-compat.js";
import { transformEnhancementWasm } from "../../src/main/certification/enhancement-transform.js";
import { supportedEnhancementCapabilities } from "../../src/main/certification/enhancement-builds.js";
import { appendNativeHud } from "../../src/main/certification/native-hud-transform.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import { concat, encodeCode, encodeSection, parseCode, sectionById, splitSections, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { ENHANCEMENT_CAPABILITY_PRESETS } from "../../src/shared/enhancement-contracts.js";

test("changed native HUD ownership refuses only rendering and preserves independent observers", () => {
  assert.ok(process.env.GW_CLIENT_WASM);
  return readFile(process.env.GW_CLIENT_WASM).then((bytes) => {
    const input = new Uint8Array(bytes);
    const evidence = wasmEvidence(input); assert.ok(evidence);
    const sections = splitSections(input), bodies = parseCode(sectionById(sections, 10));
    const local = 6492 - evidence.moduleView().functionImportCount;
    const original = bodies[local]!;
    // Harmless code drift must revoke the exact draw-owner proof while leaving
    // the separately proved skill/effect observation and other Tools intact.
    bodies[local] = concat(original.slice(0, -1), Uint8Array.of(0x01, 0x0b));
    const changed = concat(WASM_HEADER, ...sections.map((section) => encodeSection(section.id === 10
      ? { id: 10, body: encodeCode(bodies) } : section)));
    assert.ok(WebAssembly.validate(new Uint8Array(changed)));
    assert.throws(() => appendNativeHud(changed, 0), /native HUD rendering proof changed/);
    const requested = ENHANCEMENT_CAPABILITY_PRESETS.all;
    const verified = verifyLocalClientBytes(changed, requested);
    assert.equal(isLocalClientVerification(verified, verified.officialSha256, requested), true);
    const build = verified.enhancementBuild; assert.ok(build);
    assert.equal(build.nativeHudRendering, undefined);
    assert.deepEqual(verified.featureVerdicts?.nativeHudRendering.status, "changed");
    for (const feature of ["nativeCursor", "partyObservation", "skillSlotGeometry", "skillCooldownObservation", "playerEffectObservation", "effectIconGeometry", "alcoholObservation"] as const) {
      assert.equal(verified.featureVerdicts?.[feature].status, "proved", `${feature} remains independently certified`);
    }
    assert.ok(verified.templateSaveBuild);
    const template = rewriteTemplateSaveWasm(changed, verified.templateSaveBuild);
    const output = transformEnhancementWasm(template, build, supportedEnhancementCapabilities(build));
    const outputEvidence = wasmEvidence(output); assert.ok(outputEvidence);
    assert.equal(outputEvidence.moduleView().exports.some(({ name }) => name.startsWith("gwonmac_hud_")), false);
  });
});
