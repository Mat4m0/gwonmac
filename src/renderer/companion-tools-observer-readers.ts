/**
 * Owns optional snapshot decoders used only by a Tools-capable observer. Core
 * supplies no readers and never imports these game-state implementations.
 */
export {
  readChangedCompanionParty,
  readChangedCompanionToolbox,
  readCompanionSnapshot,
  sameCompanionToolboxState,
} from "./companion-snapshot.js";
export {
  readCompanionSkillCooldowns,
  readCompanionSkillSlots,
} from "./companion-skill-snapshot.js";
export {
  readCompanionEffectIcons,
  readCompanionPlayerEffects,
} from "./companion-effect-snapshot.js";
