/**
 * Computes the one fail-closed policy for optional observers, UI, and commands.
 * Saved product settings and explicit developer programs meet only here.
 */
import type { EnhancementProgram } from "../shared/enhancement-contracts.js";

export type OptionalToolSettings = Readonly<{
  enabled: boolean;
  targetReadout: boolean;
  teamManagement: boolean;
}>;

export type RuntimePlayRegion = "pve" | "pvp" | "unknown";

/** One fail-closed answer for optional observers, UI, and commands. */
export function enhancementRuntimePolicy(
  program: EnhancementProgram,
  settings: OptionalToolSettings,
  playRegion: RuntimePlayRegion,
) {
  const pve = playRegion === "pve";
  const developerToolbox = program === "toolbox-foundation"
    || program === "toolbox-commands";
  return Object.freeze({
    targetReadout: program === "target-observer"
      || (settings.enabled && settings.targetReadout && pve),
    teamManagement: pve && (
      developerToolbox || (settings.enabled && settings.teamManagement)
    ),
  });
}
