/**
 * Exercises Template-saving recovery against explicitly supplied official
 * client bytes. Reindexed helpers must work; altered or redirected helpers
 * must never receive Template-saving authority.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  concat,
  encodeCode,
  encodeSection,
  paddedIndex,
  parseCode,
  sectionById,
  splitSections,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import {
  analyzeTemplateSaveCandidate,
  preparePostTemplateSaveModule,
} from "../../src/main/certification/template-save-verifier.js";
import { TemplateSaveModuleView } from "../../src/main/certification/template-save-module-view.js";

function editCode(
  input: Uint8Array,
  change: (bodies: Uint8Array[]) => void,
): Uint8Array {
  const sections = splitSections(input);
  const bodies = parseCode(sectionById(sections, 10));
  change(bodies);
  return concat(WASM_HEADER, ...sections.map((section) => encodeSection(
    section.id === 10 ? { id: 10, body: encodeCode(bodies) } : section,
  )));
}

test("Template-saving accepts moved helpers and rejects changed helper behavior", async () => {
  const filename = process.env.GW_CLIENT_WASM;
  assert.ok(filename, "GW_CLIENT_WASM must name the official artifact");
  const input = new Uint8Array(await readFile(filename));
  const original = preparePostTemplateSaveModule(input);
  assert.ok(original, "the complete Template-saving proof must pass");
  assert.equal(WebAssembly.validate(Uint8Array.from(original.bytes)), true);

  const analysis = analyzeTemplateSaveCandidate(input);
  const writer = analysis.callSites.fileExists?.[0]?.localFunction;
  assert.notEqual(writer, undefined);
  const view = new TemplateSaveModuleView(input);
  const helper = [...view.instructions(writer!).callSites].find(([, sites]) =>
    sites.some(({ offset }) => offset === 50));
  assert.ok(helper);
  const local = helper[0] - view.importCount;
  const replacement = view.signatures.findIndex((signature, index) =>
    index !== local && signature === view.signatures[local]);
  assert.ok(replacement >= 0);

  const moved = editCode(input, (bodies) => {
    // Move the independently identified helper without changing its body or
    // the caller's behavior. Both functions have the same signature.
    const left = paddedIndex(view.functionIndex(local));
    const right = paddedIndex(view.functionIndex(replacement));
    for (let caller = 0; caller < bodies.length; caller += 1) {
      for (const [target, sites] of view.instructions(caller).callSites) {
        if (target !== view.functionIndex(local)
          && target !== view.functionIndex(replacement)) continue;
        for (const site of sites) {
          assert.equal(site.operandEnd - site.offset, 6);
          bodies[caller]!.set(target === view.functionIndex(local) ? right : left,
            site.offset + 1);
        }
      }
    }
    [bodies[local], bodies[replacement]] = [bodies[replacement]!, bodies[local]!];
  });
  assert.equal(WebAssembly.validate(Uint8Array.from(moved)), true);
  assert.ok(preparePostTemplateSaveModule(moved));

  const redirected = editCode(input, (bodies) => {
    bodies[writer!]!.set(paddedIndex(view.functionIndex(replacement)), 51);
  });
  assert.equal(WebAssembly.validate(Uint8Array.from(redirected)), true);
  assert.equal(preparePostTemplateSaveModule(redirected), null);

  const altered = editCode(input, (bodies) => {
    // A valid same-signature body changes behavior while retaining every
    // caller and bridge site. The helper proof must catch that substitution.
    bodies[local] = bodies[replacement]!.slice();
  });
  assert.equal(WebAssembly.validate(Uint8Array.from(altered)), true);
  assert.equal(preparePostTemplateSaveModule(altered), null);
});
