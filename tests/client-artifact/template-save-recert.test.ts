/**
 * Qualification against a real installed client artifact.
 *
 * This is deliberately outside `tests/unit`: it processes a large, untracked
 * input that ordinary pull-request CI does not possess. Its caller must name
 * that input explicitly, so a local test run never changes cost by accident;
 * the recertification workflow runs it against the artifact it downloaded.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareToCertified,
  deriveTemplateSaveBuild,
  inspectTemplateSaveCandidate,
} from "../../src/tools/template-save-recert.js";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "../../src/main/certification/local-client-verifier.js";
import { deriveEquivalentTemplateSaveBuild } from "../../src/main/certification/template-save-verifier.js";
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
  enhancementProfilesForBuild,
  findEnhancementBuild,
  enhancementOutputSha256,
  supportedEnhancementCapabilities,
} from "../../src/main/certification/enhancement-builds.js";
import { transformEnhancementWasm } from "../../src/main/certification/enhancement-transform.js";
import { rewriteNativeDoubleClickWasm } from "../../src/main/certification/native-double-click.js";
import { rewriteExtendedMemoryWasm } from "../../src/main/certification/extended-memory.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
} from "../../src/main/certification/template-save-compat.js";
import { enhancementCapabilitiesForProfile } from "../../src/shared/enhancement-contracts.js";

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
    ...sections.map((sectionValue) =>
      encodeSection(sectionValue.id === 10
        ? { id: 10, body: encodeCode(bodies) }
        : sectionValue)),
  );
}

test("the template-save verifier makes a fail-closed decision for a real client", {
  timeout: 120_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(
    artifact,
    "GW_CLIENT_WASM must explicitly name the real Gw.jspi.wasm artifact",
  );
  const bytes = await readFile(artifact);
  const derived = deriveTemplateSaveBuild(bytes);
  const report = inspectTemplateSaveCandidate(bytes);
  const local = verifyLocalClientBytes(bytes);
  assert.equal(isLocalClientVerification(local, local.officialSha256), true);
  const capabilitiesOf = (value: ReturnType<typeof verifyLocalClientBytes>) =>
    value.enhancementBuild
      ? supportedEnhancementCapabilities(value.enhancementBuild)
      : null;

  // If this is a statically shipped build, the shape locator must still
  // reproduce that record exactly. Unknown builds are intentionally decided
  // by the local verifier instead of making this test demand a release.
  if (report.certified) assert.deepEqual(compareToCertified(derived), []);

  const fileExists = derived.bridges.find(
    (bridge) => bridge.kind === "fileExists",
  )!;
  const site = fileExists.callSites[0]!;
  // Keep the call at the same byte offset while changing the computation of
  // its path argument. The verifier must detect semantics, not only offsets.
  const changedCaller = rewriteCode(bytes, (bodies) => {
    const caller = bodies[site.localFunction]!;
    const pathImmediate = site.bodyOffset - 7;
    caller[pathImmediate] = caller[pathImmediate]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedCaller)), true);
  assert.equal(deriveEquivalentTemplateSaveBuild(changedCaller), null);
  assert.deepEqual(
    verifyLocalClientBytes(changedCaller).reasons,
    ["template-shape-changed"],
  );

  // Static addresses are allowed to relocate only as their complete named
  // occurrence group. Moving one delete-state word alone must refuse.
  const deleteBridge = derived.bridges.find(
    (bridge) => bridge.kind === "deleteFile",
  )!;
  const inconsistentStatic = rewriteCode(bytes, (bodies) => {
    const body = bodies[deleteBridge.callSites[0]!.localFunction]!;
    body[21] = body[21]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(inconsistentStatic)), true);
  assert.equal(deriveEquivalentTemplateSaveBuild(inconsistentStatic), null);

  // The equipment scan's diagnostic string is an immutable-data anchor. A
  // nearby pointer is not accepted merely because the instruction still fits.
  const equipmentScan = derived.bridges.find(
    (bridge) => bridge.kind === "fileBaseName",
  )!.callSites[1]!.localFunction;
  const changedImmutable = rewriteCode(bytes, (bodies) => {
    const body = bodies[equipmentScan]!;
    body[719] = body[719]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedImmutable)), true);
  assert.equal(deriveEquivalentTemplateSaveBuild(changedImmutable), null);

  const observationBase = local.enhancementBuild?.observationBase;
  assert.ok(observationBase, "the real client must prove its observation base");
  const needle = paddedIndex(observationBase.layout.agentArray);
  const touched = new Set(
    derived.bridges.flatMap((bridge) =>
      bridge.callSites.map((callSite) => callSite.localFunction)),
  );
  let changedAddress = false;
  const changedAddressReference = rewriteCode(bytes, (bodies) => {
    for (let local = 0; local < bodies.length; local += 1) {
      if (touched.has(local)) continue;
      const body = bodies[local]!;
      const at = body.findIndex((_, offset) =>
        needle.every((byte, index) => body[offset + index] === byte));
      if (at < 0) continue;
      body[at] = body[at]! ^ 1;
      changedAddress = true;
      break;
    }
  });
  assert.equal(changedAddress, true);
  assert.equal(WebAssembly.validate(new Uint8Array(changedAddressReference)), true);
  const addressDecision = verifyLocalClientBytes(changedAddressReference);
  assert.ok(addressDecision.templateSaveBuild);
  assert.ok(addressDecision.enhancementBuild?.cursorEvent);
  assert.equal(addressDecision.enhancementBuild.targetObservation, undefined);
  assert.equal(addressDecision.enhancementBuild.partyObservation, undefined);
  assert.equal(addressDecision.enhancementBuild.teamApply, undefined);
  assert.deepEqual(capabilitiesOf(addressDecision), {
    nativeCursor: true, targetObservation: false, partyObservation: false,
    teamApply: false, travelAction: true, xunlaiAction: false, chatAliases: true,
  });
  assert.deepEqual(addressDecision.reasons, []);

  const targetMutations = [
    { local: 7327 - derived.importCount, offset: 132, label: "target occurrence ledger", shared: false },
    { local: 5109 - derived.importCount, offset: 39, label: "map field offset", shared: true },
    { local: 17524 - derived.importCount, offset: 36, label: "area table stride", shared: true },
  ] as const;
  for (const mutation of targetMutations) {
    const changedTargetProof = rewriteCode(bytes, (bodies) => {
      const body = bodies[mutation.local]!;
      body[mutation.offset] = body[mutation.offset]! ^ 1;
    });
    assert.equal(
      WebAssembly.validate(new Uint8Array(changedTargetProof)),
      true,
      mutation.label,
    );
    const refusal = verifyLocalClientBytes(changedTargetProof);
    assert.ok(refusal.templateSaveBuild, mutation.label);
    assert.ok(refusal.enhancementBuild?.cursorEvent, mutation.label);
    assert.equal(refusal.enhancementBuild.targetObservation, undefined, mutation.label);
    assert.equal(capabilitiesOf(refusal)?.travelAction, true, mutation.label);
    assert.equal(capabilitiesOf(refusal)?.chatAliases, true, mutation.label);
    assert.equal(capabilitiesOf(refusal)?.xunlaiAction, !mutation.shared, mutation.label);
    assert.deepEqual(refusal.reasons, [], mutation.label);
  }

  const cursorMutations = [
    { local: 446 - derived.importCount, offset: 10, label: "main-loop control flow", shared: true },
    { local: 2828 - derived.importCount, offset: 68, label: "one producer static", shared: false },
    { local: 6234 - derived.importCount, offset: 45, label: "cursor art offset", shared: false },
  ] as const;
  for (const mutation of cursorMutations) {
    const changedCursorProof = rewriteCode(bytes, (bodies) => {
      const body = bodies[mutation.local]!;
      body[mutation.offset] = body[mutation.offset]! ^ 1;
    });
    assert.equal(
      WebAssembly.validate(new Uint8Array(changedCursorProof)),
      true,
      mutation.label,
    );
    const refusal = verifyLocalClientBytes(changedCursorProof);
    assert.ok(refusal.templateSaveBuild, mutation.label);
    if (mutation.shared) {
      assert.equal(refusal.enhancementBuild, null, mutation.label);
      assert.deepEqual(refusal.reasons, ["enhancement-layout-changed"], mutation.label);
    } else {
      assert.ok(refusal.enhancementBuild?.targetObservation, mutation.label);
      assert.equal(refusal.enhancementBuild.cursorEvent, undefined, mutation.label);
      assert.equal(capabilitiesOf(refusal)?.travelAction, true, mutation.label);
      assert.equal(capabilitiesOf(refusal)?.xunlaiAction, true, mutation.label);
      assert.equal(capabilitiesOf(refusal)?.chatAliases, true, mutation.label);
      assert.deepEqual(refusal.reasons, [], mutation.label);
    }
  }

  const localActionMutations = [
    { local: 16199 - derived.importCount, offset: 169, feature: "travelAction", label: "Travel message" },
    { local: 9196 - derived.importCount, offset: 78, feature: "xunlaiAction", label: "Xunlai access field" },
    { local: 13703 - derived.importCount, offset: 316, feature: "chatAliases", label: "alias message" },
  ] as const;
  for (const mutation of localActionMutations) {
    const changed = rewriteCode(bytes, (bodies) => {
      const body = bodies[mutation.local]!;
      body[mutation.offset] = body[mutation.offset]! ^ 1;
    });
    assert.equal(WebAssembly.validate(new Uint8Array(changed)), true, mutation.label);
    const refusal = verifyLocalClientBytes(changed);
    const capabilities = capabilitiesOf(refusal)!;
    assert.ok(refusal.enhancementBuild?.cursorEvent, mutation.label);
    assert.ok(refusal.enhancementBuild?.targetObservation, mutation.label);
    assert.equal(capabilities[mutation.feature], false, mutation.label);
    for (const feature of ["travelAction", "xunlaiAction", "chatAliases"] as const) {
      if (feature !== mutation.feature) assert.equal(capabilities[feature], true, mutation.label);
    }
  }

  const changedDrain = rewriteCode(bytes, (bodies) => {
    const body = bodies[6661 - derived.importCount]!;
    body[330] = body[330]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedDrain)), true);
  const drainRefusal = capabilitiesOf(verifyLocalClientBytes(changedDrain))!;
  assert.equal(drainRefusal.travelAction, false);
  assert.equal(drainRefusal.xunlaiAction, false);
  assert.equal(drainRefusal.chatAliases, true);
  assert.equal(drainRefusal.partyObservation, true);
  assert.equal(drainRefusal.teamApply, false);

  const changedDispatcher = rewriteCode(bytes, (bodies) => {
    const body = bodies[6842 - derived.importCount]!;
    body[6] = body[6]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedDispatcher)), true);
  const dispatcherRefusal = capabilitiesOf(verifyLocalClientBytes(changedDispatcher))!;
  assert.equal(dispatcherRefusal.nativeCursor, true);
  assert.equal(dispatcherRefusal.targetObservation, true);
  assert.equal(dispatcherRefusal.travelAction, false);
  assert.equal(dispatcherRefusal.xunlaiAction, false);
  assert.equal(dispatcherRefusal.chatAliases, false);
  assert.equal(dispatcherRefusal.partyObservation, false);
  assert.equal(dispatcherRefusal.teamApply, false);

  const changedPartyField = rewriteCode(bytes, (bodies) => {
    const body = bodies[8787 - derived.importCount]!;
    body[35] = body[35]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedPartyField)), true);
  const partyRefusal = capabilitiesOf(verifyLocalClientBytes(changedPartyField))!;
  assert.equal(partyRefusal.nativeCursor, true);
  assert.equal(partyRefusal.targetObservation, true);
  assert.equal(partyRefusal.partyObservation, false);
  assert.equal(partyRefusal.teamApply, false);
  assert.equal(partyRefusal.travelAction, true);
  assert.equal(partyRefusal.xunlaiAction, true);
  assert.equal(partyRefusal.chatAliases, true);

  const changedTeamOpcode = rewriteCode(bytes, (bodies) => {
    const body = bodies[6887 - derived.importCount]!;
    body[30] = body[30]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedTeamOpcode)), true);
  const teamRefusal = capabilitiesOf(verifyLocalClientBytes(changedTeamOpcode))!;
  assert.equal(teamRefusal.partyObservation, true);
  assert.equal(teamRefusal.teamApply, false);
  assert.equal(teamRefusal.travelAction, true);
  assert.equal(teamRefusal.xunlaiAction, true);
  assert.equal(teamRefusal.chatAliases, true);
});

test("every certified runtime profile reproduces the real client chain", async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(
    artifact,
    "GW_CLIENT_WASM must explicitly name the real Gw.jspi.wasm artifact",
  );
  const official = new Uint8Array(await readFile(artifact));
  const templateBuild = findTemplateSaveBuild(sha256(official));
  assert.ok(templateBuild, "the real client must be template-save certified");
  const template = rewriteTemplateSaveWasm(official, templateBuild);
  const enhancementBuild = findEnhancementBuild(sha256(template));
  assert.ok(enhancementBuild, "the template output must be Enhancement certified");

  // The off profile and every optional capability profile feed the same two
  // downstream exact-hash transforms. Reproducing the complete chain here is
  // what catches an ABI/config edit whose source tests pass but whose authored
  // certificate hashes were not regenerated.
  rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(template));
  for (const profile of enhancementProfilesForBuild(enhancementBuild)) {
    const capabilities = enhancementCapabilitiesForProfile(profile);
    assert.ok(capabilities, `certified profile ${profile} must be valid`);
    const enhanced = transformEnhancementWasm(
      template,
      enhancementBuild,
      capabilities,
    );
    assert.equal(
      sha256(enhanced),
      enhancementOutputSha256(enhancementBuild, capabilities),
    );
    rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(enhanced));
  }
});
