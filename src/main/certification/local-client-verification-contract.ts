/**
 * Typed result contract for the isolated local client verifier.
 *
 * Each feature carries only the facts it needs and binds those facts to the
 * exact post-template input and semantic-verifier ABI. This module constructs
 * values; the process-boundary module validates values received over IPC.
 */
import type { EnhancementCapabilities } from "../../shared/enhancement-contracts.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import type { KnownTemplateSaveBuild } from "./template-save-compat.js";
import {
  SEMANTIC_VERIFIER_ABI,
  type ProofVerdict,
} from "./semantic-proof.js";

export const LOCAL_VERIFICATION_REASONS = [
  "invalid-wasm",
  "template-shape-changed",
  "template-transform-failed",
  "enhancement-layout-changed",
  "enhancement-transform-failed",
] as const;

export type LocalVerificationReason = (typeof LOCAL_VERIFICATION_REASONS)[number];

export type TemplateVerificationReason = Extract<
  LocalVerificationReason,
  "invalid-wasm" | "template-shape-changed" | "template-transform-failed"
>;
export type EnhancementVerificationReason = Extract<
  LocalVerificationReason,
  "enhancement-layout-changed" | "enhancement-transform-failed"
>;

export const LOCAL_CLIENT_FEATURES = Object.freeze([
  "nativeCursor",
  "targetObservation",
  "partyObservation",
  "teamApply",
  "travelAction",
  "xunlaiAction",
  "chatAliases",
] as const satisfies readonly (keyof EnhancementCapabilities)[]);

export type LocalClientFeature = (typeof LOCAL_CLIENT_FEATURES)[number];

const SHARED_FEATURE_INVARIANTS = [
  "module.input-size",
  "module.wasm-validation",
  "module.binary-shape",
  "module.instruction-set",
  "module.analysis-budget",
  "hook.main-loop-export",
  "hook.main-loop-signature",
  "enhancement.output-profile",
  "enhancement.output-hash",
  "enhancement.transform",
] as const;

/** Closed, feature-owned refusal vocabulary accepted across process IPC. */
export const LOCAL_FEATURE_INVARIANTS = Object.freeze({
  nativeCursor: Object.freeze([
    ...SHARED_FEATURE_INVARIANTS,
    "cursor.event-owner",
    "cursor.active-table-relation",
    "cursor.event-family-layout-anchors",
  ] as const),
  targetObservation: Object.freeze([
    ...SHARED_FEATURE_INVARIANTS,
    "target.observation-selection-anchors",
    "target.shared-observation-layout",
  ] as const),
  partyObservation: Object.freeze([
    ...SHARED_FEATURE_INVARIANTS,
    "party.ui-dispatcher",
    "party.observation-anchors",
  ] as const),
  teamApply: Object.freeze([
    ...SHARED_FEATURE_INVARIANTS,
    "party.ui-dispatcher",
    "local.game-thread-safe-point",
    "team.party-observation-prerequisite",
    "team.packet-builder-anchors",
  ] as const),
  travelAction: Object.freeze([
    ...SHARED_FEATURE_INVARIANTS,
    "local.ui-dispatcher",
    "local.game-thread-safe-point",
    "travel.message-producer-anchor",
    "travel.current-context-resolver",
  ] as const),
  xunlaiAction: Object.freeze([
    ...SHARED_FEATURE_INVARIANTS,
    "local.ui-dispatcher",
    "local.game-thread-safe-point",
    "xunlai.data-window-anchors",
  ] as const),
  chatAliases: Object.freeze([
    ...SHARED_FEATURE_INVARIANTS,
    "local.ui-dispatcher",
    "chat.alias-parser-anchor",
  ] as const),
} as const satisfies Readonly<
  Record<LocalClientFeature, readonly string[]>
>);

export type LocalFeatureInvariant<Feature extends LocalClientFeature> =
  (typeof LOCAL_FEATURE_INVARIANTS)[Feature][number];

export type LocalFeatureFailure<Feature extends LocalClientFeature> =
  | Readonly<{
      status: "changed";
      invariant: LocalFeatureInvariant<Feature>;
    }>
  | Readonly<{
      status: "ambiguous";
      invariant: LocalFeatureInvariant<Feature>;
      candidates: number;
    }>;

export type LocalFeatureFailures = Readonly<{
  [Feature in LocalClientFeature]?: LocalFeatureFailure<Feature>;
}>;

type EnhancementProofCore = Readonly<Pick<KnownEnhancementBuild,
  | "sha256"
  | "programId"
  | "buildId"
  | "hookFunction"
  | "hookParams"
  | "hookResults"
  | "hookBodySha256"
  | "tableSlot"
>>;

type RequiredBuildFact<Key extends keyof KnownEnhancementBuild> = Readonly<{
  [Field in Key]-?: NonNullable<KnownEnhancementBuild[Field]>;
}>;
type CertifiedXunlaiAction = Readonly<
  Omit<NonNullable<KnownEnhancementBuild["xunlaiAction"]>, "accessProof">
  & {
    accessProof: NonNullable<
      NonNullable<KnownEnhancementBuild["xunlaiAction"]>["accessProof"]
    >;
  }
>;

export interface LocalFeatureCertificateMap {
  readonly nativeCursor: Readonly<{ core: EnhancementProofCore }>
    & RequiredBuildFact<"cursorEvent">;
  readonly targetObservation: Readonly<{ core: EnhancementProofCore }>
    & RequiredBuildFact<"observationBase" | "targetObservation">;
  readonly partyObservation: Readonly<{ core: EnhancementProofCore }>
    & RequiredBuildFact<"observationBase" | "uiDispatcher" | "partyObservation">;
  readonly teamApply: Readonly<{ core: EnhancementProofCore }>
    & RequiredBuildFact<
      | "observationBase"
      | "uiDispatcher"
      | "partyObservation"
      | "gameThread"
      | "teamApply"
    >;
  readonly travelAction: Readonly<{ core: EnhancementProofCore }>
    & RequiredBuildFact<"uiDispatcher" | "gameThread" | "travelAction">;
  readonly xunlaiAction: Readonly<{
    core: EnhancementProofCore;
    xunlaiAction: CertifiedXunlaiAction;
  }> & RequiredBuildFact<"observationBase" | "uiDispatcher" | "gameThread">;
  readonly chatAliases: Readonly<{ core: EnhancementProofCore }>
    & RequiredBuildFact<"uiDispatcher" | "chatAliases">;
}

export type LocalFeatureVerdict<Feature extends LocalClientFeature> =
  | ProofVerdict<LocalFeatureCertificateMap[Feature]>
  | Readonly<{
      status: "not-requested";
      inputSha256: string;
      verifierAbi: typeof SEMANTIC_VERIFIER_ABI;
    }>;

export type LocalFeatureVerdicts = Readonly<{
  [Feature in LocalClientFeature]: LocalFeatureVerdict<Feature>;
}>;

export const ALL_LOCAL_ENHANCEMENT_CAPABILITIES: EnhancementCapabilities =
  Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    teamApply: true,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  });

interface LocalVerificationBase {
  readonly officialSha256: string;
  readonly verifierAbi: typeof SEMANTIC_VERIFIER_ABI;
}

/** Invalid combinations are excluded before a result can cross the process boundary. */
export type LocalClientVerification =
  | (LocalVerificationBase & Readonly<{
      status: "template-refused";
      templateSaveBuild: null;
      enhancementBuild: null;
      featureVerdicts: null;
      reasons: readonly [TemplateVerificationReason];
    }>)
  | (LocalVerificationBase & Readonly<{
      status: "template-proved";
      templateSaveBuild: KnownTemplateSaveBuild;
      enhancementBuild: null;
      featureVerdicts: LocalFeatureVerdicts;
      reasons: readonly [];
    }>)
  | (LocalVerificationBase & Readonly<{
      status: "enhancement-refused";
      templateSaveBuild: KnownTemplateSaveBuild;
      enhancementBuild: null;
      featureVerdicts: LocalFeatureVerdicts;
      reasons: readonly [EnhancementVerificationReason];
    }>)
  | (LocalVerificationBase & Readonly<{
      status: "proved";
      templateSaveBuild: KnownTemplateSaveBuild;
      enhancementBuild: KnownEnhancementBuild;
      featureVerdicts: LocalFeatureVerdicts;
      reasons: readonly [];
    }>);

function enhancementProofCore(build: KnownEnhancementBuild): EnhancementProofCore {
  return Object.freeze({
    sha256: build.sha256,
    programId: build.programId,
    buildId: build.buildId,
    hookFunction: build.hookFunction,
    hookParams: build.hookParams,
    hookResults: build.hookResults,
    hookBodySha256: build.hookBodySha256,
    tableSlot: build.tableSlot,
  });
}

function featureVerdict<Feature extends LocalClientFeature>(
  inputSha256: string,
  requested: boolean,
  value: LocalFeatureCertificateMap[Feature] | null,
  failure: LocalFeatureFailure<Feature> | undefined,
  defaultInvariant: LocalFeatureInvariant<Feature>,
): LocalFeatureVerdict<Feature> {
  const binding = Object.freeze({
    inputSha256,
    verifierAbi: SEMANTIC_VERIFIER_ABI,
  });
  if (!requested) {
    return Object.freeze({ status: "not-requested", ...binding });
  }
  if (value !== null) return Object.freeze({ status: "proved", value, ...binding });
  const refusal = failure
    ?? Object.freeze({ status: "changed", invariant: defaultInvariant } as const);
  return refusal.status === "ambiguous"
    ? Object.freeze({
        status: refusal.status,
        invariant: refusal.invariant,
        candidates: refusal.candidates,
        ...binding,
      })
    : Object.freeze({
        status: refusal.status,
        invariant: refusal.invariant,
        ...binding,
      });
}

/** Canonical feature-local view of one derived build at the process boundary. */
export function localFeatureVerdictsForBuild(
  inputSha256: string,
  requested: EnhancementCapabilities,
  build: KnownEnhancementBuild | null,
  failures: LocalFeatureFailures = Object.freeze({}),
): LocalFeatureVerdicts {
  const core = build === null ? null : enhancementProofCore(build);
  const nativeCursor = core !== null && build?.cursorEvent !== undefined
    ? Object.freeze({ core, cursorEvent: build.cursorEvent })
    : null;
  const targetObservation = core !== null
      && build?.observationBase !== undefined
      && build.targetObservation !== undefined
    ? Object.freeze({
        core,
        observationBase: build.observationBase,
        targetObservation: build.targetObservation,
      })
    : null;
  const partyObservation = core !== null
      && build?.observationBase !== undefined
      && build.uiDispatcher !== undefined
      && build.partyObservation !== undefined
    ? Object.freeze({
        core,
        observationBase: build.observationBase,
        uiDispatcher: build.uiDispatcher,
        partyObservation: build.partyObservation,
      })
    : null;
  const teamApply = core !== null
      && build?.observationBase !== undefined
      && build.uiDispatcher !== undefined
      && build.partyObservation !== undefined
      && build.gameThread !== undefined
      && build.teamApply !== undefined
    ? Object.freeze({
        core,
        observationBase: build.observationBase,
        uiDispatcher: build.uiDispatcher,
        partyObservation: build.partyObservation,
        gameThread: build.gameThread,
        teamApply: build.teamApply,
      })
    : null;
  const travelAction = core !== null
      && build?.uiDispatcher !== undefined
      && build.gameThread !== undefined
      && build.travelAction !== undefined
    ? Object.freeze({
        core,
        uiDispatcher: build.uiDispatcher,
        gameThread: build.gameThread,
        travelAction: build.travelAction,
      })
    : null;
  const xunlaiAction = core !== null
      && build?.observationBase !== undefined
      && build.uiDispatcher !== undefined
      && build.gameThread !== undefined
      && build.xunlaiAction?.accessProof !== undefined
    ? Object.freeze({
        core,
        observationBase: build.observationBase,
        uiDispatcher: build.uiDispatcher,
        gameThread: build.gameThread,
        xunlaiAction: Object.freeze({
          ...build.xunlaiAction,
          accessProof: build.xunlaiAction.accessProof,
        }),
      })
    : null;
  const chatAliases = core !== null
      && build?.uiDispatcher !== undefined
      && build.chatAliases !== undefined
    ? Object.freeze({
        core,
        uiDispatcher: build.uiDispatcher,
        chatAliases: build.chatAliases,
      })
    : null;
  return Object.freeze({
    nativeCursor: featureVerdict<"nativeCursor">(
      inputSha256,
      requested.nativeCursor,
      nativeCursor,
      failures.nativeCursor,
      "cursor.event-family-layout-anchors",
    ),
    targetObservation: featureVerdict<"targetObservation">(
      inputSha256,
      requested.targetObservation,
      targetObservation,
      failures.targetObservation,
      "target.observation-selection-anchors",
    ),
    partyObservation: featureVerdict<"partyObservation">(
      inputSha256,
      requested.partyObservation,
      partyObservation,
      failures.partyObservation,
      "party.observation-anchors",
    ),
    teamApply: featureVerdict<"teamApply">(
      inputSha256,
      requested.teamApply,
      teamApply,
      failures.teamApply,
      "team.packet-builder-anchors",
    ),
    travelAction: featureVerdict<"travelAction">(
      inputSha256,
      requested.travelAction,
      travelAction,
      failures.travelAction,
      "travel.message-producer-anchor",
    ),
    xunlaiAction: featureVerdict<"xunlaiAction">(
      inputSha256,
      requested.xunlaiAction,
      xunlaiAction,
      failures.xunlaiAction,
      "xunlai.data-window-anchors",
    ),
    chatAliases: featureVerdict<"chatAliases">(
      inputSha256,
      requested.chatAliases,
      chatAliases,
      failures.chatAliases,
      "chat.alias-parser-anchor",
    ),
  });
}
