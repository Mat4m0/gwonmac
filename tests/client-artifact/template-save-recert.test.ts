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
  parseExports,
  sectionById,
  splitSections,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import {
  ENHANCEMENT_BUILDS,
  enhancementProfilesForBuild,
  enhancementOutputSha256,
  supportedEnhancementCapabilities,
} from "../../src/main/certification/enhancement-builds.js";
import { transformEnhancementWasm } from "../../src/main/certification/enhancement-transform.js";
import {
  deriveNativeDoubleClickBuild,
  isDerivedNativeDoubleClickBuild,
  rewriteNativeDoubleClickWasm,
} from "../../src/main/certification/native-double-click.js";
import { rewriteExtendedMemoryWasm } from "../../src/main/certification/extended-memory.js";
import {
  mutableSpans,
  decodeFunctions,
  parseActiveTableRelations,
  parseModule,
  semanticRole,
  signatureMatches,
  signatureEvidence,
  uniqueRoleFunction,
} from "../../src/main/certification/enhancement-wasm-proof-context.js";
import {
  rewriteTemplateSaveWasm,
} from "../../src/main/certification/template-save-compat.js";
import { enhancementCapabilitiesForProfile } from "../../src/shared/enhancement-contracts.js";
import { inspectLocalActionRoleCandidates } from "../../src/main/certification/enhancement-local-actions-proof.js";
import {
  inspectTargetRoleCandidates,
  locateAutomaticCursor,
} from "../../src/main/certification/enhancement-structural-evidence.js";

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

function swapDirectCallTargets(
  bodies: Uint8Array[],
  left: number,
  right: number,
): void {
  const leftBytes = paddedIndex(left);
  const rightBytes = paddedIndex(right);
  for (const body of bodies) {
    for (let offset = 0; offset <= body.byteLength - 6; offset += 1) {
      if (body[offset] !== 0x10) continue;
      const operand = body.subarray(offset + 1, offset + 6);
      if (leftBytes.every((byte, index) => operand[index] === byte)) {
        body.set(rightBytes, offset + 1);
      } else if (rightBytes.every((byte, index) => operand[index] === byte)) {
        body.set(leftBytes, offset + 1);
      }
    }
  }
}

function swapDefinedFunctions(
  bodies: Uint8Array[],
  importCount: number,
  left: number,
  right: number,
): void {
  swapDirectCallTargets(bodies, left, right);
  const leftLocal = left - importCount;
  const rightLocal = right - importCount;
  const leftBody = bodies[leftLocal]!;
  bodies[leftLocal] = bodies[rightLocal]!;
  bodies[rightLocal] = leftBody;
}

function sameSignatureDestination(
  module: ReturnType<typeof parseModule>,
  sourceFunction: number,
  excluded: ReadonlySet<number> = new Set(),
): number {
  const sourceSignature = signatureEvidence(module, sourceFunction);
  assert.ok(sourceSignature);
  for (
    let candidate = module.functionImportCount;
    candidate < module.functionTypeIndices.length;
    candidate += 1
  ) {
    if (candidate === sourceFunction || excluded.has(candidate)) continue;
    if (signatureMatches(
      module,
      candidate,
      sourceSignature.params,
      sourceSignature.results,
    )) return candidate;
  }
  assert.fail(`no same-signature destination for function ${sourceFunction}`);
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
  const effectiveCapabilitiesOf = (
    value: ReturnType<typeof verifyLocalClientBytes>,
  ) => {
    const build = value.enhancementBuild;
    if (!build) return null;
    const [profile] = enhancementProfilesForBuild(build);
    return profile ? enhancementCapabilitiesForProfile(profile) : null;
  };
  assert.deepEqual(capabilitiesOf(local), {
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    teamApply: true,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
    skillSlotGeometry: true,
    skillCooldownObservation: true,
    playRegionObservation: true,
  });

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

  // Static addresses must preserve their measured relationship to independent
  // initialized-data or BSS anchors. Moving one delete-state word must refuse.
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
  const parsed = parseModule(bytes);
  const cursorLocation = locateAutomaticCursor(bytes, ENHANCEMENT_BUILDS);
  assert.ok(cursorLocation, "the real client must structurally derive Cursor");
  assert.deepEqual(
    cursorLocation.layout,
    local.enhancementBuild?.cursorEvent?.layout,
    "the shipped Cursor layout must be the structurally derived layout",
  );
  const agentArrayAccessor = uniqueRoleFunction(parsed, semanticRole(
    47,
    "e2d3a0903dd7eb7595e118466ce74d0e90f9f38c81068c8cd2fd1f8ab0570338",
    mutableSpans([
      [15, 20, "agent-array.size"], [27, 32, "agent-array.base"],
    ]),
    ["i32"],
    ["i32"],
  ));
  assert.notEqual(agentArrayAccessor, null);
  const targetDuplicateDestination = sameSignatureDestination(
    parsed,
    agentArrayAccessor!,
    new Set([
      local.enhancementBuild!.travelAction!.unlockProof.accessor.functionIndex,
      local.enhancementBuild!.travelAction!.unlockProof.consumer.functionIndex,
    ]),
  );
  const ambiguousTarget = rewriteCode(bytes, (bodies) => {
    bodies[targetDuplicateDestination - derived.importCount]
      = bodies[agentArrayAccessor! - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousTarget)), true);
  assert.deepEqual(inspectTargetRoleCandidates(ambiguousTarget), {
    status: "ambiguous",
    candidateCount: 2,
  });
  const ambiguousTargetVerdict = verifyLocalClientBytes(ambiguousTarget, {
    nativeCursor: false,
    targetObservation: true,
    partyObservation: false,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
    skillSlotGeometry: false,
    skillCooldownObservation: false,
    playRegionObservation: true,
  })
    .featureVerdicts?.targetObservation;
  assert.equal(ambiguousTargetVerdict?.status, "ambiguous");
  if (ambiguousTargetVerdict?.status === "ambiguous") {
    assert.equal(
      ambiguousTargetVerdict.invariant,
      "target.observation-selection-anchors",
    );
    assert.equal(ambiguousTargetVerdict.candidates, 2);
  }
  const changedAddressReference = rewriteCode(bytes, (bodies) => {
    const body = bodies[agentArrayAccessor! - parsed.functionImportCount]!;
    body[27] = body[27]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedAddressReference)), true);
  const addressDecision = verifyLocalClientBytes(changedAddressReference);
  assert.ok(addressDecision.templateSaveBuild);
  assert.ok(addressDecision.enhancementBuild?.cursorEvent);
  assert.equal(addressDecision.enhancementBuild.targetObservation, undefined);
  assert.equal(addressDecision.enhancementBuild.partyObservation, undefined);
  assert.equal(addressDecision.enhancementBuild.teamApply, undefined);
  assert.deepEqual(capabilitiesOf(addressDecision), {
    nativeCursor: true, targetObservation: false, partyObservation: false,
    teamApply: false, travelAction: false, xunlaiAction: false, chatAliases: true,
    skillSlotGeometry: true,
    skillCooldownObservation: false,
    playRegionObservation: true,
  });
  assert.deepEqual(addressDecision.reasons, []);
  const addressTemplateBuild = addressDecision.templateSaveBuild;
  const addressEnhancementBuild = addressDecision.enhancementBuild;
  const addressCapabilities = effectiveCapabilitiesOf(addressDecision);
  assert.ok(addressTemplateBuild);
  assert.ok(addressEnhancementBuild);
  assert.ok(addressCapabilities);
  assert.deepEqual(effectiveCapabilitiesOf(addressDecision), {
    nativeCursor: true,
    targetObservation: false,
    partyObservation: false,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
    skillSlotGeometry: true,
    skillCooldownObservation: false,
    playRegionObservation: true,
  });
  const addressTemplate = rewriteTemplateSaveWasm(
    changedAddressReference,
    addressTemplateBuild,
  );
  const addressOutputSections = splitSections(transformEnhancementWasm(
    addressTemplate,
    addressEnhancementBuild,
    addressCapabilities,
  ));
  const addressExports = parseExports(sectionById(addressOutputSections, 7));
  assert.equal(addressExports.some(
    (entry) => entry.name === local.enhancementBuild!.travelAction!.enqueueExport,
  ), false, "Travel requires the missing observation base for unlock evidence");
  assert.equal(addressExports.some(
    (entry) => entry.name === local.enhancementBuild!.xunlaiAction!.openExport,
  ), false);
  assert.equal(addressExports.some(
    (entry) => entry.name === local.enhancementBuild!.teamApply!.thunkExport,
  ), false);

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
    assert.equal(capabilitiesOf(refusal)?.travelAction, !mutation.shared, mutation.label);
    assert.equal(capabilitiesOf(refusal)?.chatAliases, true, mutation.label);
    assert.equal(capabilitiesOf(refusal)?.xunlaiAction, !mutation.shared, mutation.label);
    assert.equal(
      capabilitiesOf(refusal)?.playRegionObservation,
      !mutation.shared,
      mutation.label,
    );
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

  const changedTravelContext = rewriteCode(bytes, (bodies) => {
    bodies[11650 - derived.importCount]![14]
      = bodies[11650 - derived.importCount]![14]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedTravelContext)), true);
  const changedTravelContextDecision = verifyLocalClientBytes(changedTravelContext);
  const changedTravelContextCapabilities = capabilitiesOf(changedTravelContextDecision)!;
  assert.equal(changedTravelContextCapabilities.travelAction, false);
  assert.equal(changedTravelContextCapabilities.xunlaiAction, true);
  assert.equal(changedTravelContextCapabilities.chatAliases, true);
  const changedTravelContextVerdict = changedTravelContextDecision.featureVerdicts?.travelAction;
  assert.equal(changedTravelContextVerdict?.status, "changed");
  if (changedTravelContextVerdict?.status === "changed") {
    assert.equal(changedTravelContextVerdict.invariant, "travel.current-context-resolver");
  }

  const changedDrain = rewriteCode(bytes, (bodies) => {
    const body = bodies[6661 - derived.importCount]!;
    body[330] = body[330]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedDrain)), true);
  const changedDrainDecision = verifyLocalClientBytes(changedDrain);
  const drainRefusal = capabilitiesOf(changedDrainDecision)!;
  assert.equal(drainRefusal.travelAction, false);
  assert.equal(drainRefusal.xunlaiAction, false);
  assert.equal(drainRefusal.chatAliases, true, "the parser proof remains available");
  const drainEffective = effectiveCapabilitiesOf(changedDrainDecision)!;
  assert.equal(
    drainEffective.chatAliases,
    false,
    "aliases are not effective when neither named action remains",
  );
  assert.equal(drainRefusal.partyObservation, true);
  assert.equal(drainRefusal.teamApply, false);

  const degradedBuild = changedDrainDecision.enhancementBuild;
  const degradedTemplateBuild = changedDrainDecision.templateSaveBuild;
  assert.ok(degradedBuild);
  assert.ok(degradedTemplateBuild);
  const degradedTemplate = rewriteTemplateSaveWasm(
    changedDrain,
    degradedTemplateBuild,
  );
  const degradedOutput = transformEnhancementWasm(
    degradedTemplate,
    degradedBuild,
    drainEffective,
  );
  const degradedInputBodies = parseCode(sectionById(
    splitSections(degradedTemplate),
    10,
  ));
  const degradedOutputSections = splitSections(degradedOutput);
  const degradedOutputBodies = parseCode(sectionById(degradedOutputSections, 10));
  const aliasParserLocal = degradedBuild.chatAliases!.parser.functionIndex
    - derived.importCount;
  const drainLocal = local.enhancementBuild!.gameThread!.drain.functionIndex
    - derived.importCount;
  assert.deepEqual(
    degradedOutputBodies[aliasParserLocal],
    degradedInputBodies[aliasParserLocal],
    "an unavailable alias capability must preserve the real parser",
  );
  assert.deepEqual(
    degradedOutputBodies[drainLocal],
    degradedInputBodies[drainLocal],
    "a refused drain must remain untouched",
  );
  const degradedExports = parseExports(sectionById(degradedOutputSections, 7));
  for (const name of [
    local.enhancementBuild!.teamApply!.thunkExport,
    local.enhancementBuild!.xunlaiAction!.openExport,
    local.enhancementBuild!.travelAction!.enqueueExport,
  ]) {
    assert.equal(
      degradedExports.some((entry) => entry.name === name),
      false,
      `degraded aliases must not export ${name}`,
    );
  }

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

  for (const mutation of [
    { functionIndex: 8812, operand: 983, label: "world lifecycle" },
    { functionIndex: 8698, operand: 236, label: "skillbar update" },
    { functionIndex: 8701, operand: 126, label: "skillbar row reader" },
    { functionIndex: 8702, operand: 137, label: "skill slot reader" },
  ] as const) {
    const changedSkillbarProof = rewriteCode(bytes, (bodies) => {
      const body = bodies[mutation.functionIndex - derived.importCount]!;
      body[mutation.operand] = body[mutation.operand]! ^ 1;
    });
    assert.equal(
      WebAssembly.validate(new Uint8Array(changedSkillbarProof)),
      true,
      mutation.label,
    );
    const refusal = capabilitiesOf(verifyLocalClientBytes(changedSkillbarProof))!;
    assert.equal(refusal.partyObservation, false, mutation.label);
    assert.equal(refusal.skillCooldownObservation, false, mutation.label);
    assert.equal(refusal.targetObservation, true, mutation.label);
    assert.equal(refusal.skillSlotGeometry, true, mutation.label);
  }

  const duplicateSkillbarReader = sameSignatureDestination(parsed, 8701);
  const ambiguousSkillbar = rewriteCode(bytes, (bodies) => {
    bodies[duplicateSkillbarReader - derived.importCount]
      = bodies[8701 - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousSkillbar)), true);
  const ambiguousSkillbarVerification = verifyLocalClientBytes(ambiguousSkillbar);
  const ambiguousSkillbarVerdict = ambiguousSkillbarVerification
    .featureVerdicts?.skillCooldownObservation;
  assert.equal(ambiguousSkillbarVerdict?.status, "ambiguous");
  if (ambiguousSkillbarVerdict?.status === "ambiguous") {
    assert.equal(
      ambiguousSkillbarVerdict.invariant,
      "skill-cooldown.player-skillbar",
    );
    assert.equal(ambiguousSkillbarVerdict.candidates, 2);
  }
  const ambiguousSkillbarCapabilities = capabilitiesOf(
    ambiguousSkillbarVerification,
  )!;
  assert.equal(ambiguousSkillbarCapabilities.partyObservation, false);
  assert.equal(ambiguousSkillbarCapabilities.targetObservation, true);
  assert.equal(ambiguousSkillbarCapabilities.skillSlotGeometry, true);

  const changedRechargeReader = rewriteCode(bytes, (bodies) => {
    const body = bodies[8704 - derived.importCount]!;
    body[137] = 9; // certified slot bound is exactly eight
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedRechargeReader)), true);
  const rechargeRefusal = capabilitiesOf(
    verifyLocalClientBytes(changedRechargeReader),
  )!;
  assert.equal(rechargeRefusal.partyObservation, true);
  assert.equal(rechargeRefusal.skillSlotGeometry, true);
  assert.equal(rechargeRefusal.skillCooldownObservation, false);

  const changedSkillTimer = rewriteCode(bytes, (bodies) => {
    const body = bodies[249 - derived.importCount]!;
    const opcode = body.findIndex(
      (byte, index) => byte === 0x41 && (body[index + 1] ?? 0x80) < 0x80,
    );
    assert.ok(opcode >= 0);
    body[opcode + 1] = body[opcode + 1]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedSkillTimer)), true);
  const timerRefusal = capabilitiesOf(verifyLocalClientBytes(changedSkillTimer))!;
  assert.equal(timerRefusal.partyObservation, true);
  assert.equal(timerRefusal.skillCooldownObservation, false);

  const reindexedLocalActions = rewriteCode(bytes, (bodies) => {
    swapDefinedFunctions(bodies, derived.importCount, 6842, 6840);
  });
  assert.equal(WebAssembly.validate(new Uint8Array(reindexedLocalActions)), true);
  const reindexedCapabilities = capabilitiesOf(
    verifyLocalClientBytes(reindexedLocalActions),
  )!;
  assert.equal(reindexedCapabilities.travelAction, true);
  assert.equal(reindexedCapabilities.xunlaiAction, true);
  assert.equal(reindexedCapabilities.chatAliases, true);
  assert.equal(reindexedCapabilities.partyObservation, true);
  assert.equal(reindexedCapabilities.teamApply, true);

  // Function 1083 has the same signature but no direct caller or active table
  // slot in both retained generations, so relocating this role cannot disturb
  // an unrelated feature merely by taking over the destination.
  const travelContextDestination = 1083;
  assert.deepEqual(
    signatureEvidence(parsed, travelContextDestination),
    signatureEvidence(parsed, 11650),
  );
  assert.equal(
    decodeFunctions(parsed, []).some(({ calls }) => calls.has(travelContextDestination)),
    false,
  );
  assert.equal(
    parseActiveTableRelations(parsed.elementSection).has(travelContextDestination),
    false,
  );
  const reindexedTravelContext = rewriteCode(bytes, (bodies) => {
    swapDefinedFunctions(bodies, derived.importCount, 11650, travelContextDestination);
  });
  assert.equal(WebAssembly.validate(new Uint8Array(reindexedTravelContext)), true);
  const reindexedTravelContextCapabilities = capabilitiesOf(
    verifyLocalClientBytes(reindexedTravelContext),
  )!;
  assert.equal(reindexedTravelContextCapabilities.travelAction, true);
  assert.equal(reindexedTravelContextCapabilities.xunlaiAction, true);
  assert.equal(reindexedTravelContextCapabilities.chatAliases, true);

  const protectedPartyCallees = new Set([
    228, 322, 334, 6842, 9582,
  ]);
  const partyCallRetargets = [
    { caller: 10658, operand: 76, target: 334, label: "PartyInfo release" },
    { caller: 10696, operand: 9, target: 9582, label: "party flag notifier" },
    { caller: 9812, operand: 6, target: 228, label: "account unlock resolver" },
    { caller: 8782, operand: 143, target: 6842, label: "hero flag UI" },
    { caller: 7167, operand: 164, target: 322, label: "attribute apply" },
    { caller: 8977, operand: 23, target: 228, label: "character unlock resolver" },
  ] as const;
  for (const mutation of partyCallRetargets) {
    const destination = sameSignatureDestination(
      parsed,
      mutation.target,
      protectedPartyCallees,
    );
    const retargeted = rewriteCode(bytes, (bodies) => {
      bodies[mutation.caller - derived.importCount]!
        .set(paddedIndex(destination), mutation.operand);
    });
    assert.equal(WebAssembly.validate(new Uint8Array(retargeted)), true);
    const capabilities = capabilitiesOf(verifyLocalClientBytes(retargeted))!;
    assert.equal(capabilities.partyObservation, false, mutation.label);
    assert.equal(capabilities.teamApply, false, mutation.label);
    assert.equal(capabilities.travelAction, true, mutation.label);
    assert.equal(capabilities.chatAliases, true, mutation.label);
  }

  const changedTravelCall = rewriteCode(bytes, (bodies) => {
    bodies[16199 - derived.importCount]!.set(paddedIndex(6840), 132);
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedTravelCall)), true);
  const travelCallRefusal = capabilitiesOf(verifyLocalClientBytes(changedTravelCall))!;
  assert.equal(travelCallRefusal.travelAction, false);
  assert.equal(travelCallRefusal.xunlaiAction, true);
  assert.equal(travelCallRefusal.chatAliases, true);

  const changedXunlaiCall = rewriteCode(bytes, (bodies) => {
    bodies[8978 - derived.importCount]!.set(paddedIndex(6840), 98);
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedXunlaiCall)), true);
  const xunlaiCallRefusal = capabilitiesOf(verifyLocalClientBytes(changedXunlaiCall))!;
  assert.equal(xunlaiCallRefusal.travelAction, true);
  assert.equal(xunlaiCallRefusal.xunlaiAction, false);
  assert.equal(xunlaiCallRefusal.chatAliases, true);

  const ambiguousTravel = rewriteCode(bytes, (bodies) => {
    bodies[311 - derived.importCount] = bodies[16199 - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousTravel)), true);
  const ambiguousTravelDecision = verifyLocalClientBytes(ambiguousTravel);
  const ambiguousTravelRefusal = capabilitiesOf(ambiguousTravelDecision)!;
  assert.deepEqual(inspectLocalActionRoleCandidates(ambiguousTravel)?.travelAction, {
    status: "ambiguous",
    candidateCount: 2,
  });
  const ambiguousTravelVerdict = ambiguousTravelDecision.featureVerdicts?.travelAction;
  assert.equal(ambiguousTravelVerdict?.status, "ambiguous");
  if (ambiguousTravelVerdict?.status === "ambiguous") {
    assert.equal(ambiguousTravelVerdict.invariant, "travel.message-producer-anchor");
    assert.equal(ambiguousTravelVerdict.candidates, 2);
  }
  assert.equal(ambiguousTravelRefusal.travelAction, false);
  assert.equal(ambiguousTravelRefusal.xunlaiAction, true);
  assert.equal(ambiguousTravelRefusal.chatAliases, true);

  const ambiguousTravelContext = rewriteCode(bytes, (bodies) => {
    bodies[travelContextDestination - derived.importCount]
      = bodies[11650 - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousTravelContext)), true);
  const ambiguousTravelContextDecision = verifyLocalClientBytes(ambiguousTravelContext);
  assert.deepEqual(
    inspectLocalActionRoleCandidates(ambiguousTravelContext)?.travelContext,
    { status: "ambiguous", candidateCount: 2 },
  );
  const ambiguousTravelContextVerdict
    = ambiguousTravelContextDecision.featureVerdicts?.travelAction;
  assert.equal(ambiguousTravelContextVerdict?.status, "ambiguous");
  if (ambiguousTravelContextVerdict?.status === "ambiguous") {
    assert.equal(
      ambiguousTravelContextVerdict.invariant,
      "travel.current-context-resolver",
    );
    assert.equal(ambiguousTravelContextVerdict.candidates, 2);
  }
  assert.equal(capabilitiesOf(ambiguousTravelContextDecision)?.travelAction, false);
  assert.equal(capabilitiesOf(ambiguousTravelContextDecision)?.xunlaiAction, true);

  const ambiguousDispatcher = rewriteCode(bytes, (bodies) => {
    bodies[6840 - derived.importCount] = bodies[6842 - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousDispatcher)), true);
  const ambiguousDispatcherDecision = verifyLocalClientBytes(ambiguousDispatcher);
  const ambiguousDispatcherRefusal = capabilitiesOf(ambiguousDispatcherDecision)!;
  assert.deepEqual(inspectLocalActionRoleCandidates(ambiguousDispatcher)?.uiDispatcher, {
    status: "ambiguous",
    candidateCount: 2,
  });
  for (const feature of [
    "partyObservation",
    "teamApply",
    "travelAction",
    "xunlaiAction",
    "chatAliases",
  ] as const) {
    const verdict = ambiguousDispatcherDecision.featureVerdicts?.[feature];
    assert.equal(verdict?.status, "ambiguous", feature);
    if (verdict?.status === "ambiguous") assert.equal(verdict.candidates, 2, feature);
  }
  assert.equal(ambiguousDispatcherRefusal.travelAction, false);
  assert.equal(ambiguousDispatcherRefusal.xunlaiAction, false);
  assert.equal(ambiguousDispatcherRefusal.chatAliases, false);

  const ambiguousXunlai = rewriteCode(bytes, (bodies) => {
    bodies[223 - derived.importCount] = bodies[8978 - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousXunlai)), true);
  assert.deepEqual(inspectLocalActionRoleCandidates(ambiguousXunlai)?.xunlaiAction, {
    status: "ambiguous",
    candidateCount: 2,
  });
  const ambiguousXunlaiVerdict = verifyLocalClientBytes(ambiguousXunlai)
    .featureVerdicts?.xunlaiAction;
  assert.equal(ambiguousXunlaiVerdict?.status, "ambiguous");
  if (ambiguousXunlaiVerdict?.status === "ambiguous") {
    assert.equal(ambiguousXunlaiVerdict.invariant, "xunlai.data-window-anchors");
    assert.equal(ambiguousXunlaiVerdict.candidates, 2);
  }

  const ambiguousAliases = rewriteCode(bytes, (bodies) => {
    bodies[350 - derived.importCount] = bodies[13703 - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousAliases)), true);
  assert.deepEqual(inspectLocalActionRoleCandidates(ambiguousAliases)?.chatAliases, {
    status: "ambiguous",
    candidateCount: 2,
  });
  const ambiguousAliasesVerdict = verifyLocalClientBytes(ambiguousAliases)
    .featureVerdicts?.chatAliases;
  assert.equal(ambiguousAliasesVerdict?.status, "ambiguous");
  if (ambiguousAliasesVerdict?.status === "ambiguous") {
    assert.equal(ambiguousAliasesVerdict.invariant, "chat.alias-parser-anchor");
    assert.equal(ambiguousAliasesVerdict.candidates, 2);
  }

  const partyRoleFunction = 8787;
  const partyDuplicateDestination = sameSignatureDestination(
    parsed,
    partyRoleFunction,
  );
  const ambiguousParty = rewriteCode(bytes, (bodies) => {
    bodies[partyDuplicateDestination - derived.importCount]
      = bodies[partyRoleFunction - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousParty)), true);
  assert.deepEqual(
    inspectLocalActionRoleCandidates(
      ambiguousParty,
      ENHANCEMENT_BUILDS,
    )?.partyObservation,
    { status: "ambiguous", candidateCount: 2 },
  );
  const ambiguousPartyVerdict = verifyLocalClientBytes(ambiguousParty)
    .featureVerdicts?.partyObservation;
  assert.equal(ambiguousPartyVerdict?.status, "ambiguous");
  if (ambiguousPartyVerdict?.status === "ambiguous") {
    assert.equal(ambiguousPartyVerdict.invariant, "party.observation-anchors");
    assert.equal(ambiguousPartyVerdict.candidates, 2);
  }

  const teamRoleFunction = local.enhancementBuild?.teamApply?.entries[0]?.functionIndex;
  assert.notEqual(teamRoleFunction, undefined);
  const teamDuplicateDestination = sameSignatureDestination(
    parsed,
    teamRoleFunction!,
    new Set([partyRoleFunction, partyDuplicateDestination]),
  );
  const ambiguousTeam = rewriteCode(bytes, (bodies) => {
    bodies[teamDuplicateDestination - derived.importCount]
      = bodies[teamRoleFunction! - derived.importCount]!.slice();
  });
  assert.equal(WebAssembly.validate(new Uint8Array(ambiguousTeam)), true);
  assert.deepEqual(
    inspectLocalActionRoleCandidates(
      ambiguousTeam,
      ENHANCEMENT_BUILDS,
    )?.teamApply,
    { status: "ambiguous", candidateCount: 2 },
  );
  const ambiguousTeamVerdict = verifyLocalClientBytes(ambiguousTeam)
    .featureVerdicts?.teamApply;
  assert.equal(ambiguousTeamVerdict?.status, "ambiguous");
  if (ambiguousTeamVerdict?.status === "ambiguous") {
    assert.equal(ambiguousTeamVerdict.invariant, "team.packet-builder-anchors");
    assert.equal(ambiguousTeamVerdict.candidates, 2);
  }

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

  for (const mutation of [
    { functionIndex: 322, operand: 82, label: "Party immutable callee anchor" },
    { functionIndex: 17787, operand: 23, label: "Party release static ledger" },
    { functionIndex: 10343, operand: 5, label: "Party finish-state relocation" },
  ] as const) {
    const changedPartyCallee = rewriteCode(bytes, (bodies) => {
      const body = bodies[mutation.functionIndex - derived.importCount]!;
      body[mutation.operand] = body[mutation.operand]! ^ 1;
    });
    assert.equal(WebAssembly.validate(new Uint8Array(changedPartyCallee)), true);
    const refusal = capabilitiesOf(verifyLocalClientBytes(changedPartyCallee))!;
    assert.equal(refusal.partyObservation, false, mutation.label);
    assert.equal(refusal.teamApply, false, mutation.label);
    assert.equal(refusal.travelAction, true, mutation.label);
    assert.equal(refusal.chatAliases, true, mutation.label);
  }

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

  const changedAliasPointer = rewriteCode(bytes, (bodies) => {
    const body = bodies[13703 - derived.importCount]!;
    body[110] = body[110]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedAliasPointer)), true);
  const aliasPointerRefusal = capabilitiesOf(
    verifyLocalClientBytes(changedAliasPointer),
  )!;
  assert.equal(aliasPointerRefusal.chatAliases, false);
  assert.equal(aliasPointerRefusal.travelAction, true);
  assert.equal(aliasPointerRefusal.xunlaiAction, true);
  assert.equal(aliasPointerRefusal.partyObservation, true);
  assert.equal(aliasPointerRefusal.teamApply, true);

  const constructorOffsets = new Map<number, number>([
    [31, 35], [30, 35], [21, 42], [93, 188],
    [65, 43], [16, 260], [155, 36],
  ] as const);
  const teamBuilders = local.enhancementBuild?.teamApply?.entries.map((entry) => {
    const offset = constructorOffsets.get(entry.opcode);
    assert.notEqual(offset, undefined, `constructor offset for opcode ${entry.opcode}`);
    return [entry.functionIndex, offset!] as const;
  });
  assert.equal(teamBuilders?.length, constructorOffsets.size);
  const changedTeamConstructor = rewriteCode(bytes, (bodies) => {
    for (const [functionIndex, offset] of teamBuilders!) {
      const body = bodies[functionIndex - derived.importCount]!;
      body[offset] = body[offset]! ^ 1;
    }
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedTeamConstructor)), true);
  const constructorRefusal = capabilitiesOf(
    verifyLocalClientBytes(changedTeamConstructor),
  )!;
  assert.equal(constructorRefusal.partyObservation, true);
  assert.equal(constructorRefusal.teamApply, false);
  assert.equal(constructorRefusal.travelAction, true);
  assert.equal(constructorRefusal.xunlaiAction, true);
  assert.equal(constructorRefusal.chatAliases, true);
});

test("template-save static relocation anchors reject coherent wrong values", {
  timeout: 120_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(
    artifact,
    "GW_CLIENT_WASM must explicitly name the real Gw.jspi.wasm artifact",
  );
  const bytes = await readFile(artifact);
  const derived = deriveTemplateSaveBuild(bytes);
  assert.ok(
    deriveEquivalentTemplateSaveBuild(bytes),
    "the unchanged real client must pass the relocation anchors",
  );
  const deleteBridge = derived.bridges.find(
    (bridge) => bridge.kind === "deleteFile",
  )!;

  // A consistent group delta is not proof of identity: all five references can
  // agree while pointing at the wrong BSS object. The data/BSS boundary is the
  // independent anchor that must make this otherwise-valid module refuse.
  const consistentlyWrongStatic = rewriteCode(bytes, (bodies) => {
    const body = bodies[deleteBridge.callSites[0]!.localFunction]!;
    const moved = [
      [21, 2_674_320],
      [33, 2_674_316],
      [81, 2_674_308],
      [116, 2_674_304],
      [162, 2_674_304],
    ] as const;
    for (const [at, value] of moved) body.set(paddedIndex(value), at);
  });
  assert.equal(WebAssembly.validate(new Uint8Array(consistentlyWrongStatic)), true);
  assert.equal(deriveEquivalentTemplateSaveBuild(consistentlyWrongStatic), null);

  // The screenshot directory had only one relocation, so internal consistency
  // could never constrain it. Its unique initialized object now owns the value.
  const ensureDirectory = derived.bridges.find(
    (bridge) => bridge.kind === "ensureDirectory",
  )!;
  const screenshotSink = Math.max(
    ...ensureDirectory.callSites.map((callSite) => callSite.localFunction),
  );
  const wrongScreenshotDirectory = rewriteCode(bytes, (bodies) => {
    bodies[screenshotSink]!.set(paddedIndex(2_635_888), 183);
  });
  assert.equal(
    WebAssembly.validate(new Uint8Array(wrongScreenshotDirectory)),
    true,
  );
  assert.equal(deriveEquivalentTemplateSaveBuild(wrongScreenshotDirectory), null);
});

test("every certified runtime profile reproduces the real client chain", async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(
    artifact,
    "GW_CLIENT_WASM must explicitly name the real Gw.jspi.wasm artifact",
  );
  const official = new Uint8Array(await readFile(artifact));
  const verified = verifyLocalClientBytes(official);
  assert.equal(
    isLocalClientVerification(verified, sha256(official)),
    true,
    "the real client proof must cross the production boundary",
  );
  const templateBuild = verified.templateSaveBuild;
  assert.ok(templateBuild, "the real client must pass the template-save proof");
  const template = rewriteTemplateSaveWasm(official, templateBuild);
  const enhancementBuild = verified.enhancementBuild;
  assert.ok(enhancementBuild, "the template output must pass Enhancement proof");

  // The off profile and every optional capability profile feed the same two
  // downstream exact-hash transforms. Reproducing the complete chain here is
  // what catches an ABI/config edit whose source tests pass but whose authored
  // certificate hashes were not regenerated.
  const derivedTemplateDoubleClick = deriveNativeDoubleClickBuild(template);
  assert.equal(
    isDerivedNativeDoubleClickBuild(derivedTemplateDoubleClick, sha256(template)),
    true,
    "the exact fixture must independently cross semantic proof",
  );
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
    const derivedDoubleClick = deriveNativeDoubleClickBuild(enhanced);
    assert.equal(
      isDerivedNativeDoubleClickBuild(derivedDoubleClick, sha256(enhanced)),
      true,
      `profile ${profile} must independently cross semantic proof`,
    );
    rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(enhanced));
  }
});
