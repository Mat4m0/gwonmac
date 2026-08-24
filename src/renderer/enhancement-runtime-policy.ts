/**
 * Computes the one fail-closed policy for optional observers, UI, and commands.
 * Saved product settings and explicit developer programs meet only here.
 */
import type { EnhancementProgram } from "../shared/enhancement-contracts.js";
import {
  featureActivationRequested,
  featureRegionAllowsRequest,
  type FeatureActivationSettings,
  type FeatureId,
} from "../shared/feature-contracts.js";

export type OptionalToolSettings = FeatureActivationSettings;

export type RuntimePlayRegion = "pve" | "pvp" | "unknown";
type RuntimeFeaturePolicy = Readonly<Record<FeatureId, boolean>>;

/** One fail-closed answer for optional observers, UI, and commands. */
export function enhancementRuntimePolicy(
  program: EnhancementProgram,
  settings: OptionalToolSettings,
  playRegion: RuntimePlayRegion,
): RuntimeFeaturePolicy {
  const requested = (id: FeatureId) =>
    featureActivationRequested(id, settings)
      && featureRegionAllowsRequest(id, playRegion);
  const developerToolbox = program === "toolbox-foundation"
    || program === "toolbox-commands"
    || program === "xunlai-storage";
  const developerTeam = program === "toolbox-commands";
  const developerStorage = program === "toolbox-commands"
    || program === "xunlai-storage";
  return Object.freeze({
    // The saved Build/Team library is local UI. It remains reachable at the
    // login screen, in PvP, and while live game observations are unavailable.
    tools: developerToolbox || requested("tools"),
    targetReadout: program === "target-observer"
      || requested("targetReadout"),
    teamApply: featureRegionAllowsRequest("teamApply", playRegion)
      && (developerTeam || requested("teamApply")),
    // The storage controller owns live access refusal and its user-facing
    // reason. This value means requested, not currently available.
    xunlaiStorage:
      developerStorage || requested("xunlaiStorage"),
    travel: featureRegionAllowsRequest("travel", playRegion)
      && (developerStorage || requested("travel")),
    skillKeyLabels: requested("skillKeyLabels"),
    skillCooldowns: requested("skillCooldowns"),
  } satisfies Record<FeatureId, boolean>);
}
