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
  const developerToolbox = program === "toolbox-foundation"
    || program === "toolbox-commands"
    || program === "xunlai-storage";
  const developerTeam = program === "toolbox-commands";
  const developerStorage = program === "toolbox-commands"
    || program === "xunlai-storage";
  const selected = (id: FeatureId, developerSelected = false) =>
    featureRegionAllowsRequest(id, playRegion)
      && (developerSelected || featureActivationRequested(id, settings));
  return Object.freeze({
    characterSwitch: selected("characterSwitch"),
    cartography: selected("cartography"),
    // The local Tools host remains reachable without a live observation, but
    // withdraws when the certified region reports active PvP play.
    tools: selected("tools", developerToolbox),
    buildLibrary: selected("buildLibrary", developerToolbox),
    tradeChat: selected("tradeChat", developerToolbox),
    targetReadout: selected(
      "targetReadout",
      program === "target-observer",
    ),
    teamApply: selected("teamApply", developerTeam),
    // The storage controller owns live access refusal and its user-facing
    // reason. This value means requested, not currently available.
    xunlaiStorage: selected("xunlaiStorage", developerStorage),
    travel: selected("travel", developerStorage),
    skillKeyLabels: selected("skillKeyLabels"),
    skillCooldowns: selected("skillCooldowns"),
    quickItemMove: selected("quickItemMove"),
  } satisfies Record<FeatureId, boolean>);
}
