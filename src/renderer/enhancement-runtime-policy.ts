/**
 * Computes the one fail-closed policy for optional observers, UI, and commands.
 * Saved product settings and explicit developer programs meet only here.
 */
import type { EnhancementProgram } from "../shared/enhancement-contracts.js";
import {
  featureActivationRequested,
  featureRegionAllowsRequest,
  type FeatureActivationSettings,
} from "../shared/feature-contracts.js";

export type OptionalToolSettings = FeatureActivationSettings;

export type RuntimePlayRegion = "pve" | "pvp" | "unknown";

/** One fail-closed answer for optional observers, UI, and commands. */
export function enhancementRuntimePolicy(
  program: EnhancementProgram,
  settings: OptionalToolSettings,
  playRegion: RuntimePlayRegion,
) {
  const requested = (id: Parameters<typeof featureActivationRequested>[0]) =>
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
    teamManagement: featureRegionAllowsRequest("teamApply", playRegion)
      && (developerTeam || requested("teamApply")),
    // The storage controller owns live access refusal and its user-facing
    // reason. This value means requested, not currently available.
    xunlaiStorage:
      developerStorage || requested("xunlaiStorage"),
    travelPalette: featureRegionAllowsRequest("travel", playRegion)
      && (developerStorage || requested("travel")),
    skillSlotGeometry:
      requested("skillKeyLabels") || requested("skillCooldowns"),
    skillCooldownOverlay: requested("skillCooldowns"),
  });
}
