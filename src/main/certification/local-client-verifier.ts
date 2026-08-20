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
import {
  enhancementCapabilityProfile,
  enhancementCapabilitiesForProfile,
  enhancementCapabilitiesRequested,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  ENHANCEMENT_BUILDS,
  findEnhancementBuild,
  enhancementProfilesForBuild,
  supportedEnhancementCapabilities,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  locateAutomaticCursor,
  locateAutomaticLocalActions,
  locateAutomaticTarget,
} from "./enhancement-structural-evidence.js";
import { inspectEnhancementCandidate } from "./enhancement-candidate.js";
import { transformEnhancementWasm } from "./enhancement-transform.js";
import {
  BRIDGE_KINDS,
  TEMPLATE_SAVE_BUILDS,
  type BridgeKind,
  type KnownTemplateSaveBuild,
} from "./template-save-compat.js";
import {
  preparePostTemplateSaveModule,
  type PostTemplateSaveModule,
} from "./template-save-verifier.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

/**
 * Declared as a list rather than a union so the boundary check below and the
 * diagnostics schema can both execute it. A union nobody can enumerate gets
 * restated wherever it has to be checked, and the restatements drift.
 */
export const LOCAL_VERIFICATION_REASONS = [
  "invalid-wasm",
  "template-shape-changed",
  "template-transform-failed",
  "enhancement-layout-changed",
  "enhancement-transform-failed",
] as const;

export type LocalVerificationReason = (typeof LOCAL_VERIFICATION_REASONS)[number];

export interface LocalClientVerification {
  readonly officialSha256: string;
  readonly templateSaveBuild: KnownTemplateSaveBuild | null;
  readonly enhancementBuild: KnownEnhancementBuild | null;
  readonly reasons: readonly LocalVerificationReason[];
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deriveEnhancementBuild(
  official: Uint8Array,
  templateOutput: Uint8Array,
  requestedCapabilities: EnhancementCapabilities,
): KnownEnhancementBuild | null {
  const report = inspectEnhancementCandidate(templateOutput);
  if (!report.validWasm) return null;
  // A common address delta alone proves nothing. The isolated feature locators
  // below own their complete cursor, Target, and local-action evidence independently.
  const build = findEnhancementBuild(report.sha256);
  if (build) {
    const profile = enhancementProfilesForBuild(build)[0];
    if (!profile) return null;
    const capabilities = enhancementCapabilitiesForProfile(profile);
    if (!capabilities) return null;
    transformEnhancementWasm(templateOutput, build, capabilities);
    return build;
  }
  const locatedCursor = locateAutomaticCursor(templateOutput, ENHANCEMENT_BUILDS);
  const locatedTarget = locateAutomaticTarget(templateOutput, ENHANCEMENT_BUILDS);
  const locatedLocal = locateAutomaticLocalActions(templateOutput, ENHANCEMENT_BUILDS);
  if (
    (!locatedCursor && !locatedTarget && !locatedLocal)
    || !report.table || report.table.max === null
  ) {
    return null;
  }
  const baseline = locatedCursor?.baseline
    ?? locatedTarget?.baseline
    ?? locatedLocal!.baseline;
  const cursor = locatedCursor?.baseline.cursorEvent;
  if (locatedCursor && !cursor) return null;
  const provisional: KnownEnhancementBuild = Object.freeze({
    sha256: report.sha256,
    outputSha256: Object.freeze({}),
    programId: baseline.programId,
    buildId: Number.parseInt(sha256(official).slice(0, 8), 16) || 1,
    hookFunction: (locatedCursor ?? locatedTarget ?? locatedLocal)!.hookFunction,
    hookParams: Object.freeze(["i32"] as const),
    hookResults: Object.freeze([] as const),
    hookBodySha256: (locatedCursor ?? locatedTarget ?? locatedLocal)!.hookBodySha256,
    tableSlot: report.table.min,
    ...(locatedCursor && cursor ? {
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
    ...(locatedTarget || locatedLocal?.observationLayout ? {
      observationBase: Object.freeze({
        layout: locatedTarget?.observationLayout ?? locatedLocal!.observationLayout!,
      }),
    } : {}),
    ...(locatedTarget ? {
      targetObservation: Object.freeze({ layout: locatedTarget.targetLayout }),
    } : {}),
    ...(locatedLocal?.uiDispatcher ? { uiDispatcher: locatedLocal.uiDispatcher } : {}),
    ...(locatedLocal?.gameThread ? { gameThread: locatedLocal.gameThread } : {}),
    ...(locatedLocal?.travelAction ? { travelAction: locatedLocal.travelAction } : {}),
    ...(locatedLocal?.xunlaiAction ? { xunlaiAction: locatedLocal.xunlaiAction } : {}),
    ...(locatedLocal?.chatAliases ? { chatAliases: locatedLocal.chatAliases } : {}),
    ...(locatedLocal?.partyObservation ? {
      partyObservation: locatedLocal.partyObservation,
    } : {}),
    ...(locatedLocal?.teamApply ? { teamApply: locatedLocal.teamApply } : {}),
  });
  const maximum: EnhancementCapabilities = Object.freeze({
    nativeCursor: locatedCursor !== null,
    targetObservation: locatedTarget !== null,
    partyObservation: locatedLocal?.partyObservation !== null
      && locatedLocal?.partyObservation !== undefined,
    teamApply: locatedLocal?.teamApply !== null
      && locatedLocal?.teamApply !== undefined,
    travelAction: locatedLocal?.travelAction !== null && locatedLocal?.travelAction !== undefined,
    xunlaiAction: locatedLocal?.xunlaiAction !== null && locatedLocal?.xunlaiAction !== undefined,
    chatAliases: locatedLocal?.chatAliases !== null && locatedLocal?.chatAliases !== undefined,
  });
  const effective: EnhancementCapabilities = Object.freeze({
    nativeCursor: requestedCapabilities.nativeCursor && maximum.nativeCursor,
    targetObservation:
      requestedCapabilities.targetObservation && maximum.targetObservation,
    partyObservation:
      requestedCapabilities.partyObservation && maximum.partyObservation,
    teamApply: requestedCapabilities.teamApply
      && maximum.teamApply && maximum.partyObservation,
    travelAction: requestedCapabilities.travelAction && maximum.travelAction,
    xunlaiAction: requestedCapabilities.xunlaiAction && maximum.xunlaiAction,
    chatAliases: requestedCapabilities.chatAliases && maximum.chatAliases,
  });
  const profile = enhancementCapabilityProfile(effective);
  if (profile === null || !enhancementCapabilitiesRequested(effective)) return null;
  const outputSha256 = Object.freeze({
    [profile]: sha256(transformEnhancementWasm(
      templateOutput,
      provisional,
      effective,
    )),
  });
  return Object.freeze({
    ...provisional,
    outputSha256: Object.freeze(outputSha256),
  });
}

/**
 * Pure verifier entry point. It reads no profile state and performs no writes;
 * the utility-process host supplies the exact official bytes.
 */
export function verifyLocalClientBytes(
  official: Uint8Array,
  requestedCapabilities: EnhancementCapabilities = Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    teamApply: true,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
): LocalClientVerification {
  const officialSha256 = sha256(official);
  const reasons: LocalVerificationReason[] = [];
  const base = { officialSha256 };
  if (!WebAssembly.validate(official)) {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["invalid-wasm"],
    };
  }

  let postTemplate: PostTemplateSaveModule | null;
  try {
    postTemplate = preparePostTemplateSaveModule(official);
  } catch {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["template-transform-failed"],
    };
  }
  if (!postTemplate) {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["template-shape-changed"],
    };
  }

  const templateSaveBuild = postTemplate.build;
  const templateOutput = postTemplate.bytes;

  let enhancementBuild: KnownEnhancementBuild | null = null;
  try {
    enhancementBuild = deriveEnhancementBuild(
      official,
      templateOutput,
      requestedCapabilities,
    );
    if (!enhancementBuild) reasons.push("enhancement-layout-changed");
  } catch {
    reasons.push("enhancement-transform-failed");
  }
  return {
    ...base,
    templateSaveBuild,
    enhancementBuild,
    reasons,
  };
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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

function isExactEnhancementBuild(
  value: unknown,
  inputSha256: string,
): value is KnownEnhancementBuild {
  const exact = findEnhancementBuild(inputSha256);
  return exact !== null && sameJson(value, exact);
}

function isAutomaticSemanticBuild(
  value: unknown,
  inputSha256: string,
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
  if (!Object.keys(build.outputSha256).every((profile) => {
    const capabilities = enhancementCapabilitiesForProfile(profile);
    return capabilities !== null
      && (Object.keys(capabilities) as (keyof EnhancementCapabilities)[]).every(
        (feature) => !capabilities[feature] || supported[feature],
      );
  })) return false;
  return ENHANCEMENT_BUILDS.some((baseline) => {
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
    return cursorMatches && observationMatches && targetMatches
      && uiMatches && gameThreadMatches && travelMatches
      && xunlaiMatches && aliasesMatches && partyMatches && teamMatches;
  });
}

/**
 * Boundary check for utility-process messages. Production transforms still
 * re-check every body/callsite before use.
 */
export function isLocalClientVerification(
  value: unknown,
  officialSha256: string,
): value is LocalClientVerification {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<LocalClientVerification>;
  if (
    result.officialSha256 !== officialSha256
    || !isDigest(result.officialSha256)
    || !Array.isArray(result.reasons)
    || !result.reasons.every((reason): reason is LocalVerificationReason =>
      typeof reason === "string"
      && (LOCAL_VERIFICATION_REASONS as readonly string[]).includes(reason)
    )
  ) {
    return false;
  }
  if (result.templateSaveBuild === null) {
    return result.enhancementBuild === null
      && result.reasons.some((reason) =>
        reason === "invalid-wasm"
        || reason === "template-shape-changed"
        || reason === "template-transform-failed"
      );
  }
  if (!isTemplateSaveBuild(result.templateSaveBuild, officialSha256)) {
    return false;
  }
  if (result.enhancementBuild === null) {
    return result.reasons.some((reason) =>
      reason === "enhancement-layout-changed"
      || reason === "enhancement-transform-failed"
    );
  }
  return result.reasons.length === 0
    && (
      isExactEnhancementBuild(
        result.enhancementBuild,
        result.templateSaveBuild.outputSha256,
      )
      || isAutomaticSemanticBuild(
        result.enhancementBuild,
        result.templateSaveBuild.outputSha256,
      )
    );
}
