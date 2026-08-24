/**
 * Owns the fixed recharge snapshot region and its latest decoded diagnostic
 * state. Presentation is deliberately absent from this certification layer.
 */
import {
  COMPANION_SKILL_COOLDOWN_BYTES,
  type CompanionSkillCooldownState,
} from "./companion-skill-snapshot.js";
import {
  createCompanionRegionInstallation,
} from "./companion-region-installation.js";
import {
  CONTINUOUS_COMPANION_FRESHNESS,
  type CompanionSequenceFeedOptions,
} from "./companion-sequence-feed.js";
export function createSkillCooldownObservationInstallation(
  available: boolean,
  freshness: CompanionSequenceFeedOptions = CONTINUOUS_COMPANION_FRESHNESS,
) {
  const waiting = Object.freeze({
    status: "waiting",
    reason: "memory",
  } as const);
  const stale = Object.freeze({ status: "waiting", reason: "stale" } as const);
  return createCompanionRegionInstallation<CompanionSkillCooldownState>({
    available,
    name: "skill cooldowns",
    bytes: COMPANION_SKILL_COOLDOWN_BYTES,
    waiting,
    stale,
    freshness,
  });
}
