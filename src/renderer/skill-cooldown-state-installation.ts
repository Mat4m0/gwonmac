/**
 * Owns the fixed recharge snapshot region and its latest decoded diagnostic
 * state. Presentation is deliberately absent from this certification layer.
 */
import {
  COMPANION_SKILL_COOLDOWN_BYTES,
  type CompanionSkillCooldownState,
} from "./companion-skill-snapshot.js";
import {
  createCompanionSequenceFeed,
  type CompanionSequenceFeedOptions,
} from "./companion-sequence-feed.js";

type Malloc = (bytes: number) => unknown;
type Free = (pointer: number) => void;
export type SkillCooldownObservationState = CompanionSkillCooldownState;

export function createSkillCooldownObservationInstallation(
  available: boolean,
  freshness: CompanionSequenceFeedOptions = {},
) {
  let pointer = 0;
  const waiting = Object.freeze({
    status: "waiting",
    reason: "memory",
  } as const);
  const stale = Object.freeze({ status: "waiting", reason: "stale" } as const);
  const feed = createCompanionSequenceFeed<CompanionSkillCooldownState>(
    waiting,
    stale,
    freshness,
  );
  return Object.freeze({
    available,
    get pointer() { return pointer; },
    get bytes() { return available ? COMPANION_SKILL_COOLDOWN_BYTES : 0; },
    get allocated() { return !available || pointer !== 0; },
    get state() { return feed.state; },
    get region() {
      return available
        ? Object.freeze({
            name: "skill cooldowns",
            pointer,
            size: COMPANION_SKILL_COOLDOWN_BYTES,
            align: 4,
          })
        : null;
    },
    get sink() {
      return available ? feed : null;
    },
    subscribe(listener: (state: CompanionSkillCooldownState) => void) {
      return available ? feed.subscribe(listener) : () => false;
    },
    allocate(malloc: Malloc) {
      if (available && pointer === 0) {
        pointer = Number(malloc(COMPANION_SKILL_COOLDOWN_BYTES));
      }
    },
    release(free: Free) {
      if (pointer !== 0) free(pointer);
      pointer = 0;
      feed.reset();
    },
    dispose() {
      feed.dispose();
    },
  });
}
