/**
 * Decodes the bounded friend snapshot published by the companion. This module
 * owns its closed scalar wire format and rejects torn or malformed records.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";

import type { TravelFriend as CompanionFriend, TravelFriends as CompanionFriends } from "../shared/friends.js";

const MAGIC = 0x5246_5747;
const HEADER_BYTES = 24;
const RECORD_BYTES = 96;
const STATUS = ["offline", "online", "do-not-disturb", "away", "unknown"] as const;

/** Identifies user-visible roster content while ignoring the seqlock revision. */
export function companionFriendsSignature(observation: CompanionFriends): string {
  return observation.status === "ready"
    ? JSON.stringify([observation.status, observation.generation, observation.friends])
    : `${observation.status}:${observation.reason}`;
}

function name(view: DataView, offset: number): string | null {
  const units: number[] = [];
  for (let index = 0; index < COMPANION_ABI.friends.nameUnits; index += 1) {
    const unit = view.getUint16(offset + index * 2, true);
    if (unit === 0) {
      if (index === 0) return "";
      try { return String.fromCodePoint(...units); } catch { return null; }
    }
    if (unit < 0x20 || unit === 0x7f) return null;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = view.getUint16(offset + (++index) * 2, true);
      if (trailing < 0xdc00 || trailing > 0xdfff) return null;
      units.push(0x10000 + ((unit - 0xd800) << 10) + trailing - 0xdc00);
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return null;
    else units.push(unit);
  }
  return null;
}

export function readCompanionFriends(buffer: ArrayBuffer, pointer: number): CompanionFriends {
  if (pointer < 0 || pointer % 4 !== 0 || pointer + COMPANION_ABI.friends.bytes > buffer.byteLength) {
    return { status: "waiting", reason: "invalid" };
  }
  const view = new DataView(buffer, pointer, COMPANION_ABI.friends.bytes);
  const start = view.getUint32(8, true);
  if (start & 1) return { status: "waiting", reason: "unavailable" };
  if (view.getUint32(0, true) !== MAGIC
    || view.getUint16(4, true) !== COMPANION_ABI.friends.abi
    || view.getUint16(6, true) !== COMPANION_ABI.friends.bytes
    || view.getUint32(12, true) > 1) return { status: "waiting", reason: "invalid" };
  if (view.getUint32(12, true) === 0) return { status: "waiting", reason: "unavailable" };
  const generation = view.getUint32(16, true);
  const count = view.getUint32(20, true);
  if (generation === 0 || count > COMPANION_ABI.friends.slots) {
    return { status: "waiting", reason: "invalid" };
  }
  const friends: CompanionFriend[] = [];
  const keys = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const at = HEADER_BYTES + index * RECORD_BYTES;
    const low = view.getUint32(at, true);
    const high = view.getUint32(at + 4, true);
    const status = STATUS[view.getUint32(at + 8, true)];
    const alias = name(view, at + 16);
    const character = name(view, at + 56);
    const key = high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
    if (!status || !alias || character === null || keys.has(key) || key === "0000000000000000") {
      return { status: "waiting", reason: "invalid" };
    }
    keys.add(key);
    friends.push({ key, status, mapId: view.getUint32(at + 12, true), alias, character });
  }
  const end = view.getUint32(8, true);
  return start === end && !(end & 1)
    ? { status: "ready", sequence: end, generation, friends }
    : { status: "waiting", reason: "unavailable" };
}
