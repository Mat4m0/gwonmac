/**
 * Owns the bounded, privacy-safe Character Switch usage document. It stores
 * only one-way character keys and successful-switch statistics, never names.
 */

export const CHARACTER_SWITCH_USAGE_FORMAT = 1;
export const CHARACTER_SWITCH_USAGE_LIMIT = 256;
export const CHARACTER_SWITCH_COUNT_MAX = 0xffff_ffff;

export type CharacterSwitchUsageEntry = Readonly<{
  characterKey: string;
  successfulSwitches: number;
  lastUsedSequence: number;
}>;

export type CharacterSwitchUsageDocument = Readonly<{
  formatVersion: typeof CHARACTER_SWITCH_USAGE_FORMAT;
  sequence: number;
  entries: readonly CharacterSwitchUsageEntry[];
}>;

const CHARACTER_KEY_PATTERN = /^[0-9a-f]{16}$/u;

export const EMPTY_CHARACTER_SWITCH_USAGE: CharacterSwitchUsageDocument = Object.freeze({
  formatVersion: CHARACTER_SWITCH_USAGE_FORMAT,
  sequence: 0,
  entries: Object.freeze([]),
});

export function isCharacterSwitchKey(value: unknown): value is string {
  return typeof value === "string"
    && value !== "0000000000000000"
    && CHARACTER_KEY_PATTERN.test(value);
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;
}

export function parseCharacterSwitchUsageDocument(
  value: unknown,
): CharacterSwitchUsageDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Character Switch usage must be an object");
  }
  const input = value as Record<string, unknown>;
  const sequence = input.sequence;
  if (
    Object.keys(input).length !== 3
    || input.formatVersion !== CHARACTER_SWITCH_USAGE_FORMAT
    || !isUint32(sequence)
    || !Array.isArray(input.entries)
    || input.entries.length > CHARACTER_SWITCH_USAGE_LIMIT
  ) throw new TypeError("Character Switch usage is invalid");
  const keys = new Set<string>();
  const entries = input.entries.map((candidate): CharacterSwitchUsageEntry => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError("Character Switch usage entry is invalid");
    }
    const entry = candidate as Record<string, unknown>;
    if (
      Object.keys(entry).length !== 3
      || !isCharacterSwitchKey(entry.characterKey)
      || keys.has(entry.characterKey)
      || !isUint32(entry.successfulSwitches)
      || entry.successfulSwitches === 0
      || !isUint32(entry.lastUsedSequence)
      || entry.lastUsedSequence === 0
      || entry.lastUsedSequence > sequence
    ) throw new TypeError("Character Switch usage entry is invalid");
    keys.add(entry.characterKey);
    return Object.freeze({
      characterKey: entry.characterKey,
      successfulSwitches: entry.successfulSwitches,
      lastUsedSequence: entry.lastUsedSequence,
    });
  });
  return Object.freeze({
    formatVersion: CHARACTER_SWITCH_USAGE_FORMAT,
    sequence,
    entries: Object.freeze(entries),
  });
}

export function parseCharacterSwitchUsageRecord(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Character Switch usage record is invalid");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !isCharacterSwitchKey(input.characterKey)) {
    throw new TypeError("Character Switch usage record is invalid");
  }
  return input.characterKey;
}

export function recordSuccessfulCharacterSwitch(
  document: CharacterSwitchUsageDocument,
  characterKey: string,
): CharacterSwitchUsageDocument {
  if (!isCharacterSwitchKey(characterKey)) {
    throw new TypeError("Character Switch key is invalid");
  }
  let entries = [...document.entries];
  let sequence = document.sequence;
  if (sequence === 0xffff_ffff) {
    entries = entries
      .sort((left, right) => left.lastUsedSequence - right.lastUsedSequence)
      .map((entry, index) => Object.freeze({ ...entry, lastUsedSequence: index + 1 }));
    sequence = entries.length;
  }
  sequence += 1;
  const previous = entries.find((entry) => entry.characterKey === characterKey);
  const next = Object.freeze({
    characterKey,
    successfulSwitches: Math.min(
      CHARACTER_SWITCH_COUNT_MAX,
      (previous?.successfulSwitches ?? 0) + 1,
    ),
    lastUsedSequence: sequence,
  });
  entries = [
    ...entries.filter((entry) => entry.characterKey !== characterKey),
    next,
  ]
    .sort((left, right) => right.lastUsedSequence - left.lastUsedSequence)
    .slice(0, CHARACTER_SWITCH_USAGE_LIMIT);
  return Object.freeze({
    formatVersion: CHARACTER_SWITCH_USAGE_FORMAT,
    sequence,
    entries: Object.freeze(entries),
  });
}
