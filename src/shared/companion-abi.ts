/**
 * One source for every shared companion region size and wire version.
 * Renderer, scripts, and tests derive their ABI constants from this descriptor.
 */
export const COMPANION_ABI = Object.freeze({
  kernel: 13,
  config: Object.freeze({ bytes: 360 }),
  snapshot: Object.freeze({ abi: 2, bytes: 64 }),
  cursor: Object.freeze({ abi: 1, bytes: 4_160 }),
  toolbox: Object.freeze({ abi: 4, bytes: 64 }),
  party: Object.freeze({ abi: 7, bytes: 1_560 }),
});
