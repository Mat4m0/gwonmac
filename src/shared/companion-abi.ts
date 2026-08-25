/**
 * One source for every shared companion region size and wire version.
 * Renderer, scripts, and tests derive their ABI constants from this descriptor.
 */
export const COMPANION_ABI = Object.freeze({
  kernel: 18,
  config: Object.freeze({ bytes: 448 }),
  snapshot: Object.freeze({ abi: 4, bytes: 176 }),
  travelUnlockWords: 28,
  cursor: Object.freeze({ abi: 1, bytes: 4_160 }),
  toolbox: Object.freeze({ abi: 4, bytes: 64 }),
  party: Object.freeze({ abi: 7, bytes: 1_560 }),
  skillSlots: Object.freeze({ abi: 1, bytes: 156 }),
  skillCooldowns: Object.freeze({ abi: 1, bytes: 60 }),
  playRegion: Object.freeze({ abi: 1, bytes: 28 }),
});

export const COMPANION_FEATURE_BITS = Object.freeze({
  nativeCursor: 1 << 0,
  gameSnapshot: 1 << 1,
  toolboxFoundation: 1 << 2,
  targetObservation: 1 << 3,
  skillSlotGeometry: 1 << 4,
  skillCooldownObservation: 1 << 5,
  playRegionObservation: 1 << 6,
});

export const COMPANION_DISPATCH_KINDS = Object.freeze({
  tick: 0,
  cursor: 1,
  ui: 2,
  activeFeatures: 3,
});
