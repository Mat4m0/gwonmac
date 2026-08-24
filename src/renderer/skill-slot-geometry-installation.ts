/**
 * Owns the shared region and accepted-state feed for certified skill-slot
 * geometry. It has no knowledge of key labels or cooldown presentation.
 */
import {
  COMPANION_SKILL_SLOT_BYTES,
  type CompanionSkillSlotState,
} from "./companion-skill-snapshot.js";
import { createCompanionSequenceFeed } from "./companion-sequence-feed.js";

type Malloc = (bytes: number) => unknown;
type Free = (pointer: number) => void;

export function createSkillSlotGeometryInstallation(available: boolean) {
  let pointer = 0;
  const waiting = Object.freeze({ status: "waiting", reason: "memory" } as const);
  const stale = Object.freeze({ status: "waiting", reason: "stale" } as const);
  const feed = createCompanionSequenceFeed<CompanionSkillSlotState>(waiting, stale);

  return Object.freeze({
    available,
    get pointer() {
      return pointer;
    },
    get bytes() {
      return available ? COMPANION_SKILL_SLOT_BYTES : 0;
    },
    get allocated() {
      return !available || pointer !== 0;
    },
    get region() {
      return available
        ? Object.freeze({
            name: "skill slots",
            pointer,
            size: COMPANION_SKILL_SLOT_BYTES,
            align: 4,
          })
        : null;
    },
    get sink() {
      return available ? feed : null;
    },
    allocate(malloc: Malloc) {
      if (available && pointer === 0) {
        pointer = Number(malloc(COMPANION_SKILL_SLOT_BYTES));
      }
    },
    subscribe(listener: (state: CompanionSkillSlotState) => void) {
      return available ? feed.subscribe(listener) : () => false;
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
