/**
 * One source for every shared companion region size and wire version.
 * Renderer, scripts, and tests derive their ABI constants from this descriptor.
 */
export const COMPANION_ABI = Object.freeze({
  kernel: 21,
  config: Object.freeze({ bytes: 464 }),
  snapshot: Object.freeze({ abi: 4, bytes: 64 }),
  travelUnlockWords: 28,
  cursor: Object.freeze({ abi: 1, bytes: 4_160 }),
  toolbox: Object.freeze({ abi: 4, bytes: 64 }),
  party: Object.freeze({ abi: 7, bytes: 1_560 }),
  skillSlots: Object.freeze({ abi: 2, bytes: 164 }),
  skillCooldowns: Object.freeze({ abi: 1, bytes: 60 }),
  playRegion: Object.freeze({ abi: 3, bytes: 148 }),
  characterList: Object.freeze({ abi: 2, bytes: 4_632, slots: 64, nameUnits: 20 }),
});

export const COMPANION_FEATURE_BITS = Object.freeze({
  nativeCursor: 1 << 0,
  gameSnapshot: 1 << 1,
  toolboxFoundation: 1 << 2,
  targetObservation: 1 << 3,
  skillSlotGeometry: 1 << 4,
  skillCooldownObservation: 1 << 5,
  playRegionObservation: 1 << 6,
  characterList: 1 << 7,
});

export const COMPANION_DISPATCH_KINDS = Object.freeze({
  tick: 0,
  cursor: 1,
  ui: 2,
  activeFeatures: 3,
});

export const SKILL_GEOMETRY_NATIVE_REASONS = Object.freeze({
  1: "inactive",
  2: "invalid-input",
  3: "frame-table",
  4: "parent-missing",
  5: "parent-hidden",
  6: "slot-missing",
  7: "slot-ambiguous",
  8: "slot-relation",
  9: "slot-hidden",
  10: "viewport-invalid",
  11: "slot-nonfinite",
  12: "slot-order",
  13: "slot-outside-viewport",
  14: "viewport-mismatch",
} as const);

export type SkillGeometryNativeReason =
  (typeof SKILL_GEOMETRY_NATIVE_REASONS)[keyof typeof SKILL_GEOMETRY_NATIVE_REASONS];
