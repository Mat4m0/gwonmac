/**
 * Memory ownership and freshness boundary for the certified play-region fact.
 * All policy consumers share this one withdrawn-on-stale state.
 */
import {
  COMPANION_PLAY_REGION_BYTES,
  type CompanionPlayRegionState,
} from "./companion-play-region-snapshot.js";
import { createCompanionRegionInstallation } from "./companion-region-installation.js";
import { CONTINUOUS_COMPANION_FRESHNESS } from "./companion-sequence-feed.js";

export function createPlayRegionObservationInstallation(available: boolean) {
  const waiting = Object.freeze({ status: "waiting", reason: "memory" } as const);
  const stale = Object.freeze({ status: "waiting", reason: "stale" } as const);
  return createCompanionRegionInstallation<CompanionPlayRegionState>({
    available,
    name: "play region",
    bytes: COMPANION_PLAY_REGION_BYTES,
    waiting,
    stale,
    freshness: CONTINUOUS_COMPANION_FRESHNESS,
  });
}
