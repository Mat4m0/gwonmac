/**
 * Owns the shared region and accepted-state feed for certified skill-slot
 * geometry. It has no knowledge of key labels or cooldown presentation.
 */
import {
  COMPANION_SKILL_SLOT_BYTES,
  type CompanionSkillSlotState,
} from "./companion-skill-snapshot.js";
import { createCompanionRegionInstallation } from "./companion-region-installation.js";
import { CONTINUOUS_COMPANION_FRESHNESS } from "./companion-sequence-feed.js";

export function createSkillSlotGeometryInstallation(available: boolean) {
  const waiting = Object.freeze({ status: "waiting", reason: "memory" } as const);
  const stale = Object.freeze({ status: "waiting", reason: "stale" } as const);
  return createCompanionRegionInstallation<CompanionSkillSlotState>({
    available,
    name: "skill slots",
    bytes: COMPANION_SKILL_SLOT_BYTES,
    waiting,
    stale,
    freshness: CONTINUOUS_COMPANION_FRESHNESS,
  });
}
