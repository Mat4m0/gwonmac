/**
 * Skillbar-only slice of local client verification.
 *
 * It owns the geometry, player-row, and recharge proof relationship plus their
 * feature-local diagnostics and build fragment. Shared module evidence and
 * cross-domain observation-layout agreement remain with the root verifier.
 */
import type { EnhancementCapabilities } from "../../shared/enhancement-contracts.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import {
  derivePlayerSkillbarObservation,
  playerSkillbarRoleCandidateCounts,
} from "./enhancement-player-skillbar-proof.js";
import { deriveSkillCooldownObservation } from "./enhancement-skill-cooldown-proof.js";
import { deriveSkillSlotGeometry } from "./enhancement-skill-slot-geometry-proof.js";
import { deriveObservationLayout } from "./enhancement-target-proof.js";
import type {
  LocalFeatureFailure,
  LocalFeatureFailures,
} from "./local-client-verification-contract.js";
import type { EnhancementProofContext } from "./wasm-evidence.js";

type SkillbarBuildFragment = Partial<Pick<KnownEnhancementBuild,
  | "playerSkillbarObservation"
  | "skillSlotGeometry"
  | "skillCooldownObservation"
>>;

type LocalSkillbarBuildFragments = Readonly<{
  beforeTeam: Pick<SkillbarBuildFragment, "playerSkillbarObservation">;
  afterTeam: Omit<SkillbarBuildFragment, "playerSkillbarObservation">;
}>;

function includedProof<T>(included: boolean, proof: T | null): T | null | undefined {
  return included ? proof : undefined;
}

export type LocalSkillbarProofs = Readonly<{
  requestedGeometry: boolean;
  requestedCooldown: boolean;
  playerSkillbar:
    NonNullable<KnownEnhancementBuild["playerSkillbarObservation"]> | null;
  cooldownObservationLayout: ReturnType<typeof deriveObservationLayout>;
  geometry: ReturnType<typeof deriveSkillSlotGeometry>;
  cooldown: ReturnType<typeof deriveSkillCooldownObservation>;
  includeGeometry: boolean;
  includeCooldown: boolean;
  needsStructuralEvidence: boolean;
  ambiguousPlayerSkillbarCandidates?: number;
}>;

export function deriveLocalSkillbarProofs(
  requested: EnhancementCapabilities,
  context: EnhancementProofContext,
  playRegionAvailable: boolean,
): LocalSkillbarProofs {
  const module = context.moduleView();
  const playerSkillbar = requested.partyObservation
      || requested.skillCooldownObservation
    ? derivePlayerSkillbarObservation(module)
    : null;
  const cooldownObservationLayout = requested.skillCooldownObservation
    ? deriveObservationLayout(module)
    : null;
  const geometry = requested.skillSlotGeometry
    ? deriveSkillSlotGeometry(context)
    : null;
  const cooldown = requested.skillCooldownObservation
    ? deriveSkillCooldownObservation(context, playerSkillbar)
    : null;
  const includeGeometry = requested.skillSlotGeometry
    && playRegionAvailable
    && geometry !== null;
  const includeCooldown = requested.skillCooldownObservation
    && playRegionAvailable
    && cooldownObservationLayout !== null
    && playerSkillbar !== null
    && cooldown !== null;
  const needsGeometryEvidence = requested.skillSlotGeometry && geometry === null;
  const needsCooldownEvidence = requested.skillCooldownObservation
    && (cooldownObservationLayout === null
      || playerSkillbar === null
      || cooldown === null);
  const ambiguousPlayerSkillbarCandidates = needsCooldownEvidence
      && playerSkillbar === null
    ? playerSkillbarRoleCandidateCounts(module).find((count) => count > 1)
    : undefined;
  return Object.freeze({
    requestedGeometry: requested.skillSlotGeometry,
    requestedCooldown: requested.skillCooldownObservation,
    playerSkillbar,
    cooldownObservationLayout,
    geometry,
    cooldown,
    includeGeometry,
    includeCooldown,
    needsStructuralEvidence: needsGeometryEvidence || needsCooldownEvidence,
    ...(ambiguousPlayerSkillbarCandidates === undefined
      ? {}
      : { ambiguousPlayerSkillbarCandidates }),
  });
}

type SharedSkillbarFailures = Readonly<{
  skillSlotGeometry: LocalFeatureFailure<"skillSlotGeometry"> | null;
  skillCooldownObservation:
    LocalFeatureFailure<"skillCooldownObservation"> | null;
}>;

export function diagnoseLocalSkillbarFailures(
  proofs: LocalSkillbarProofs,
  shared: SharedSkillbarFailures,
): LocalFeatureFailures {
  const needsGeometryEvidence = proofs.requestedGeometry && proofs.geometry === null;
  const needsCooldownEvidence = proofs.requestedCooldown
    && (proofs.cooldownObservationLayout === null
      || proofs.playerSkillbar === null
      || proofs.cooldown === null);
  return Object.freeze({
    ...(needsGeometryEvidence
      ? {
          skillSlotGeometry: shared.skillSlotGeometry ?? Object.freeze({
            status: "changed" as const,
            invariant: "skill-slots.frame-constructor" as const,
          }),
        }
      : {}),
    ...(needsCooldownEvidence
      ? {
          skillCooldownObservation: shared.skillCooldownObservation
            ?? (proofs.ambiguousPlayerSkillbarCandidates === undefined
              ? null
              : Object.freeze({
                  status: "ambiguous" as const,
                  invariant: "skill-cooldown.player-skillbar" as const,
                  candidates: proofs.ambiguousPlayerSkillbarCandidates,
                }))
            ?? Object.freeze({
              status: "changed" as const,
              invariant: proofs.cooldownObservationLayout === null
                ? "skill-cooldown.observation-base" as const
                : proofs.playerSkillbar === null
                  ? "skill-cooldown.player-skillbar" as const
                  : "skill-cooldown.recharge-reader" as const,
            }),
        }
      : {}),
  });
}

export function localSkillbarBuildFragment(
  proofs: LocalSkillbarProofs,
  includeParty: boolean,
): LocalSkillbarBuildFragments | null {
  const playerSkillbar = includedProof(
    includeParty || proofs.includeCooldown,
    proofs.playerSkillbar,
  );
  const geometry = includedProof(proofs.includeGeometry, proofs.geometry);
  const cooldown = includedProof(proofs.includeCooldown, proofs.cooldown);
  if (playerSkillbar === null || geometry === null || cooldown === null) return null;

  return Object.freeze({
    beforeTeam: Object.freeze({
      ...(playerSkillbar === undefined
        ? {}
        : { playerSkillbarObservation: playerSkillbar }),
    }),
    afterTeam: Object.freeze({
      ...(geometry === undefined ? {} : { skillSlotGeometry: geometry }),
      ...(cooldown === undefined ? {} : { skillCooldownObservation: cooldown }),
    }),
  });
}
