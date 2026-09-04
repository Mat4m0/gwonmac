/**
 * Owns the fixed controlled-player effect snapshot region and its accepted
 * diagnostic state. Presentation is intentionally outside this layer.
 */
import {
  COMPANION_PLAYER_EFFECT_BYTES,
  type CompanionPlayerEffectState,
} from "./companion-effect-snapshot.js";
import {
  createCompanionRegionInstallation,
} from "./companion-region-installation.js";
import {
  CONTINUOUS_COMPANION_FRESHNESS,
  type CompanionSequenceFeedOptions,
} from "./companion-sequence-feed.js";

export function createPlayerEffectObservationInstallation(
  available: boolean,
  freshness: CompanionSequenceFeedOptions = CONTINUOUS_COMPANION_FRESHNESS,
) {
  const waiting = Object.freeze({
    status: "waiting",
    reason: "memory",
  } as const);
  const stale = Object.freeze({ status: "waiting", reason: "stale" } as const);
  return createCompanionRegionInstallation<CompanionPlayerEffectState>({
    available,
    name: "player effects",
    bytes: COMPANION_PLAYER_EFFECT_BYTES,
    waiting,
    stale,
    freshness,
  });
}
