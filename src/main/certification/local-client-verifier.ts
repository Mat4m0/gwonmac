/**
 * The structural proof that decides whether an unrecognised official client may
 * still be transformed, and what it may be transformed for.
 *
 * Pure: it reads the bytes it is handed and nothing else — no profile state, no
 * filesystem, no caching, and no Electron, which a utility process could not
 * resolve anyway. The host owns all of that, which is what allows this to run
 * inside a bounded isolated process.
 *
 * The two answers are not symmetric and must not be merged. Template save is
 * shape-verifiable, so a client whose affected call sites still match is
 * accepted by proof. Cursor and read-only Target Distance each have a strict,
 * independent structural locator; Party and Team Apply join that path only
 * after their complete field and packet ledgers prove independently.
 *
 * `isLocalClientVerification` re-validates every field of a result that crossed
 * the process boundary. Profile state is never consulted.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  enhancementCapabilityProfile,
  enhancementCapabilitiesRequested,
  ENHANCEMENT_CAPABILITY_PRESETS,
  intersectEnhancementCapabilities,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  ENHANCEMENT_BUILDS,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  inspectEnhancementStructuralEvidence,
  inspectTargetRoleCandidates,
  locateAutomaticCursor,
  locateAutomaticLocalActions,
  locateAutomaticTarget,
  type AutomaticCursorLocation,
  type AutomaticLocalActionsLocation,
  type AutomaticTargetLocation,
  type EnhancementStructuralEvidenceReport,
} from "./enhancement-structural-evidence.js";
import { inspectEnhancementCandidate } from "./enhancement-candidate.js";
import {
  inspectLocalActionRoleCandidates,
  type LocalActionRoleDiagnostics,
} from "./enhancement-local-actions-proof.js";
import { transformEnhancementWasm } from "./enhancement-transform.js";
import {
  enhancementProofContext,
  type EnhancementProofContext,
} from "./enhancement-wasm-proof-context.js";
import {
  preparePostTemplateSaveModule,
  type PostTemplateSaveModule,
} from "./template-save-verifier.js";
import {
  localFeatureVerdictsForBuild,
  type EnhancementVerificationReason,
  type LocalClientFeature,
  type LocalClientVerification,
  type LocalFeatureFailure,
  type LocalFeatureFailures,
  type LocalFeatureInvariant,
} from "./local-client-verification-contract.js";
import { SEMANTIC_VERIFIER_ABI } from "./semantic-proof.js";
import { deriveSkillKeyOverlay } from "./enhancement-skill-key-overlay-proof.js";

export { isLocalClientVerification } from "./local-client-verification-boundary.js";
export {
  LOCAL_FEATURE_INVARIANTS,
  LOCAL_VERIFICATION_REASONS,
  localFeatureVerdictsForBuild,
  type LocalClientFeature,
  type LocalClientVerification,
  type LocalFeatureCertificateMap,
  type LocalFeatureFailure,
  type LocalFeatureFailures,
  type LocalFeatureInvariant,
  type LocalFeatureVerdict,
  type LocalFeatureVerdicts,
  type LocalVerificationReason,
} from "./local-client-verification-contract.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

type EnhancementDerivation = Readonly<{
  build: KnownEnhancementBuild | null;
  failures?: LocalFeatureFailures;
}>;

function changedFeature<Feature extends LocalClientFeature>(
  _feature: Feature,
  invariant: LocalFeatureInvariant<Feature>,
): LocalFeatureFailure<Feature> {
  return Object.freeze({ status: "changed", invariant });
}

function ambiguousFeature<Feature extends LocalClientFeature>(
  _feature: Feature,
  invariant: LocalFeatureInvariant<Feature>,
  candidates: number,
): LocalFeatureFailure<Feature> {
  return Object.freeze({ status: "ambiguous", invariant, candidates });
}

function ambiguousRoleFailure<Feature extends LocalClientFeature>(
  feature: Feature,
  invariant: LocalFeatureInvariant<Feature>,
  diagnostic: LocalActionRoleDiagnostics[keyof LocalActionRoleDiagnostics]
    | undefined,
): LocalFeatureFailure<Feature> | null {
  return diagnostic?.status === "ambiguous"
    ? ambiguousFeature(feature, invariant, diagnostic.candidateCount)
    : null;
}

function failuresForRequested(
  requested: EnhancementCapabilities,
  invariant:
    | "module.wasm-validation"
    | "module.binary-shape"
    | "enhancement.transform",
): LocalFeatureFailures {
  return Object.freeze({
    ...(requested.nativeCursor
      ? { nativeCursor: changedFeature("nativeCursor", invariant) }
      : {}),
    ...(requested.targetObservation
      ? { targetObservation: changedFeature("targetObservation", invariant) }
      : {}),
    ...(requested.partyObservation
      ? { partyObservation: changedFeature("partyObservation", invariant) }
      : {}),
    ...(requested.teamApply
      ? { teamApply: changedFeature("teamApply", invariant) }
      : {}),
    ...(requested.travelAction
      ? { travelAction: changedFeature("travelAction", invariant) }
      : {}),
    ...(requested.xunlaiAction
      ? { xunlaiAction: changedFeature("xunlaiAction", invariant) }
      : {}),
    ...(requested.chatAliases
      ? { chatAliases: changedFeature("chatAliases", invariant) }
      : {}),
    ...(requested.skillKeyOverlay
      ? { skillKeyOverlay: changedFeature("skillKeyOverlay", invariant) }
      : {}),
  });
}

function messageAnchors(): Parameters<typeof inspectEnhancementStructuralEvidence>[1] | null {
  const baseline = ENHANCEMENT_BUILDS.at(-1);
  const dispatcher = baseline?.uiDispatcher;
  const party = baseline?.partyObservation;
  return dispatcher && party
    ? Object.freeze({
        playerChatMessage: dispatcher.playerChatMessage,
        nearbyPlayerMessages: Object.freeze([
          party.nearbyPlayerMessages[0],
          party.nearbyPlayerMessages[1],
        ] as const),
      })
    : null;
}

function structuralEvidence(
  input: Uint8Array,
  context: EnhancementProofContext,
): EnhancementStructuralEvidenceReport | null {
  const anchors = messageAnchors();
  if (!anchors) return null;
  try {
    return inspectEnhancementStructuralEvidence(input, anchors, context);
  } catch {
    return null;
  }
}

function sharedEvidenceFailure<Feature extends LocalClientFeature>(
  feature: Feature,
  evidence: EnhancementStructuralEvidenceReport | null,
): LocalFeatureFailure<Feature> | null {
  const failure = evidence?.failures[0];
  if (failure === "input-too-large") {
    return changedFeature(feature, "module.input-size");
  }
  if (failure === "invalid-wasm") {
    return changedFeature(feature, "module.wasm-validation");
  }
  if (failure === "module-shape-unsupported") {
    return changedFeature(feature, "module.binary-shape");
  }
  if (failure === "instruction-set-unsupported") {
    return changedFeature(feature, "module.instruction-set");
  }
  if (failure === "analysis-limit-exceeded") {
    return changedFeature(feature, "module.analysis-budget");
  }
  if (evidence?.tick.status === "ambiguous") {
    const candidates = evidence.tick.considered.filter(
      ({ signature }) =>
        signature?.params.length === 1
        && signature.results.length === 0,
    ).length;
    return ambiguousFeature(
      feature,
      "hook.main-loop-export",
      Math.max(2, candidates),
    );
  }
  if (evidence?.tick.status === "unavailable") {
    const invariant = evidence.tick.exportCount === 1
      ? "hook.main-loop-signature"
      : "hook.main-loop-export";
    return changedFeature(feature, invariant);
  }
  return null;
}

function cursorFailure(
  evidence: EnhancementStructuralEvidenceReport | null,
): LocalFeatureFailure<"nativeCursor"> {
  const shared = sharedEvidenceFailure("nativeCursor", evidence);
  if (shared) return shared;
  if (evidence?.failures.includes("active-table-unsupported")) {
    return changedFeature("nativeCursor", "cursor.active-table-relation");
  }
  if (evidence?.cursor.status === "ambiguous") {
    const ownerCandidates = evidence.cursor.considered.filter(
      (candidate) =>
        candidate.directProducers.length === 2
        && candidate.directCallSites === 2
        && candidate.activeTableSlots.length === 1,
    );
    if (ownerCandidates.length > 1) {
      return ambiguousFeature(
        "nativeCursor",
        "cursor.event-owner",
        ownerCandidates.length,
      );
    }
    const relationCandidates = evidence.cursor.considered
      .filter(
        (candidate) =>
          candidate.directProducers.length === 2
          && candidate.directCallSites === 2,
      )
      .reduce((sum, candidate) => sum + candidate.activeTableSlots.length, 0);
    return ambiguousFeature(
      "nativeCursor",
      "cursor.active-table-relation",
      Math.max(2, relationCandidates),
    );
  }
  return evidence?.cursor.status === "unavailable"
    ? changedFeature("nativeCursor", "cursor.event-owner")
    : changedFeature("nativeCursor", "cursor.event-family-layout-anchors");
}

function playerChatUiCandidates(
  evidence: EnhancementStructuralEvidenceReport,
): number {
  return evidence.playerChatUi.considered.filter(
    (candidate) =>
      candidate.signatureMatches
      && candidate.playerChat.filter(
        (relation) => relation.messageSites === 3 && relation.directCallSites === 3,
      ).length === 1
      && candidate.nearby7f.length > 0
      && candidate.nearby80.length > 0,
  ).length;
}

function uiFailure<Feature extends "partyObservation" | "teamApply">(
  feature: Feature,
  evidence: EnhancementStructuralEvidenceReport | null,
): LocalFeatureFailure<Feature> | null {
  const shared = sharedEvidenceFailure(feature, evidence);
  if (shared) return shared;
  if (evidence?.playerChatUi.status === "ambiguous") {
    return ambiguousFeature(
      feature,
      "party.ui-dispatcher",
      Math.max(2, playerChatUiCandidates(evidence)),
    );
  }
  return evidence?.playerChatUi.status === "unavailable"
    ? changedFeature(feature, "party.ui-dispatcher")
    : null;
}

function diagnoseFeatureFailures(
  input: Uint8Array,
  requested: EnhancementCapabilities,
  locatedCursor: AutomaticCursorLocation | null,
  locatedTarget: AutomaticTargetLocation | null,
  locatedLocal: AutomaticLocalActionsLocation | null,
  locatedSkillKeyOverlay: ReturnType<typeof deriveSkillKeyOverlay>,
  context: EnhancementProofContext,
): LocalFeatureFailures {
  const needsLocalEvidence = (requested.partyObservation
      && !locatedLocal?.partyObservation)
    || (requested.teamApply && !locatedLocal?.teamApply)
    || (requested.travelAction && !locatedLocal?.travelAction)
    || (requested.xunlaiAction && !locatedLocal?.xunlaiAction)
    || (requested.chatAliases && !locatedLocal?.chatAliases);
  const needsSkillEvidence = requested.skillKeyOverlay
    && locatedSkillKeyOverlay === null;
  const needsEvidence = (requested.nativeCursor && !locatedCursor)
    || (requested.targetObservation && !locatedTarget)
    || needsLocalEvidence
    || needsSkillEvidence;
  const evidence = needsEvidence ? structuralEvidence(input, context) : null;
  const roles = needsLocalEvidence
    ? inspectLocalActionRoleCandidates(input, ENHANCEMENT_BUILDS, context)
    : null;
  const targetRoles = requested.targetObservation && !locatedTarget
    ? inspectTargetRoleCandidates(input, context)
    : null;
  const targetShared = sharedEvidenceFailure("targetObservation", evidence);
  const partyUi = uiFailure("partyObservation", evidence);
  const teamUi = uiFailure("teamApply", evidence);
  const travelShared = sharedEvidenceFailure("travelAction", evidence);
  const xunlaiShared = sharedEvidenceFailure("xunlaiAction", evidence);
  const aliasesShared = sharedEvidenceFailure("chatAliases", evidence);
  const skillShared = sharedEvidenceFailure("skillKeyOverlay", evidence);
  return Object.freeze({
    ...(requested.nativeCursor && !locatedCursor
      ? { nativeCursor: cursorFailure(evidence) }
      : {}),
    ...(requested.targetObservation && !locatedTarget
      ? {
          targetObservation: targetShared
            ?? ambiguousRoleFailure(
              "targetObservation",
              "target.observation-selection-anchors",
              targetRoles ?? undefined,
            )
            ?? changedFeature(
              "targetObservation",
              "target.observation-selection-anchors",
            ),
        }
      : {}),
    ...(requested.partyObservation && !locatedLocal?.partyObservation
      ? {
          partyObservation: partyUi
            ?? ambiguousRoleFailure(
              "partyObservation",
              "party.ui-dispatcher",
              roles?.uiDispatcher,
            )
            ?? ambiguousRoleFailure(
              "partyObservation",
              "party.observation-anchors",
              roles?.partyObservation,
            )
            ?? changedFeature("partyObservation", "party.observation-anchors"),
        }
      : {}),
    ...(requested.teamApply && !locatedLocal?.teamApply
      ? {
          teamApply: teamUi
            ?? ambiguousRoleFailure(
              "teamApply",
              "party.ui-dispatcher",
              roles?.uiDispatcher,
            )
            ?? ambiguousRoleFailure(
              "teamApply",
              "team.party-observation-prerequisite",
              roles?.partyObservation,
            )
            ?? ambiguousRoleFailure(
              "teamApply",
              "local.game-thread-safe-point",
              roles?.gameThread,
            )
            ?? ambiguousRoleFailure(
              "teamApply",
              "team.packet-builder-anchors",
              roles?.teamApply,
            )
            ?? (locatedLocal?.partyObservation
              ? changedFeature("teamApply", "team.packet-builder-anchors")
              : changedFeature(
                  "teamApply",
                  "team.party-observation-prerequisite",
                )),
        }
      : {}),
    ...(requested.travelAction && !locatedLocal?.travelAction
      ? {
          travelAction: travelShared
            ?? ambiguousRoleFailure(
              "travelAction",
              "local.ui-dispatcher",
              roles?.uiDispatcher,
            )
            ?? ambiguousRoleFailure(
              "travelAction",
              "local.game-thread-safe-point",
              roles?.gameThread,
            )
            ?? ambiguousRoleFailure(
              "travelAction",
              "travel.message-producer-anchor",
              roles?.travelAction,
            )
            ?? ambiguousRoleFailure(
              "travelAction",
              "travel.current-context-resolver",
              roles?.travelContext,
            )
            ?? (!locatedLocal?.uiDispatcher && locatedLocal !== null
              ? changedFeature("travelAction", "local.ui-dispatcher")
              : !locatedLocal?.gameThread && locatedLocal !== null
                ? changedFeature(
                    "travelAction",
                    "local.game-thread-safe-point",
                  )
                : roles?.travelAction.status !== "candidate"
                  ? changedFeature(
                      "travelAction",
                      "travel.message-producer-anchor",
                    )
                  : changedFeature(
                      "travelAction",
                      "travel.current-context-resolver",
                    )),
        }
      : {}),
    ...(requested.xunlaiAction && !locatedLocal?.xunlaiAction
      ? {
          xunlaiAction: xunlaiShared
            ?? ambiguousRoleFailure(
              "xunlaiAction",
              "local.ui-dispatcher",
              roles?.uiDispatcher,
            )
            ?? ambiguousRoleFailure(
              "xunlaiAction",
              "local.game-thread-safe-point",
              roles?.gameThread,
            )
            ?? ambiguousRoleFailure(
              "xunlaiAction",
              "xunlai.data-window-anchors",
              roles?.xunlaiAction,
            )
            ?? (!locatedLocal?.uiDispatcher && locatedLocal !== null
              ? changedFeature("xunlaiAction", "local.ui-dispatcher")
              : !locatedLocal?.gameThread && locatedLocal !== null
                ? changedFeature(
                    "xunlaiAction",
                    "local.game-thread-safe-point",
                  )
                : changedFeature(
                    "xunlaiAction",
                    "xunlai.data-window-anchors",
                  )),
        }
      : {}),
    ...(requested.chatAliases && !locatedLocal?.chatAliases
      ? {
          chatAliases: aliasesShared
            ?? ambiguousRoleFailure(
              "chatAliases",
              "local.ui-dispatcher",
              roles?.uiDispatcher,
            )
            ?? ambiguousRoleFailure(
              "chatAliases",
              "chat.alias-parser-anchor",
              roles?.chatAliases,
            )
            ?? (!locatedLocal?.uiDispatcher && locatedLocal !== null
              ? changedFeature("chatAliases", "local.ui-dispatcher")
              : changedFeature("chatAliases", "chat.alias-parser-anchor")),
        }
      : {}),
    ...(needsSkillEvidence
      ? {
          skillKeyOverlay: skillShared
            ?? changedFeature(
              "skillKeyOverlay",
              "skill-overlay.frame-constructor",
            ),
        }
      : {}),
  });
}

function deriveEnhancementBuild(
  official: Uint8Array,
  templateOutput: Uint8Array,
  requestedCapabilities: EnhancementCapabilities,
): EnhancementDerivation {
  const report = inspectEnhancementCandidate(templateOutput);
  if (!report.validWasm) {
    return Object.freeze({
      build: null,
      failures: failuresForRequested(
        requestedCapabilities,
        "module.wasm-validation",
      ),
    });
  }
  // A common address delta alone proves nothing. The isolated feature locators
  // below own their complete cursor, Target, and local-action evidence independently.
  const context = enhancementProofContext(templateOutput);
  if (!context) {
    return Object.freeze({
      build: null,
      failures: failuresForRequested(
        requestedCapabilities,
        "module.binary-shape",
      ),
    });
  }
  const locatedCursor = requestedCapabilities.nativeCursor
    ? locateAutomaticCursor(templateOutput, ENHANCEMENT_BUILDS, context)
    : null;
  const locatedTarget = requestedCapabilities.targetObservation
    ? locateAutomaticTarget(templateOutput, ENHANCEMENT_BUILDS, context)
    : null;
  const wantsLocal = requestedCapabilities.partyObservation
    || requestedCapabilities.teamApply
    || requestedCapabilities.travelAction
    || requestedCapabilities.xunlaiAction
    || requestedCapabilities.chatAliases;
  const locatedLocal = wantsLocal
    ? locateAutomaticLocalActions(
        templateOutput,
        ENHANCEMENT_BUILDS,
        context,
        locatedTarget?.observationLayout,
      )
    : null;
  const locatedSkillKeyOverlay = requestedCapabilities.skillKeyOverlay
    ? deriveSkillKeyOverlay(context)
    : null;
  const cursor = locatedCursor?.baseline.cursorEvent;
  const includeCursor = locatedCursor !== null && cursor !== undefined;
  const includeTarget = locatedTarget !== null;
  const includeParty = requestedCapabilities.partyObservation
    && locatedLocal?.observationLayout != null
    && locatedLocal.uiDispatcher != null
    && locatedLocal.partyObservation != null;
  const includeTeam = requestedCapabilities.teamApply
    && includeParty
    && locatedLocal?.gameThread != null
    && locatedLocal.teamApply != null;
  const includeTravel = requestedCapabilities.travelAction
    && locatedLocal?.uiDispatcher != null
    && locatedLocal.gameThread != null
    && locatedLocal.travelAction != null;
  const includeXunlai = requestedCapabilities.xunlaiAction
    && locatedLocal?.observationLayout != null
    && locatedLocal.uiDispatcher != null
    && locatedLocal.gameThread != null
    && locatedLocal.xunlaiAction?.accessProof != null;
  const includeAliases = requestedCapabilities.chatAliases
    && locatedLocal?.uiDispatcher != null
    && locatedLocal.chatAliases != null;
  const includeSkillKeyOverlay = requestedCapabilities.skillKeyOverlay
    && includeParty
    && locatedSkillKeyOverlay !== null;
  const failures = diagnoseFeatureFailures(
    templateOutput,
    requestedCapabilities,
    locatedCursor,
    locatedTarget,
    locatedLocal,
    locatedSkillKeyOverlay,
    context,
  );
  const localContributes = includeParty || includeTeam || includeTravel
    || includeXunlai || includeAliases;
  const source = includeCursor
    ? locatedCursor
    : includeTarget
      ? locatedTarget
      : localContributes
        ? locatedLocal
        : null;
  if (source === null || !report.table || report.table.max === null) {
    return Object.freeze({ build: null, failures });
  }
  if (
    includeTarget
    && (includeParty || includeXunlai)
    && !isDeepStrictEqual(
      locatedTarget.observationLayout,
      locatedLocal?.observationLayout,
    )
  ) {
    return Object.freeze({
      build: null,
      failures: Object.freeze({
        ...failures,
        ...(requestedCapabilities.targetObservation
          ? {
              targetObservation: changedFeature(
                "targetObservation",
                "target.shared-observation-layout",
              ),
            }
          : {}),
        ...(requestedCapabilities.partyObservation
          ? {
              partyObservation: changedFeature(
                "partyObservation",
                "party.observation-anchors",
              ),
            }
          : {}),
        ...(requestedCapabilities.xunlaiAction
          ? {
              xunlaiAction: changedFeature(
                "xunlaiAction",
                "xunlai.data-window-anchors",
              ),
            }
          : {}),
      }),
    });
  }
  const baseline = source.baseline;
  const observationLayout = includeTarget
    ? locatedTarget.observationLayout
    : includeParty || includeXunlai
      ? locatedLocal!.observationLayout!
      : null;
  const provisional: KnownEnhancementBuild = Object.freeze({
    sha256: report.sha256,
    outputSha256: Object.freeze({}),
    programId: baseline.programId,
    buildId: Number.parseInt(sha256(official).slice(0, 8), 16) || 1,
    hookFunction: source.hookFunction,
    hookParams: Object.freeze(["i32"] as const),
    hookResults: Object.freeze([] as const),
    hookBodySha256: source.hookBodySha256,
    tableSlot: report.table.min,
    ...(includeCursor ? {
      cursorEvent: Object.freeze({
        functionIndex: locatedCursor.cursorFunction,
        params: cursor.params,
        results: cursor.results,
        tableSlot: locatedCursor.cursorTableSlot,
        producerFunctions: locatedCursor.producerFunctions,
        producerParams: cursor.producerParams,
        producerResults: cursor.producerResults,
        bodySha256: cursor.bodySha256,
        producerBodySha256: locatedCursor.producerBodySha256,
        tableNeighbourBodySha256: cursor.tableNeighbourBodySha256,
        layout: locatedCursor.layout,
      }),
    } : {}),
    ...(observationLayout ? {
      observationBase: Object.freeze({ layout: observationLayout }),
    } : {}),
    ...(includeTarget ? {
      targetObservation: Object.freeze({ layout: locatedTarget.targetLayout }),
    } : {}),
    ...(localContributes ? { uiDispatcher: locatedLocal!.uiDispatcher! } : {}),
    ...(includeTeam || includeTravel || includeXunlai
      ? { gameThread: locatedLocal!.gameThread! }
      : {}),
    ...(includeTravel ? { travelAction: locatedLocal!.travelAction! } : {}),
    ...(includeXunlai ? { xunlaiAction: locatedLocal!.xunlaiAction! } : {}),
    ...(includeAliases ? { chatAliases: locatedLocal!.chatAliases! } : {}),
    ...(includeParty ? {
      partyObservation: locatedLocal.partyObservation,
    } : {}),
    ...(includeTeam ? { teamApply: locatedLocal!.teamApply! } : {}),
    ...(includeSkillKeyOverlay
      ? { skillKeyOverlay: locatedSkillKeyOverlay }
      : {}),
  });
  const maximum: EnhancementCapabilities = Object.freeze({
    nativeCursor: includeCursor,
    targetObservation: includeTarget,
    partyObservation: includeParty,
    teamApply: includeTeam,
    travelAction: includeTravel,
    xunlaiAction: includeXunlai,
    chatAliases: includeAliases,
    skillKeyOverlay: includeSkillKeyOverlay,
  });
  const effective = intersectEnhancementCapabilities(requestedCapabilities, maximum);
  const profile = enhancementCapabilityProfile(effective);
  if (profile === null || !enhancementCapabilitiesRequested(effective)) {
    return Object.freeze({ build: null, failures });
  }
  const outputSha256 = Object.freeze({
    [profile]: sha256(transformEnhancementWasm(
      templateOutput,
      provisional,
      effective,
    )),
  });
  return Object.freeze({
    build: Object.freeze({
      ...provisional,
      outputSha256: Object.freeze(outputSha256),
    }),
    failures,
  });
}

/**
 * Pure verifier entry point. It reads no profile state and performs no writes;
 * the utility-process host supplies the exact official bytes.
 */
export function verifyLocalClientBytes(
  official: Uint8Array,
  requestedCapabilities: EnhancementCapabilities = ENHANCEMENT_CAPABILITY_PRESETS.all,
): LocalClientVerification {
  const officialSha256 = sha256(official);
  const base = Object.freeze({
    officialSha256,
    verifierAbi: SEMANTIC_VERIFIER_ABI,
  });
  if (!WebAssembly.validate(official)) {
    return {
      ...base,
      status: "template-refused",
      templateSaveBuild: null,
      enhancementBuild: null,
      featureVerdicts: null,
      reasons: ["invalid-wasm"],
    };
  }

  let postTemplate: PostTemplateSaveModule | null;
  try {
    postTemplate = preparePostTemplateSaveModule(official);
  } catch {
    return {
      ...base,
      status: "template-refused",
      templateSaveBuild: null,
      enhancementBuild: null,
      featureVerdicts: null,
      reasons: ["template-transform-failed"],
    };
  }
  if (!postTemplate) {
    return {
      ...base,
      status: "template-refused",
      templateSaveBuild: null,
      enhancementBuild: null,
      featureVerdicts: null,
      reasons: ["template-shape-changed"],
    };
  }

  const templateSaveBuild = postTemplate.build;
  const templateOutput = postTemplate.bytes;
  if (!enhancementCapabilitiesRequested(requestedCapabilities)) {
    return {
      ...base,
      status: "template-proved",
      templateSaveBuild,
      enhancementBuild: null,
      featureVerdicts: localFeatureVerdictsForBuild(
        templateSaveBuild.outputSha256,
        requestedCapabilities,
        null,
      ),
      reasons: [],
    };
  }

  let derivation: EnhancementDerivation = Object.freeze({
    build: null,
    failures: failuresForRequested(
      requestedCapabilities,
      "enhancement.transform",
    ),
  });
  let refusal: EnhancementVerificationReason = "enhancement-layout-changed";
  try {
    derivation = deriveEnhancementBuild(
      official,
      templateOutput,
      requestedCapabilities,
    );
  } catch {
    refusal = "enhancement-transform-failed";
  }
  const enhancementBuild = derivation.build;
  const featureVerdicts = localFeatureVerdictsForBuild(
    templateSaveBuild.outputSha256,
    requestedCapabilities,
    enhancementBuild,
    derivation.failures,
  );
  if (enhancementBuild === null) {
    return {
      ...base,
      status: "enhancement-refused",
      templateSaveBuild,
      enhancementBuild: null,
      featureVerdicts,
      reasons: [refusal],
    };
  }
  return {
    ...base,
    status: "proved",
    templateSaveBuild,
    enhancementBuild,
    featureVerdicts,
    reasons: [],
  };
}
