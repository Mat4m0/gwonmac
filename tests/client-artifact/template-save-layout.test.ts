import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  concat, encodeCode, encodeSection, paddedIndex, parseCode,
  sectionById, splitSections, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import {
  deriveEquivalentTemplateSaveBuild,
} from "../../src/main/certification/template-save-verifier.js";
import { rewriteTemplateSaveWasm } from "../../src/main/certification/template-save-compat.js";
import { decodeFunctions, wasmEvidence } from "../../src/main/certification/wasm-evidence.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function rewriteCode(
  input: Uint8Array,
  edit: (bodies: Uint8Array[]) => void,
): Uint8Array {
  const sections = splitSections(input);
  const bodies = parseCode(sectionById(sections, 10));
  edit(bodies);
  return concat(
    WASM_HEADER,
    ...sections.map((sectionValue) => encodeSection(sectionValue.id === 10
      ? { id: 10, body: encodeCode(bodies) }
      : sectionValue)),
  );
}

test("retained client layouts share one complete template semantic proof", {
  timeout: 120_000,
}, async () => {
  const artifacts = [
    process.env.GW_CLIENT_WASM_PREVIOUS,
    process.env.GW_CLIENT_WASM,
  ].filter((value): value is string => Boolean(value));
  assert.ok(artifacts.length > 0, "GW_CLIENT_WASM must name a retained client artifact");
  for (const artifact of artifacts) {
    const bytes = new Uint8Array(await readFile(artifact));
    const build = deriveEquivalentTemplateSaveBuild(bytes);
    assert.ok(build, `${artifact} must pass complete template semantic proof`);
    const output = rewriteTemplateSaveWasm(bytes, build);
    assert.equal(WebAssembly.validate(new Uint8Array(output)), true);
    assert.equal(sha256(output), build.outputSha256);

    const ensure = build.bridges.find((bridge) => bridge.kind === "ensureDirectory")!;
    const findFiles = build.bridges.find((bridge) => bridge.kind === "findFiles")!;
    const screenshotSink = ensure.callSites.find((site) => findFiles.callSites.some(
      (candidate) => candidate.localFunction === site.localFunction
        && candidate.bodyOffset === 419,
    ))!.localFunction;
    const parsed = wasmEvidence(bytes)!.moduleView();
    const decoded = decodeFunctions(parsed, []);
    const screenshotIndex = parsed.functionImportCount + screenshotSink;
    const parents = decoded.filter((body) => body.calls.has(screenshotIndex));
    assert.equal(parents.length, 1);
    const initializerCandidates = [...parents[0]!.calls.keys()].filter((target) =>
      parsed.bodies[target - parsed.functionImportCount]?.byteLength === 318);
    assert.equal(initializerCandidates.length, 1);
    const initializer = initializerCandidates[0]! - parsed.functionImportCount;
    const sinkState = [
      27, 41, 65, 1248, 1262, 1294, 1305, 1373, 1390, 1407, 1428, 1449, 1473,
    ];
    const initializerState = [7, 26, 58, 136, 153, 172, 189, 220, 289, 311];
    const originalBase = decoded[screenshotSink]!.memorySites.find(
      (site) => site.operandStart === 1294,
    )!.value;
    const usedOffsets = new Set(decoded.flatMap((body) =>
      body.memorySites.map((site) => site.value)));
    let stateDelta = 64;
    while ([0, 4, 8, 12, 16, 20, 24, 28].some((relative) =>
      usedOffsets.has(originalBase + stateDelta + relative))) stateDelta += 64;

    const shiftedState = rewriteCode(bytes, (bodies) => {
      for (const [local, operands] of [
        [screenshotSink, sinkState], [initializer, initializerState],
      ] as const) for (const operand of operands) {
        const site = decoded[local]!.memorySites.find(
          (value) => value.operandStart === operand,
        )!;
        bodies[local]!.set(paddedIndex(site.value + stateDelta), operand);
      }
    });
    assert.equal(WebAssembly.validate(new Uint8Array(shiftedState)), true);
    assert.ok(deriveEquivalentTemplateSaveBuild(shiftedState));

    const splitState = rewriteCode(bytes, (bodies) => {
      for (const operand of sinkState) {
        const site = decoded[screenshotSink]!.memorySites.find(
          (value) => value.operandStart === operand,
        )!;
        bodies[screenshotSink]!.set(paddedIndex(site.value + stateDelta), operand);
      }
    });
    assert.equal(WebAssembly.validate(new Uint8Array(splitState)), true);
    assert.equal(deriveEquivalentTemplateSaveBuild(splitState), null);

    const wrongImmutable = rewriteCode(bytes, (bodies) => {
      bodies[screenshotSink]![697] = bodies[screenshotSink]![697]! ^ 1;
    });
    assert.equal(WebAssembly.validate(new Uint8Array(wrongImmutable)), true);
    assert.equal(deriveEquivalentTemplateSaveBuild(wrongImmutable), null);

    if (sha256(bytes) === "a3644a2a18bbfa237e578f2eb21d277e645b6b201f65034e00b3dcf021cae7a3") {
      assert.equal(
        build.outputSha256,
        "f8498109ee470d8f38d4d47674bbb1197b059989a2c95df229c67ae3048eb8eb",
      );
    }
  }
});
