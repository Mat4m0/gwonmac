/**
 * Decodes only the normalized, sequence-protected alcohol countdown.
 * Invalid or stale publications withdraw the readout instead of retaining it.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";
import { createCompanionRegionInstallation } from "./companion-region-installation.js";
import { CONTINUOUS_COMPANION_FRESHNESS } from "./companion-sequence-feed.js";
export type AlcoholState = Readonly<{ status: "waiting" }> | Readonly<{
  status: "ready"; sequence: number; gameTimer: number; remainingMs: number;
}>;
export function readCompanionAlcohol(buffer: ArrayBuffer, pointer: number): AlcoholState {
  const waiting = Object.freeze({ status: "waiting" } as const);
  if (!Number.isInteger(pointer) || pointer <= 0 || pointer % 4 !== 0
    || pointer + COMPANION_ABI.alcohol.bytes > buffer.byteLength) return waiting;
  const v = new DataView(buffer, pointer, COMPANION_ABI.alcohol.bytes);
  const sequence = v.getUint32(8, true);
  if (sequence & 1 || v.getUint32(0, true) !== 0x414c5747
    || v.getUint16(4, true) !== COMPANION_ABI.alcohol.abi
    || v.getUint16(6, true) !== COMPANION_ABI.alcohol.bytes
    || v.getUint32(12, true) !== 1) return waiting;
  const remainingMs = v.getUint32(20, true);
  const gameTimer = v.getUint32(16, true);
  if (remainingMs > 300_000 || (v.getUint32(24, true) === 0 && v.getUint32(28, true) === 0)
    || sequence !== v.getUint32(8, true)) return waiting;
  return Object.freeze({ status: "ready", sequence, gameTimer, remainingMs });
}
export function createAlcoholObservationInstallation(available: boolean) {
  return createCompanionRegionInstallation<AlcoholState>({ available, name: "alcohol",
    bytes: COMPANION_ABI.alcohol.bytes, waiting: { status: "waiting" },
    stale: { status: "waiting" }, freshness: CONTINUOUS_COMPANION_FRESHNESS });
}
