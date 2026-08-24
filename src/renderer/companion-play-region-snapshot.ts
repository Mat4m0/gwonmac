/**
 * Strict decoder for the companion's bounded PvE/PvP policy publication.
 * No pointer or broader game state crosses this presentation boundary.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";

export const COMPANION_PLAY_REGION_ABI = COMPANION_ABI.playRegion.abi;
export const COMPANION_PLAY_REGION_BYTES = COMPANION_ABI.playRegion.bytes;

const MAGIC = 0x5250_5747;
const FLAGS = Object.freeze({ ready: 1, loading: 2 });

export function readCompanionPlayRegion(buffer: ArrayBuffer, pointer: number) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_PLAY_REGION_BYTES > buffer.byteLength
  ) return Object.freeze({ status: "waiting", reason: "memory" } as const);

  const view = new DataView(buffer, pointer, COMPANION_PLAY_REGION_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" } as const);
  }
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const bytes = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const mapId = view.getUint32(16, true);
  const instanceType = view.getUint32(20, true);
  const encodedRegion = view.getUint32(24, true);
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== MAGIC
    || abi !== COMPANION_PLAY_REGION_ABI
    || bytes !== COMPANION_PLAY_REGION_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~(FLAGS.ready | FLAGS.loading)) !== 0
    || flags === (FLAGS.ready | FLAGS.loading)
  ) return Object.freeze({ status: "waiting", reason: "snapshot" } as const);

  if ((flags & FLAGS.loading) !== 0) {
    return mapId === 0 && instanceType === 0 && encodedRegion === 0
      ? Object.freeze({ status: "waiting", reason: "loading" } as const)
      : Object.freeze({ status: "waiting", reason: "corrupt" } as const);
  }
  if ((flags & FLAGS.ready) === 0) {
    return mapId === 0 && instanceType === 0 && encodedRegion === 0
      ? Object.freeze({ status: "waiting", reason: "game" } as const)
      : Object.freeze({ status: "waiting", reason: "corrupt" } as const);
  }
  if (
    mapId === 0
    || mapId > 2_000
    || instanceType > 1
    || (encodedRegion !== 1 && encodedRegion !== 2)
  ) return Object.freeze({ status: "waiting", reason: "corrupt" } as const);

  return Object.freeze({
    status: "ready" as const,
    sequence: secondSequence,
    mapId,
    instanceType,
    playRegion: encodedRegion === 1 ? "pve" as const : "pvp" as const,
  });
}

export type CompanionPlayRegionState =
  | ReturnType<typeof readCompanionPlayRegion>
  | Readonly<{ status: "waiting"; reason: "stale" }>;
