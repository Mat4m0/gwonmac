/**
 * Strict process-boundary validation for ABI- and input-bound feature verdicts.
 * It rejects stale, malformed, and cross-input proof messages.
 */
import { isDeepStrictEqual } from "node:util";
import {
  enhancementCapabilityProfile,
  enhancementCapabilitiesForProfile,
  enhancementCapabilitiesRequested,
  intersectEnhancementCapabilities,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  ENHANCEMENT_BUILDS,
  supportedEnhancementCapabilities,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  ALL_LOCAL_ENHANCEMENT_CAPABILITIES,
  LOCAL_FEATURE_INVARIANTS,
  LOCAL_VERIFICATION_REASONS,
  localFeatureVerdictsForBuild,
  type EnhancementVerificationReason,
  type LocalClientFeature,
  type LocalClientVerification,
  type LocalFeatureFailure,
  type LocalFeatureFailures,
  type LocalFeatureInvariant,
  type LocalFeatureVerdicts,
  type LocalVerificationReason,
  type TemplateVerificationReason,
} from "./local-client-verification-contract.js";
import { SEMANTIC_VERIFIER_ABI } from "./semantic-proof.js";
import {
  BRIDGE_KINDS,
  TEMPLATE_SAVE_BUILDS,
  type BridgeKind,
  type KnownTemplateSaveBuild,
} from "./template-save-compat.js";

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

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
  const nativeCursor = refusalForFeature("nativeCursor", verdicts.nativeCursor);
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
  if (
    nativeCursor === null
    || targetObservation === null
    || partyObservation === null
    || teamApply === null
    || travelAction === null
    || xunlaiAction === null
    || chatAliases === null
  ) return null;
  return Object.freeze({
    ...(nativeCursor ? { nativeCursor } : {}),
    ...(targetObservation ? { targetObservation } : {}),
    ...(partyObservation ? { partyObservation } : {}),
    ...(teamApply ? { teamApply } : {}),
    ...(travelAction ? { travelAction } : {}),
    ...(xunlaiAction ? { xunlaiAction } : {}),
    ...(chatAliases ? { chatAliases } : {}),
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
  const hasObservation = build.observationBase !== undefined;
  const hasTarget = build.targetObservation !== undefined;
  const hasTravel = build.travelAction !== undefined;
  const hasXunlai = build.xunlaiAction !== undefined;
  const hasAliases = build.chatAliases !== undefined;
  const hasParty = build.partyObservation !== undefined;
  const hasTeam = build.teamApply !== undefined;
  if (!hasCursor && !hasTarget && !hasTravel && !hasXunlai && !hasAliases
    && !hasParty && !hasTeam) return false;
  if (
    Object.keys(build.outputSha256).length === 0
    || !Object.values(build.outputSha256).every(isDigest)
    || (hasTarget && !hasObservation)
    || (hasXunlai && !hasObservation)
    || (hasParty && (!hasObservation || build.uiDispatcher === undefined))
    || (hasTeam && (!hasParty || build.gameThread === undefined))
    || ((hasTravel || hasXunlai) && build.gameThread === undefined)
    || ((hasTravel || hasXunlai || hasAliases) && build.uiDispatcher === undefined)
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
      && (Object.keys(capabilities) as (keyof EnhancementCapabilities)[]).every(
        (feature) => !capabilities[feature] || supported[feature],
      );
  })) return false;
  return ENHANCEMENT_BUILDS.some((baseline) => {
    const coreMatches = build.programId === baseline.programId
      && sameJson(build.hookParams, baseline.hookParams)
      && sameJson(build.hookResults, baseline.hookResults);
    const cursor = baseline.cursorEvent;
    const cursorMatches = !hasCursor || (
      cursor !== undefined
      && build.cursorEvent !== undefined
      && isIndex(build.cursorEvent.functionIndex)
      && isIndex(build.cursorEvent.tableSlot)
      && build.cursorEvent.producerFunctions.length === 2
      && build.cursorEvent.producerFunctions.every(isIndex)
      && build.cursorEvent.producerBodySha256.length === 2
      && build.cursorEvent.producerBodySha256.every(isDigest)
      && Object.values(build.cursorEvent.layout).every(isIndex)
      && Object.keys(build.cursorEvent!.layout).sort().join()
        === Object.keys(cursor.layout).sort().join()
      && sameJson(build.hookParams, baseline.hookParams)
      && sameJson(build.hookResults, baseline.hookResults)
      && sameJson(build.cursorEvent?.params, cursor.params)
      && sameJson(build.cursorEvent?.results, cursor.results)
      && build.cursorEvent?.bodySha256 === cursor.bodySha256
      && sameJson(build.cursorEvent?.producerParams, cursor.producerParams)
      && sameJson(build.cursorEvent?.producerResults, cursor.producerResults)
      && sameJson(build.cursorEvent?.tableNeighbourBodySha256, cursor.tableNeighbourBodySha256)
      && build.cursorEvent.layout.cursorSoftwareModel
        === build.cursorEvent.layout.cursorActiveArt + 4
      && build.cursorEvent.layout.cursorShowCount
        === build.cursorEvent.layout.cursorActiveArt + 8
      && build.cursorEvent.layout.cursorArtHotspot === cursor.layout.cursorArtHotspot
      && build.cursorEvent.layout.cursorArtTexture === cursor.layout.cursorArtTexture
      && build.cursorEvent.layout.cursorHandleKey === cursor.layout.cursorHandleKey
      && build.cursorEvent.layout.cursorHandleObject === cursor.layout.cursorHandleObject
      && build.cursorEvent.layout.cursorViewTexture === cursor.layout.cursorViewTexture
      && build.cursorEvent.layout.cursorTextureType === cursor.layout.cursorTextureType
      && build.cursorEvent.layout.cursorTextureWidth === cursor.layout.cursorTextureWidth
      && build.cursorEvent.layout.cursorTextureHeight === cursor.layout.cursorTextureHeight
    );
    const observation = baseline.observationBase?.layout;
    const target = baseline.targetObservation?.layout;
    const candidateObservation = build.observationBase?.layout;
    const candidateTarget = build.targetObservation?.layout;
    const observationMatches = !hasObservation || (
      observation !== undefined
      && candidateObservation !== undefined
      && Object.keys(candidateObservation).sort().join()
        === Object.keys(observation).sort().join()
      && Object.values(candidateObservation).every(isIndex)
      && [
        candidateObservation.contextRoot - observation.contextRoot,
        candidateObservation.agentArray - observation.agentArray,
        candidateObservation.areaInfo - observation.areaInfo,
      ].every((delta, _index, deltas) => delta === deltas[0])
      && Object.entries(observation).every(([key, expected]) =>
        key === "contextRoot" || key === "agentArray" || key === "areaInfo"
          || candidateObservation[key as keyof typeof candidateObservation] === expected)
    );
    const targetMatches = !hasTarget || (
      observationMatches
      && target !== undefined
      && candidateTarget !== undefined
      && candidateObservation !== undefined
      && Object.keys(candidateTarget).sort().join()
        === Object.keys(target).sort().join()
      && Object.values(candidateTarget).every(isIndex)
      && candidateTarget.manualTargetAgentId
        === candidateTarget.automaticTargetAgentId + 4
      && [
        candidateTarget.manualTargetAgentId - target.manualTargetAgentId,
        candidateTarget.automaticTargetAgentId - target.automaticTargetAgentId,
        candidateObservation.contextRoot - observation!.contextRoot,
      ].every((delta, _index, deltas) => delta === deltas[0])
    );
    const ui = baseline.uiDispatcher;
    const gameThread = baseline.gameThread;
    const travel = baseline.travelAction;
    const xunlai = baseline.xunlaiAction;
    const aliases = baseline.chatAliases;
    const party = baseline.partyObservation;
    const team = baseline.teamApply;
    const uiMatches = build.uiDispatcher === undefined || (
      ui !== undefined
      && isIndex(build.uiDispatcher.functionIndex)
      && build.uiDispatcher.bodySha256 === ui.bodySha256
      && sameJson(build.uiDispatcher.params, ui.params)
      && sameJson(build.uiDispatcher.results, ui.results)
      && build.uiDispatcher.playerChatMessage === ui.playerChatMessage
      && build.uiDispatcher.hideHeroPanelMessage === ui.hideHeroPanelMessage
      && build.uiDispatcher.showHeroPanelMessage === ui.showHeroPanelMessage
    );
    const gameThreadMatches = build.gameThread === undefined || (
      gameThread !== undefined
      && isIndex(build.gameThread.drain.functionIndex)
      && isIndex(build.gameThread.drain.tableSlot)
      && isDigest(build.gameThread.drain.bodySha256)
      && sameJson(build.gameThread.drain.params, gameThread.drain.params)
      && sameJson(build.gameThread.drain.results, gameThread.drain.results)
    );
    const travelMatches = !hasTravel || (
      travel !== undefined
      && build.travelAction !== undefined
      && build.travelAction.enqueueExport === travel.enqueueExport
      && build.travelAction.configureExport === travel.configureExport
      && build.travelAction.toggleExport === travel.toggleExport
      && build.travelAction.messageId === travel.messageId
      && isIndex(build.travelAction.producer.functionIndex)
      && build.travelAction.producer.bodySha256 === travel.producer.bodySha256
      && sameJson(build.travelAction.producer.params, travel.producer.params)
      && sameJson(build.travelAction.producer.results, travel.producer.results)
      && isIndex(build.travelAction.contextResolver.functionIndex)
      && build.travelAction.contextResolver.bodySha256
        === travel.contextResolver.bodySha256
      && sameJson(
        build.travelAction.contextResolver.params,
        travel.contextResolver.params,
      )
      && sameJson(
        build.travelAction.contextResolver.results,
        travel.contextResolver.results,
      )
    );
    const readers = build.xunlaiAction?.accessProof?.readers;
    const baselineReaders = xunlai?.accessProof?.readers;
    const xunlaiLayout = build.xunlaiAction?.accessProof?.layout;
    const baselineXunlaiLayout = xunlai?.accessProof?.layout;
    const xunlaiMatches = !hasXunlai || (
      xunlai !== undefined
      && build.xunlaiAction !== undefined
      && readers !== undefined
      && baselineReaders !== undefined
      && xunlaiLayout !== undefined
      && baselineXunlaiLayout !== undefined
      && build.xunlaiAction.openExport === xunlai.openExport
      && build.xunlaiAction.configureExport === xunlai.configureExport
      && Object.keys(readers).sort().join() === Object.keys(baselineReaders).sort().join()
      && Object.entries(readers).every(([name, reader]) => {
        const expected = baselineReaders[name as keyof typeof baselineReaders];
        return expected !== undefined
          && isIndex(reader.functionIndex)
          && isDigest(reader.bodySha256)
          && sameJson(reader.params, expected.params)
          && sameJson(reader.results, expected.results);
      })
      && sameJson(xunlaiLayout, baselineXunlaiLayout)
      && isIndex(build.xunlaiAction.handler.functionIndex)
      && build.xunlaiAction.handler.bodySha256 === xunlai.handler.bodySha256
      && sameJson(build.xunlaiAction.handler.params, xunlai.handler.params)
      && sameJson(build.xunlaiAction.handler.results, xunlai.handler.results)
    );
    const aliasesMatches = !hasAliases || (
      aliases !== undefined
      && build.chatAliases !== undefined
      && isIndex(build.chatAliases.parser.functionIndex)
      && isDigest(build.chatAliases.parser.bodySha256)
      && sameJson(build.chatAliases.parser.params, aliases.parser.params)
      && sameJson(build.chatAliases.parser.results, aliases.parser.results)
    );
    const partyMatches = !hasParty || (
      party !== undefined
      && build.partyObservation !== undefined
      && build.partyObservation.playerChatSites === 3
      && isIndex(build.partyObservation.playerChatProducer)
      && build.partyObservation.nearbyPlayerMessageProducers.length === 2
      && build.partyObservation.nearbyPlayerMessageProducers.every(isIndex)
      && sameJson(build.partyObservation.partyDirtyMessages, party.partyDirtyMessages)
      && sameJson(build.partyObservation.nearbyPlayerMessages, party.nearbyPlayerMessages)
      && sameJson(build.partyObservation.layout, party.layout)
    );
    const teamMatches = !hasTeam || (
      team !== undefined
      && build.teamApply !== undefined
      && build.teamApply.thunkExport === team.thunkExport
      && build.teamApply.professionTrace.readerExport === team.professionTrace.readerExport
      && isIndex(build.teamApply.professionTrace.sender.functionIndex)
      && isDigest(build.teamApply.professionTrace.sender.bodySha256)
      && sameJson(
        build.teamApply.professionTrace.sender.params,
        team.professionTrace.sender.params,
      )
      && sameJson(
        build.teamApply.professionTrace.sender.results,
        team.professionTrace.sender.results,
      )
      && build.teamApply.entries.length === team.entries.length
      && build.teamApply.entries.every((entry, index) => {
        const expected = team.entries[index];
        return expected !== undefined
          && entry.opcode === expected.opcode
          && entry.label === expected.label
          && isIndex(entry.functionIndex)
          && isDigest(entry.bodySha256)
          && sameJson(entry.params, expected.params)
          && sameJson(entry.results, expected.results);
      })
    );
    return coreMatches && cursorMatches && observationMatches && targetMatches
      && uiMatches && gameThreadMatches && travelMatches
      && xunlaiMatches && aliasesMatches && partyMatches && teamMatches;
  });
}

/** Boundary check for utility-process messages. */
export function isLocalClientVerification(
  value: unknown,
  officialSha256: string,
  requestedCapabilities: EnhancementCapabilities = ALL_LOCAL_ENHANCEMENT_CAPABILITIES,
): value is LocalClientVerification {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<LocalClientVerification>;
  if (
    !hasExactOwnKeys(value as Readonly<Record<string, unknown>>, [
      "status",
      "officialSha256",
      "verifierAbi",
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
    return result.status === "template-refused"
      && result.enhancementBuild === null
      && result.featureVerdicts === null
      && result.reasons.length === 1
      && isTemplateReason(result.reasons[0]);
  }
  if (!isTemplateSaveBuild(result.templateSaveBuild, officialSha256)) {
    return false;
  }
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
