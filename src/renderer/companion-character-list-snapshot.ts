/**
 * Strictly decodes the kernel-owned, bounded account-character projection.
 * It owns no game-memory reads and accepts no partial record publication.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";

const MAGIC = 0x4843_5747;
const HEADER_BYTES = 24;
const RECORD_BYTES = 72;
const FLAGS = Object.freeze({ ready: 1, warming: 2, absent: 4 });

export type CharacterSummary = Readonly<{
  name: string;
  characterKey: string;
  primaryProfession: number;
  secondaryProfession: number;
  characterType: "roleplaying" | "pvp";
  campaign: number;
  level: number;
  mapId: number;
}>;

export type CompanionCharacterListState =
  | Readonly<{ status: "waiting"; reason: "memory" | "writing" | "snapshot" | "stale" }>
  | Readonly<{ status: "absent" | "warming"; sequence: number }>
  | Readonly<{
      status: "ready";
      sequence: number;
      selectedIndex: number | null;
      characters: readonly CharacterSummary[];
    }>;

/** Ignores the publication sequence, which advances every game frame. */
export function sameCharacterListPresentation(
  previous: CompanionCharacterListState,
  next: CompanionCharacterListState,
): boolean {
  if (previous.status !== next.status) return false;
  if (previous.status === "waiting" && next.status === "waiting") {
    return previous.reason === next.reason;
  }
  if ((previous.status === "absent" && next.status === "absent")
    || (previous.status === "warming" && next.status === "warming")) return true;
  if (previous.status !== "ready" || next.status !== "ready") return false;
  return previous.selectedIndex === next.selectedIndex
    && previous.characters.length === next.characters.length
    && previous.characters.every((character, index) => {
      const candidate = next.characters[index];
      return candidate !== undefined
        && character.name === candidate.name
        && character.characterKey === candidate.characterKey
        && character.primaryProfession === candidate.primaryProfession
        && character.secondaryProfession === candidate.secondaryProfession
        && character.characterType === candidate.characterType
        && character.campaign === candidate.campaign
        && character.level === candidate.level
        && character.mapId === candidate.mapId;
    });
}

function readName(view: DataView, offset: number): string | null {
  const units: number[] = [];
  let terminated = false;
  for (let index = 0; index < COMPANION_ABI.characterList.nameUnits; index += 1) {
    const unit = view.getUint16(offset + index * 2, true);
    if (unit === 0) { terminated = true; break; }
    units.push(unit);
  }
  if (!terminated || units.length === 0) return null;
  const value = String.fromCharCode(...units);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return null;
  }
  return value;
}

export function readCompanionCharacterList(
  buffer: ArrayBuffer,
  pointer: number,
): CompanionCharacterListState {
  if (!(buffer instanceof ArrayBuffer) || !Number.isInteger(pointer) || pointer < 0
    || pointer + COMPANION_ABI.characterList.bytes > buffer.byteLength) {
    return Object.freeze({ status: "waiting", reason: "memory" });
  }
  const view = new DataView(buffer, pointer, COMPANION_ABI.characterList.bytes);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" });
  }
  const flags = view.getUint32(12, true);
  const count = view.getUint32(16, true);
  const selected = view.getUint32(20, true);
  const validHeader = view.getUint32(0, true) === MAGIC
    && view.getUint16(4, true) === COMPANION_ABI.characterList.abi
    && view.getUint16(6, true) === COMPANION_ABI.characterList.bytes
    && flags !== 0 && (flags & (flags - 1)) === 0
    && (flags & ~(FLAGS.ready | FLAGS.warming | FLAGS.absent)) === 0;
  if (!validHeader || view.getUint32(8, true) !== firstSequence) {
    return Object.freeze({ status: "waiting", reason: "snapshot" });
  }
  if ((flags & FLAGS.absent) !== 0) {
    return count === 0 && selected === 0xffff_ffff
      ? Object.freeze({ status: "absent", sequence: firstSequence })
      : Object.freeze({ status: "waiting", reason: "snapshot" });
  }
  if (count < 1 || count > COMPANION_ABI.characterList.slots
    || (selected !== 0xffff_ffff && selected >= count)) {
    return Object.freeze({ status: "waiting", reason: "snapshot" });
  }
  if ((flags & FLAGS.warming) !== 0) {
    return Object.freeze({ status: "warming", sequence: firstSequence });
  }
  const characters: CharacterSummary[] = [];
  const names = new Set<string>();
  const characterKeys = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const offset = HEADER_BYTES + index * RECORD_BYTES;
    const name = readName(view, offset);
    const primaryProfession = view.getUint32(offset + 40, true);
    const secondaryProfession = view.getUint32(offset + 44, true);
    const type = view.getUint32(offset + 48, true);
    const campaign = view.getUint32(offset + 52, true);
    const level = view.getUint32(offset + 56, true);
    const mapId = view.getUint32(offset + 60, true);
    const characterLow = view.getUint32(offset + 64, true);
    const characterHigh = view.getUint32(offset + 68, true);
    const characterKey = `${characterHigh.toString(16).padStart(8, "0")}${characterLow.toString(16).padStart(8, "0")}`;
    if (name === null || names.has(name) || characterKeys.has(characterKey)
      || characterKey === "0000000000000000"
      || primaryProfession < 1 || primaryProfession > 10 || secondaryProfession > 10
      || type > 1 || campaign > 5 || level < 1 || level > 20 || mapId > 882
      || (type === 0 && campaign === 0)) {
      return Object.freeze({ status: "waiting", reason: "snapshot" });
    }
    names.add(name);
    characterKeys.add(characterKey);
    characters.push(Object.freeze({
      name,
      characterKey,
      primaryProfession,
      secondaryProfession,
      characterType: type === 0 ? "roleplaying" : "pvp",
      campaign,
      level,
      mapId,
    }));
  }
  return Object.freeze({
    status: "ready",
    sequence: firstSequence,
    selectedIndex: selected === 0xffff_ffff ? null : selected,
    characters: Object.freeze(characters),
  });
}
