/**
 * Strict process-boundary validation for ABI- and input-bound feature verdicts.
 * It rejects stale, malformed, and cross-input proof messages.
 */
import { isDeepStrictEqual } from "node:util";
import { isDigest } from "../../shared/digest.js";
import {
  enhancementCapabilityProfile,
  enhancementCapabilitiesForProfile,
  enhancementCapabilitiesCover,
  enhancementCapabilitiesRequested,
  ENHANCEMENT_CAPABILITY_FIELDS,
  ENHANCEMENT_CAPABILITY_PRESETS,
  intersectEnhancementCapabilities,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  ENHANCEMENT_BUILDS,
  supportedEnhancementCapabilities,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  LOCAL_FEATURE_INVARIANTS,
  LOCAL_VERIFICATION_REASONS,
  localFeatureVerdictsForBuild,
  type EnhancementVerificationReason,
  type LocalClientFeature,
  type LocalClientVerification,
  type LocalFileVerdict,
  type LocalFeatureFailure,
  type LocalFeatureFailures,
  type LocalFeatureInvariant,
  type LocalFeatureVerdicts,
  type LocalVerificationReason,
  type TemplateVerificationReason,
} from "./local-client-verification-contract.js";
import { SEMANTIC_VERIFIER_ABI } from "./semantic-proof.js";
import { isSkillSlotGeometryProof } from "./enhancement-skill-slot-geometry-proof.js";
import { isEffectIconGeometryProof, isPlayerEffectObservationProof } from
  "./enhancement-player-effect-proof.js";
import {
  BRIDGE_KINDS,
  TEMPLATE_SAVE_BUILDS,
  type BridgeKind,
  type KnownTemplateSaveBuild,
} from "./template-save-compat.js";

function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hasExactOwnKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isTemplateReason(value: unknown): value is TemplateVerificationReason {
  return value === "invalid-wasm"
    || value === "template-shape-changed"
    || value === "template-transform-failed";
}

function isEnhancementReason(value: unknown): value is EnhancementVerificationReason {
  return value === "enhancement-layout-changed"
    || value === "enhancement-transform-failed";
}

function isLocalFileVerdict(
  value: unknown,
  officialSha256: string,
  templateSaveBuild: KnownTemplateSaveBuild | null,
): value is LocalFileVerdict {
  if (!value || typeof value !== "object") return false;
  const verdict = value as Partial<LocalFileVerdict>;
  if (
    verdict.inputSha256 !== officialSha256
    || verdict.verifierAbi !== SEMANTIC_VERIFIER_ABI
  ) return false;
  if (verdict.status === "proved") {
    return hasExactOwnKeys(value as Readonly<Record<string, unknown>>, [
      "status", "inputSha256", "outputSha256", "verifierAbi",
    ])
      && templateSaveBuild !== null
      && verdict.outputSha256 === templateSaveBuild.outputSha256;
  }
  return verdict.status === "refused"
    && hasExactOwnKeys(value as Readonly<Record<string, unknown>>, [
      "status", "inputSha256", "verifierAbi", "reason",
    ])
    && templateSaveBuild === null
    && (verdict.reason === "template-shape-changed"
      || verdict.reason === "template-transform-failed");
}

function isLocalFeatureInvariant<Feature extends LocalClientFeature>(
  feature: Feature,
  value: unknown,
): value is LocalFeatureInvariant<Feature> {
  return typeof value === "string"
    && (LOCAL_FEATURE_INVARIANTS[feature] as readonly string[]).includes(value);
}

function refusalForFeature<Feature extends LocalClientFeature>(
  feature: Feature,
  verdict: LocalFeatureVerdicts[Feature],
): LocalFeatureFailure<Feature> | null | undefined {
  if (verdict.status !== "changed" && verdict.status !== "ambiguous") {
    return undefined;
  }
  if (!isLocalFeatureInvariant(feature, verdict.invariant)) return null;
  if (verdict.status === "ambiguous") {
    return Number.isSafeInteger(verdict.candidates) && verdict.candidates >= 2
      ? Object.freeze({
          status: verdict.status,
          invariant: verdict.invariant,
          candidates: verdict.candidates,
        })
      : null;
  }
  return Object.freeze({ status: verdict.status, invariant: verdict.invariant });
}

function featureFailuresFromVerdicts(
  verdicts: LocalFeatureVerdicts,
): LocalFeatureFailures | null {
  if (!hasExactOwnKeys(
    verdicts as unknown as Readonly<Record<string, unknown>>,
    ENHANCEMENT_CAPABILITY_FIELDS,
  )) return null;
  const nativeCursor = refusalForFeature("nativeCursor", verdicts.nativeCursor);
  const playRegionObservation = refusalForFeature(
    "playRegionObservation",
    verdicts.playRegionObservation,
  );
  const targetObservation = refusalForFeature(
    "targetObservation",
    verdicts.targetObservation,
  );
  const partyObservation = refusalForFeature(
    "partyObservation",
    verdicts.partyObservation,
  );
  const teamApply = refusalForFeature("teamApply", verdicts.teamApply);
  const travelAction = refusalForFeature("travelAction", verdicts.travelAction);
  const xunlaiAction = refusalForFeature("xunlaiAction", verdicts.xunlaiAction);
  const chatAliases = refusalForFeature("chatAliases", verdicts.chatAliases);
  const chatFiltering = refusalForFeature(
    "chatFiltering",
    verdicts.chatFiltering,
  );
  const skillSlotGeometry = refusalForFeature(
    "skillSlotGeometry",
    verdicts.skillSlotGeometry,
  );
  const skillCooldownObservation = refusalForFeature(
    "skillCooldownObservation",
    verdicts.skillCooldownObservation,
  );
  const preGameControls = refusalForFeature(
    "preGameControls",
    verdicts.preGameControls,
  );
  const characterSwitchAction = refusalForFeature(
    "characterSwitchAction",
    verdicts.characterSwitchAction,
  );
  const quickItemMove = refusalForFeature(
    "quickItemMove",
    verdicts.quickItemMove,
  );
  const playerEffectObservation = refusalForFeature(
    "playerEffectObservation",
    verdicts.playerEffectObservation,
  );
  const effectIconGeometry = refusalForFeature(
    "effectIconGeometry",
    verdicts.effectIconGeometry,
  );
  if (
    nativeCursor === null
    || playRegionObservation === null
    || targetObservation === null
    || partyObservation === null
    || teamApply === null
    || travelAction === null
    || xunlaiAction === null
    || chatAliases === null
    || chatFiltering === null
    || skillSlotGeometry === null
    || skillCooldownObservation === null
    || preGameControls === null
    || characterSwitchAction === null
    || quickItemMove === null
    || playerEffectObservation === null
    || effectIconGeometry === null
  ) return null;
  return Object.freeze({
    ...(nativeCursor ? { nativeCursor } : {}),
    ...(playRegionObservation ? { playRegionObservation } : {}),
    ...(targetObservation ? { targetObservation } : {}),
    ...(partyObservation ? { partyObservation } : {}),
    ...(teamApply ? { teamApply } : {}),
    ...(travelAction ? { travelAction } : {}),
    ...(xunlaiAction ? { xunlaiAction } : {}),
    ...(chatAliases ? { chatAliases } : {}),
    ...(chatFiltering ? { chatFiltering } : {}),
    ...(skillSlotGeometry ? { skillSlotGeometry } : {}),
    ...(skillCooldownObservation ? { skillCooldownObservation } : {}),
    ...(preGameControls ? { preGameControls } : {}),
    ...(characterSwitchAction ? { characterSwitchAction } : {}),
    ...(quickItemMove ? { quickItemMove } : {}),
    ...(playerEffectObservation ? { playerEffectObservation } : {}),
    ...(effectIconGeometry ? { effectIconGeometry } : {}),
  });
}

function isTemplateSaveBuild(
  value: unknown,
  officialSha256: string,
): value is KnownTemplateSaveBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<KnownTemplateSaveBuild>;
  if (
    build.sha256 !== officialSha256
    || !isDigest(build.outputSha256)
    || !isIndex(build.importCount)
    || !isIndex(build.carrierImport)
    || !Array.isArray(build.bridges)
    || build.bridges.length
      !== TEMPLATE_SAVE_BUILDS[TEMPLATE_SAVE_BUILDS.length - 1]?.bridges.length
  ) {
    return false;
  }
  const kinds = new Set<BridgeKind>();
  for (const bridge of build.bridges) {
    if (
      !bridge
      || !BRIDGE_KINDS.includes(bridge.kind)
      || kinds.has(bridge.kind)
      || !isIndex(bridge.stubFunction)
      || !Array.isArray(bridge.callSites)
      || bridge.callSites.length === 0
      || !bridge.callSites.every(
        (site: unknown) => {
          if (!site || typeof site !== "object") return false;
          const callSite = site as {
            localFunction?: unknown;
            bodyOffset?: unknown;
          };
          return isIndex(callSite.localFunction) && isIndex(callSite.bodyOffset);
        },
      )
      || (
        bridge.stubBody !== undefined
        && (
          !Array.isArray(bridge.stubBody)
          || !bridge.stubBody.every(
            (byte: unknown) =>
              typeof byte === "number"
              && Number.isInteger(byte)
              && byte >= 0
              && byte <= 0xff,
          )
        )
      )
    ) {
      return false;
    }
    kinds.add(bridge.kind);
  }
  return kinds.size === BRIDGE_KINDS.length;
}

type SemanticBuild = Readonly<Partial<KnownEnhancementBuild>>;

function matchesCoreProof(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  return build.programId === baseline.programId
    && isDeepStrictEqual(build.hookParams, baseline.hookParams)
    && isDeepStrictEqual(build.hookResults, baseline.hookResults);
}

function matchesCursorProof(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.cursorEvent;
  if (candidate === undefined) return true;
  const expected = baseline.cursorEvent;
  return expected !== undefined
    && isIndex(candidate.functionIndex)
    && isIndex(candidate.tableSlot)
    && candidate.producerFunctions.length === 2
    && candidate.producerFunctions.every(isIndex)
    && candidate.producerBodySha256.length === 2
    && candidate.producerBodySha256.every(isDigest)
    && Object.values(candidate.layout).every(isIndex)
    && Object.keys(candidate.layout).sort().join()
      === Object.keys(expected.layout).sort().join()
    && isDeepStrictEqual(build.hookParams, baseline.hookParams)
    && isDeepStrictEqual(build.hookResults, baseline.hookResults)
    && isDeepStrictEqual(candidate.params, expected.params)
    && isDeepStrictEqual(candidate.results, expected.results)
    && isDigest(candidate.bodySha256)
    && isDeepStrictEqual(candidate.producerParams, expected.producerParams)
    && isDeepStrictEqual(candidate.producerResults, expected.producerResults)
    && isDeepStrictEqual(
      candidate.tableNeighbourBodySha256,
      expected.tableNeighbourBodySha256,
    )
    && candidate.layout.cursorSoftwareModel
      === candidate.layout.cursorActiveArt + 4
    && candidate.layout.cursorShowCount === candidate.layout.cursorActiveArt + 8
    && candidate.layout.cursorArtHotspot === expected.layout.cursorArtHotspot
    && candidate.layout.cursorArtTexture === expected.layout.cursorArtTexture
    && candidate.layout.cursorHandleKey === expected.layout.cursorHandleKey
    && candidate.layout.cursorHandleObject === expected.layout.cursorHandleObject
    && candidate.layout.cursorViewTexture === expected.layout.cursorViewTexture
    && candidate.layout.cursorTextureType === expected.layout.cursorTextureType
    && candidate.layout.cursorTextureWidth === expected.layout.cursorTextureWidth
    && candidate.layout.cursorTextureHeight === expected.layout.cursorTextureHeight;
}

function matchesObservationBase(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.observationBase?.layout;
  if (candidate === undefined) return true;
  const expected = baseline.observationBase?.layout;
  return expected !== undefined
    && Object.keys(candidate).sort().join() === Object.keys(expected).sort().join()
    && Object.values(candidate).every(isIndex)
    && candidate.contextRoot % 4 === 0
    && candidate.agentArray % 4 === 0
    && candidate.areaInfo % 4 === 0
    && Object.entries(expected).every(([key, value]) =>
      key === "contextRoot" || key === "agentArray" || key === "areaInfo"
        || candidate[key as keyof typeof candidate] === value);
}

function matchesPlayRegionObservation(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.playRegionObservation?.layout;
  if (candidate === undefined) return true;
  const expected = baseline.playRegionObservation?.layout;
  if (
    expected === undefined
    || Object.keys(candidate).sort().join() !== Object.keys(expected).sort().join()
    || !Object.values(candidate).every(isIndex)
    || Object.entries(expected).some(([key, value]) =>
      key !== "contextRoot" && key !== "areaInfo"
      && candidate[key as keyof typeof candidate] !== value)
  ) return false;
  const observation = build.observationBase?.layout;
  return observation === undefined || Object.entries(candidate).every(
    ([key, value]) => observation[key as keyof typeof observation] === value,
  );
}

function matchesTargetObservation(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.targetObservation?.layout;
  if (candidate === undefined) return true;
  const expected = baseline.targetObservation?.layout;
  const candidateObservation = build.observationBase?.layout;
  return matchesObservationBase(build, baseline)
    && expected !== undefined
    && candidateObservation !== undefined
    && Object.keys(candidate).sort().join() === Object.keys(expected).sort().join()
    && Object.values(candidate).every(isIndex)
    && candidate.manualTargetAgentId === candidate.automaticTargetAgentId + 4;
}

function matchesUiDispatcher(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.uiDispatcher;
  if (candidate === undefined) return true;
  const expected = baseline.uiDispatcher;
  return expected !== undefined
    && isIndex(candidate.functionIndex)
    && isDigest(candidate.bodySha256)
    && isDeepStrictEqual(candidate.params, expected.params)
    && isDeepStrictEqual(candidate.results, expected.results)
    && candidate.playerChatMessage === expected.playerChatMessage
    && candidate.hideHeroPanelMessage === expected.hideHeroPanelMessage
    && candidate.showHeroPanelMessage === expected.showHeroPanelMessage;
}

function matchesGameThreadSafePoint(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.gameThread?.drain;
  if (candidate === undefined) return true;
  const expected = baseline.gameThread?.drain;
  return expected !== undefined
    && isIndex(candidate.functionIndex)
    && isIndex(candidate.tableSlot)
    && isDigest(candidate.bodySha256)
    && isDeepStrictEqual(candidate.params, expected.params)
    && isDeepStrictEqual(candidate.results, expected.results);
}

function matchesTravelAction(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.travelAction;
  if (candidate === undefined) return true;
  const expected = baseline.travelAction;
  return expected !== undefined
    && candidate.enqueueExport === expected.enqueueExport
    && candidate.configureExport === expected.configureExport
    && candidate.toggleExport === expected.toggleExport
    && candidate.messageId === expected.messageId
    && isIndex(candidate.producer.functionIndex)
    && isDigest(candidate.producer.bodySha256)
    && isDeepStrictEqual(candidate.producer.params, expected.producer.params)
    && isDeepStrictEqual(candidate.producer.results, expected.producer.results)
    && isIndex(candidate.contextResolver.functionIndex)
    && isDigest(candidate.contextResolver.bodySha256)
    && isDeepStrictEqual(
      candidate.contextResolver.params,
      expected.contextResolver.params,
    )
    && isDeepStrictEqual(
      candidate.contextResolver.results,
      expected.contextResolver.results,
    )
    && isDeepStrictEqual(candidate.unlockProof.layout, expected.unlockProof.layout)
    && isIndex(candidate.unlockProof.accessor.functionIndex)
    && isDigest(candidate.unlockProof.accessor.bodySha256)
    && isDeepStrictEqual(
      candidate.unlockProof.accessor.params,
      expected.unlockProof.accessor.params,
    )
    && isDeepStrictEqual(
      candidate.unlockProof.accessor.results,
      expected.unlockProof.accessor.results,
    )
    && isIndex(candidate.unlockProof.consumer.functionIndex)
    && isDigest(candidate.unlockProof.consumer.bodySha256)
    && isDeepStrictEqual(
      candidate.unlockProof.consumer.params,
      expected.unlockProof.consumer.params,
    )
    && isDeepStrictEqual(
      candidate.unlockProof.consumer.results,
      expected.unlockProof.consumer.results,
    );
}

function matchesXunlaiAction(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.xunlaiAction;
  if (candidate === undefined) return true;
  const expected = baseline.xunlaiAction;
  const readers = candidate.accessProof?.readers;
  const expectedReaders = expected?.accessProof?.readers;
  const layout = candidate.accessProof?.layout;
  const expectedLayout = expected?.accessProof?.layout;
  return expected !== undefined
    && readers !== undefined
    && expectedReaders !== undefined
    && layout !== undefined
    && expectedLayout !== undefined
    && candidate.openExport === expected.openExport
    && candidate.configureExport === expected.configureExport
    && Object.keys(readers).sort().join() === Object.keys(expectedReaders).sort().join()
    && Object.entries(readers).every(([name, reader]) => {
      const expectedReader = expectedReaders[name as keyof typeof expectedReaders];
      return expectedReader !== undefined
        && isIndex(reader.functionIndex)
        && isDigest(reader.bodySha256)
        && isDeepStrictEqual(reader.params, expectedReader.params)
        && isDeepStrictEqual(reader.results, expectedReader.results);
    })
    && isDeepStrictEqual(layout, expectedLayout)
    && isIndex(candidate.handler.functionIndex)
    && isDigest(candidate.handler.bodySha256)
    && isDeepStrictEqual(candidate.handler.params, expected.handler.params)
    && isDeepStrictEqual(candidate.handler.results, expected.handler.results);
}

function matchesChatAliases(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.chatAliases?.parser;
  if (candidate === undefined) return true;
  const expected = baseline.chatAliases?.parser;
  return expected !== undefined
    && isIndex(candidate.functionIndex)
    && isDigest(candidate.bodySha256)
    && isDeepStrictEqual(candidate.params, expected.params)
    && isDeepStrictEqual(candidate.results, expected.results);
}

function matchesChatFiltering(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.chatFiltering;
  if (candidate === undefined) return true;
  const expected = baseline.chatFiltering;
  return expected !== undefined
    && isDeepStrictEqual(
      {
        ...candidate,
        producer: {
          ...candidate.producer,
          functionIndex: expected.producer.functionIndex,
          bodySha256: expected.producer.bodySha256,
        },
      },
      expected,
    )
    && isIndex(candidate.producer.functionIndex)
    && isDigest(candidate.producer.bodySha256);
}

function matchesPartyObservation(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.partyObservation;
  if (candidate === undefined) return true;
  const expected = baseline.partyObservation;
  return expected !== undefined
    && candidate.playerChatSites === 3
    && isIndex(candidate.playerChatProducer)
    && candidate.nearbyPlayerMessageProducers.length === 2
    && candidate.nearbyPlayerMessageProducers.every(isIndex)
    && isDeepStrictEqual(candidate.partyDirtyMessages, expected.partyDirtyMessages)
    && isDeepStrictEqual(candidate.nearbyPlayerMessages, expected.nearbyPlayerMessages)
    && isDeepStrictEqual(candidate.layout, expected.layout);
}

function matchesSkillSlotGeometry(build: SemanticBuild): boolean {
  return build.skillSlotGeometry === undefined
    || isSkillSlotGeometryProof(build.skillSlotGeometry);
}

function matchesTeamApply(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.teamApply;
  if (candidate === undefined) return true;
  const expected = baseline.teamApply;
  return expected !== undefined
    && candidate.thunkExport === expected.thunkExport
    && candidate.professionTrace.readerExport === expected.professionTrace.readerExport
    && isIndex(candidate.professionTrace.sender.functionIndex)
    && isDigest(candidate.professionTrace.sender.bodySha256)
    && isDeepStrictEqual(
      candidate.professionTrace.sender.params,
      expected.professionTrace.sender.params,
    )
    && isDeepStrictEqual(
      candidate.professionTrace.sender.results,
      expected.professionTrace.sender.results,
    )
    && candidate.entries.length === expected.entries.length
    && candidate.entries.every((entry, index) => {
      const expectedEntry = expected.entries[index];
      return expectedEntry !== undefined
        && entry.opcode === expectedEntry.opcode
        && entry.label === expectedEntry.label
        && isIndex(entry.functionIndex)
        && isDigest(entry.bodySha256)
        && isDeepStrictEqual(entry.params, expectedEntry.params)
        && isDeepStrictEqual(entry.results, expectedEntry.results);
    });
}

function matchesSkillCooldownObservation(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.skillCooldownObservation;
  if (candidate === undefined) return true;
  const expected = baseline.skillCooldownObservation;
  return expected !== undefined
    && isIndex(candidate.reader.functionIndex)
    && isIndex(candidate.reader.timerCallOperand)
    && isDigest(candidate.reader.bodySha256)
    && isDeepStrictEqual(candidate.reader.params, expected.reader.params)
    && isDeepStrictEqual(candidate.reader.results, expected.reader.results)
    && isIndex(candidate.timer.functionIndex)
    && isDigest(candidate.timer.bodySha256)
    && isDeepStrictEqual(candidate.timer.params, expected.timer.params)
    && isDeepStrictEqual(candidate.timer.results, expected.timer.results)
    && isDeepStrictEqual(candidate.layout, expected.layout);
}

function matchesPlayerEffectObservation(
  build: SemanticBuild,
): boolean {
  const candidate = build.playerEffectObservation;
  return candidate === undefined || isPlayerEffectObservationProof(candidate);
}

function matchesEffectIconGeometry(build: SemanticBuild): boolean {
  const candidate = build.effectIconGeometry;
  return candidate === undefined || isEffectIconGeometryProof(candidate);
}

function matchesPreGameControls(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.preGameControls;
  if (candidate === undefined) return true;
  const expected = baseline.preGameControls;
  return expected !== undefined
    && isIndex(candidate.hashFunction.functionIndex)
    && isDigest(candidate.hashFunction.bodySha256)
    && isDeepStrictEqual(candidate.hashFunction.params, expected.hashFunction.params)
    && isDeepStrictEqual(candidate.hashFunction.results, expected.hashFunction.results)
    && Object.values(candidate.labels).every(isIndex)
    && isDeepStrictEqual(candidate.labelHashes, expected.labelHashes)
    && Object.keys(candidate.layout).sort().join()
      === Object.keys(expected.layout).sort().join()
    && candidate.layout.frameCount === candidate.layout.frameArray + 8
    && candidate.layout.frameBytes === expected.layout.frameBytes
    && candidate.layout.frameId === expected.layout.frameId
    && candidate.layout.frameHashId === expected.layout.frameHashId
    && candidate.layout.frameState === expected.layout.frameState
    && candidate.layout.gameContextSlot === expected.layout.gameContextSlot
    && candidate.layout.characterContext === expected.layout.characterContext
    && candidate.layout.characterUuid === expected.layout.characterUuid
    && candidate.layout.currentInstanceType === expected.layout.currentInstanceType
    && isIndex(candidate.layout.contextRoot);
}

function matchesPlayerSkillbarObservation(
  build: SemanticBuild,
  baseline: KnownEnhancementBuild,
): boolean {
  const candidate = build.playerSkillbarObservation;
  const expected = baseline.playerSkillbarObservation;
  if (candidate === undefined) return true;
  if (expected === undefined) return false;
  const proof = (
    value: Readonly<{
      functionIndex: number;
      bodySha256: string;
      params: readonly string[];
      results: readonly string[];
    }>,
    reference: Readonly<{
      functionIndex: number;
      bodySha256: string;
      params: readonly string[];
      results: readonly string[];
    }>,
  ) => isIndex(value.functionIndex)
    && isDigest(value.bodySha256)
    && isDeepStrictEqual(value.params, reference.params)
    && isDeepStrictEqual(value.results, reference.results);
  return proof(candidate.worldLifecycle, expected.worldLifecycle)
    && proof(candidate.update, expected.update)
    && proof(candidate.rowReader, expected.rowReader)
    && proof(candidate.slotReader, expected.slotReader)
    && isDeepStrictEqual(candidate.coreLayout, expected.coreLayout)
    && isDeepStrictEqual(candidate.partyLayout, expected.partyLayout);
}

function isAutomaticSemanticBuild(
  value: unknown,
  inputSha256: string,
  requestedCapabilities: EnhancementCapabilities,
): value is KnownEnhancementBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<KnownEnhancementBuild>;
  if (
    build.sha256 !== inputSha256
    || !build.outputSha256
    || !isIndex(build.programId)
    || !isIndex(build.buildId)
    || !isIndex(build.hookFunction)
    || !isIndex(build.tableSlot)
    || !isDigest(build.hookBodySha256)
  ) return false;
  const hasCursor = build.cursorEvent !== undefined;
  const hasPlayRegion = build.playRegionObservation !== undefined;
  const hasObservation = build.observationBase !== undefined;
  const hasTarget = build.targetObservation !== undefined;
  const hasTravel = build.travelAction !== undefined;
  const hasXunlai = build.xunlaiAction !== undefined;
  const hasAliases = build.chatAliases !== undefined;
  const hasChatFiltering = build.chatFiltering !== undefined;
  const hasParty = build.partyObservation !== undefined;
  const hasTeam = build.teamApply !== undefined;
  const hasSkillSlotGeometry = build.skillSlotGeometry !== undefined;
  const hasPlayerSkillbar = build.playerSkillbarObservation !== undefined;
  const hasSkillCooldown = build.skillCooldownObservation !== undefined;
  const hasPreGameControls = build.preGameControls !== undefined;
  const hasPlayerEffects = build.playerEffectObservation !== undefined;
  const hasEffectIcons = build.effectIconGeometry !== undefined;
  if (!hasCursor && !hasPlayRegion && !hasObservation && !hasTarget
    && !hasTravel && !hasXunlai && !hasAliases && !hasChatFiltering
    && !hasParty && !hasTeam && !hasSkillSlotGeometry
    && !hasPlayerSkillbar && !hasSkillCooldown && !hasPreGameControls
    && !hasPlayerEffects && !hasEffectIcons) {
    return false;
  }
  if (
    Object.keys(build.outputSha256).length === 0
    || !Object.values(build.outputSha256).every(isDigest)
    || (hasTarget && !hasObservation)
    || (hasTravel && !hasObservation)
    || (hasXunlai && !hasObservation)
    || (hasPlayerSkillbar && !hasObservation)
    || (hasParty && (!hasObservation || !hasPlayerSkillbar
      || build.uiDispatcher === undefined))
    || (hasSkillCooldown && (!hasObservation || !hasPlayerSkillbar))
    || (hasPlayerEffects && (!hasObservation || !hasPlayRegion
      || build.uiDispatcher === undefined))
    || (hasEffectIcons && (!hasPlayRegion || !hasPlayerEffects))
    || (hasTeam && (!hasParty || build.gameThread === undefined))
    || ((hasTravel || hasXunlai) && build.gameThread === undefined)
    || ((hasTravel || hasXunlai || hasAliases) && build.uiDispatcher === undefined)
    || (hasChatFiltering
      && (!hasObservation || build.uiDispatcher === undefined))
  ) return false;
  const supported = supportedEnhancementCapabilities(build as KnownEnhancementBuild);
  const effective = intersectEnhancementCapabilities(
    requestedCapabilities,
    supported,
  );
  const expectedProfile = enhancementCapabilityProfile(effective);
  if (
    expectedProfile === null
    || Object.keys(build.outputSha256).length !== 1
    || !Object.hasOwn(build.outputSha256, expectedProfile)
  ) return false;
  if (!Object.keys(build.outputSha256).every((profile) => {
    const capabilities = enhancementCapabilitiesForProfile(profile);
    return capabilities !== null
      && enhancementCapabilitiesCover(supported, capabilities);
  })) return false;
  return ENHANCEMENT_BUILDS.some((baseline) =>
    matchesCoreProof(build, baseline)
    && matchesCursorProof(build, baseline)
    && matchesPlayRegionObservation(build, baseline)
    && matchesObservationBase(build, baseline)
    && matchesTargetObservation(build, baseline)
    && matchesUiDispatcher(build, baseline)
    && matchesGameThreadSafePoint(build, baseline)
    && matchesTravelAction(build, baseline)
    && matchesXunlaiAction(build, baseline)
    && matchesChatAliases(build, baseline)
    && matchesChatFiltering(build, baseline)
    && matchesPartyObservation(build, baseline)
    && matchesPlayerSkillbarObservation(build, baseline)
    && matchesTeamApply(build, baseline)
    && matchesSkillSlotGeometry(build)
    && matchesSkillCooldownObservation(build, baseline)
    && matchesPlayerEffectObservation(build)
    && matchesEffectIconGeometry(build)
    && matchesPreGameControls(build, baseline)
  );
}

/** Boundary check for utility-process messages. */
export function isLocalClientVerification(
  value: unknown,
  officialSha256: string,
  requestedCapabilities: EnhancementCapabilities = ENHANCEMENT_CAPABILITY_PRESETS.all,
): value is LocalClientVerification {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<LocalClientVerification>;
  if (
    !hasExactOwnKeys(value as Readonly<Record<string, unknown>>, [
      "status",
      "officialSha256",
      "verifierAbi",
      "fileVerdict",
      "templateSaveBuild",
      "enhancementBuild",
      "featureVerdicts",
      "reasons",
    ])
    || result.officialSha256 !== officialSha256
    || !isDigest(result.officialSha256)
    || result.verifierAbi !== SEMANTIC_VERIFIER_ABI
    || !Array.isArray(result.reasons)
    || !result.reasons.every((reason): reason is LocalVerificationReason =>
      typeof reason === "string"
      && (LOCAL_VERIFICATION_REASONS as readonly string[]).includes(reason)
    )
  ) {
    return false;
  }
  if (result.templateSaveBuild === null) {
    const featureVerdicts = result.featureVerdicts;
    if (featureVerdicts === null || featureVerdicts === undefined) {
      return result.status === "template-refused"
        && result.fileVerdict === null
        && result.enhancementBuild === null
        && result.reasons.length === 1
        && result.reasons[0] === "invalid-wasm";
    }
    if (!isLocalFileVerdict(result.fileVerdict, officialSha256, null)) {
      return false;
    }
    const enhancementBuild = result.enhancementBuild;
    if (
      enhancementBuild !== null
      && !isAutomaticSemanticBuild(
        enhancementBuild,
        officialSha256,
        requestedCapabilities,
      )
    ) return false;
    const featureFailures = featureFailuresFromVerdicts(featureVerdicts);
    if (
      featureFailures === null
      || !isDeepStrictEqual(
        featureVerdicts,
        localFeatureVerdictsForBuild(
          officialSha256,
          requestedCapabilities,
          enhancementBuild,
          featureFailures,
        ),
      )
    ) return false;
    if (!enhancementCapabilitiesRequested(requestedCapabilities)) {
      return result.status === "template-refused"
        && enhancementBuild === null
        && result.reasons.length === 1
        && isTemplateReason(result.reasons[0]);
    }
    return enhancementBuild === null
      ? result.status === "enhancement-refused"
        && result.reasons.length === 1
        && isEnhancementReason(result.reasons[0])
      : result.status === "proved" && result.reasons.length === 0;
  }
  if (!isTemplateSaveBuild(result.templateSaveBuild, officialSha256)) {
    return false;
  }
  if (!isLocalFileVerdict(
    result.fileVerdict,
    officialSha256,
    result.templateSaveBuild,
  )) return false;
  const inputSha256 = result.templateSaveBuild.outputSha256;
  const enhancementBuild = result.enhancementBuild;
  if (
    enhancementBuild !== null
    && !isAutomaticSemanticBuild(
      enhancementBuild,
      inputSha256,
      requestedCapabilities,
    )
  ) {
    return false;
  }
  const featureFailures = result.featureVerdicts
    ? featureFailuresFromVerdicts(result.featureVerdicts)
    : null;
  if (
    !result.featureVerdicts
    || featureFailures === null
    || !isDeepStrictEqual(
      result.featureVerdicts,
      localFeatureVerdictsForBuild(
        inputSha256,
        requestedCapabilities,
        enhancementBuild,
        featureFailures,
      ),
    )
  ) {
    return false;
  }
  if (!enhancementCapabilitiesRequested(requestedCapabilities)) {
    return result.status === "template-proved"
      && enhancementBuild === null
      && result.reasons.length === 0;
  }
  if (enhancementBuild === null) {
    return result.status === "enhancement-refused"
      && result.reasons.length === 1
      && isEnhancementReason(result.reasons[0]);
  }
  return result.status === "proved" && result.reasons.length === 0;
}
