/** Bind retained recovery clients and reject unreviewed native changes. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isLocalClientVerification, verifyLocalClientBytes } from "../../src/main/certification/local-client-verifier.js";
import {
  concat, encodeCode, encodeSection, parseCode, sectionById, splitSections, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";

const OCTOBER_CLIENT = "266b5a8aa88fe6440b10737d3eda27f4ceae2401d51d263debc0bca5c2075d87";
// ArenaNet rebuilt the October 22 client the same day. The rebuild changes
// only two constant getters, initialized data and the build ID.
const OCTOBER_22_CLIENTS = [
  "f4e529f9c9b6b6a1dfd3e0e7c8d8c518a48c45d8a9a526d89512b5e9c37c075e",
  "3dc01a8295d179450b16e2059ad056d4062fcad01e79ddae834bb2028596102b",
] as const;

/** The retained artifact with one of these digests, from either named fixture. */
async function retainedClient(sha256s: readonly string[]): Promise<Uint8Array | null> {
  for (const path of [process.env.GW_CLIENT_WASM, process.env.GW_PREVIOUS_CLIENT_WASM]) {
    if (!path) continue;
    const input = new Uint8Array(await readFile(path));
    const digest = wasmEvidence(input)?.inputSha256;
    if (digest !== undefined && sha256s.includes(digest)) return input;
  }
  return null;
}

// Release qualification supplies only the live client. A retained fixture
// that is not supplied is skipped, never treated as passing.
const octoberInput = await retainedClient([OCTOBER_CLIENT]);
const october22Input = await retainedClient(OCTOBER_22_CLIENTS);

function withBodyByte(
  input: Uint8Array,
  mutation: Readonly<{ functionIndex: number; offset: number; value: number }>,
): Uint8Array {
  const evidence = wasmEvidence(input);
  assert.ok(evidence);
  const sections = splitSections(input);
  const bodies = parseCode(sectionById(sections, 10));
  bodies[mutation.functionIndex - evidence.moduleView().functionImportCount]![mutation.offset] = mutation.value;
  const changed = Uint8Array.from(concat(WASM_HEADER, ...sections.map((section) => encodeSection(
    section.id === 10 ? { id: 10, body: encodeCode(bodies) } : section,
  ))));
  assert.equal(WebAssembly.validate(changed), true);
  return changed;
}

test("changed native Team gate or Hero panel message refuses live integration", {
  timeout: 120_000,
  skip: octoberInput === null ? "the retained October 1 artifact is not supplied" : false,
}, async () => {
  const input = octoberInput!;
  const original = verifyLocalClientBytes(input);
  assert.equal(original.fileVerdict?.status, "proved");
  for (const verdict of Object.values(original.featureVerdicts!)) {
    assert.equal(verdict.status, "proved");
  }

  // These coordinates identify the retained regression fixture, not runtime
  // authority. Alter a real native predicate and a real native message ID.
  for (const mutation of [
    { functionIndex: 9514, offset: 14, value: 4 },
    { functionIndex: 16552, offset: 128, value: 0xa4 },
  ]) {
    const result = verifyLocalClientBytes(withBodyByte(input, mutation));
    assert.equal(result.fileVerdict?.status, "proved");
    assert.equal(result.featureVerdicts!.nativeCursor.status, "proved");
    assert.equal(result.featureVerdicts!.partyObservation.status, "changed");
    assert.equal(result.featureVerdicts!.teamApply.status, "changed");
  }
});


test("retaining the October record preserves the previous Stable client proof", {
  timeout: 120_000,
  skip: process.env.GW_PREVIOUS_CLIENT_WASM === undefined
    ? "GW_PREVIOUS_CLIENT_WASM must explicitly name the previous Stable fixture" : false,
}, async () => {
  const input = new Uint8Array(await readFile(process.env.GW_PREVIOUS_CLIENT_WASM!));
  const result = verifyLocalClientBytes(input);
  assert.equal(isLocalClientVerification(result, result.officialSha256), true);
  assert.equal(result.fileVerdict?.status, "proved");
  for (const verdict of Object.values(result.featureVerdicts!)) {
    assert.equal(verdict.status, "proved");
  }
});


test("October 22 client proves every Stable capability; its reviewed Party change stays bound", {
  timeout: 120_000,
  skip: october22Input === null ? "no retained October 22 artifact is supplied" : false,
}, async () => {
  const input = october22Input!;
  const result = verifyLocalClientBytes(input);
  assert.equal(isLocalClientVerification(result, result.officialSha256), true);
  assert.equal(result.fileVerdict?.status, "proved");
  assert.notEqual(result.templateSaveBuild, null);
  for (const verdict of Object.values(result.featureVerdicts!)) {
    assert.equal(verdict.status, "proved");
  }

  // Attribute commit now resets the stored value for lookup result 11 as
  // well as 0. Restoring the October jump target is an unreviewed body.
  const reverted = verifyLocalClientBytes(
    withBodyByte(input, { functionIndex: 7169, offset: 154, value: 1 }),
  );
  assert.equal(reverted.fileVerdict?.status, "proved");
  assert.equal(reverted.featureVerdicts!.targetObservation.status, "proved");
  assert.equal(reverted.featureVerdicts!.partyObservation.status, "changed");
  assert.equal(reverted.featureVerdicts!.teamApply.status, "changed");
});
