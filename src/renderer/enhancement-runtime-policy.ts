/**
 * Computes the one fail-closed policy for optional observers, UI, and commands.
 * Saved product settings and explicit developer programs meet only here.
 */
import type { EnhancementProgram } from "../shared/enhancement-contracts.js";

export type OptionalToolSettings = Readonly<{
  enabled: boolean;
  targetReadout: boolean;
  teamManagement: boolean;
  xunlaiStorage: boolean;
  travelPalette?: boolean;
}>;

export type RuntimePlayRegion = "pve" | "pvp" | "unknown";

/**
 * The game snapshot is the canonical region observation when that capability
 * exists. Party state is still required by commands, but it cannot re-enable
 * optional surfaces after a newer snapshot says PvP or unknown. Developer
 * Toolbox profiles have no snapshot observer, so their party is the fallback.
 */
export function runtimePlayRegion(
  snapshot: RuntimePlayRegion | null,
  party: RuntimePlayRegion,
): RuntimePlayRegion {
  return snapshot ?? party;
}

/** One fail-closed answer for optional observers, UI, and commands. */
export function enhancementRuntimePolicy(
  program: EnhancementProgram,
  settings: OptionalToolSettings,
  playRegion: RuntimePlayRegion,
) {
  const pve = playRegion === "pve";
  const developerToolbox = program === "toolbox-foundation"
    || program === "toolbox-commands"
    || program === "xunlai-storage";
  const developerTeam = program === "toolbox-commands";
  const developerStorage = program === "toolbox-commands"
    || program === "xunlai-storage";
  return Object.freeze({
    // The saved Build/Team library is local UI. It remains reachable at the
    // login screen, in PvP, and while live game observations are unavailable.
    tools: developerToolbox || settings.enabled,
    targetReadout: program === "target-observer"
      || (settings.enabled && settings.targetReadout && pve),
    teamManagement: pve && (
      developerTeam || (settings.enabled && settings.teamManagement)
    ),
    // The storage controller owns live access refusal and its user-facing
    // reason. This value means requested, not currently available.
    xunlaiStorage:
      developerStorage || (settings.enabled && settings.xunlaiStorage),
    travelPalette: pve && (
      developerStorage || (settings.enabled && settings.travelPalette === true)
    ),
  });
}
