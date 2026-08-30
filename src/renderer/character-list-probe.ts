/**
 * Closed, read-only projection of the exact current client's account-character
 * array. This module is imported only by the unpackaged developer probe and
 * never writes to the live WebAssembly memory.
 */
const EXPECTED_BUILD_ID = 3_759_047_528;
const CHARACTER_ARRAY_POINTER = 0x5a75e8;
const CHARACTER_ARRAY_COUNT = 0x5a75f0;
const SELECTED_CHARACTER_NAME = 0x5a7760;
const RECORD_BYTES = 0x84;
const SUMMARY_LENGTH = 0x04;
const UUID_OFFSET = 0x08;
const NAME_OFFSET = 0x18;
const SUMMARY_OFFSET = 0x40;
const NAME_CODE_UNITS = 20;
const MAX_SUMMARY_BYTES = 0x40;
const MAX_CHARACTER_COUNT = 64;
const REQUIRED_STABLE_ROOT_READS = 3;
const MAX_MAP_ID = 882;
const CURRENT_SUMMARY_FORMAT = 8;

export type CharacterListProbeReason =
  | "not-initialized"
  | "unstable-root"
  | "count-out-of-range"
  | "array-out-of-range"
  | "record-invalid"
  | "name-invalid"
  | "name-duplicate"
  | "summary-invalid"
  | "field-out-of-range"
  | "selected-identity-invalid"
  | "probe-unavailable";

export type CharacterListProbeTransition =
  | "initial"
  | "unchanged"
  | "appeared"
  | "changed"
  | "invalidated"
  | "cleared"
  | "recovered";

type NumericRange = Readonly<{ min: number; max: number }>;

export type CharacterListProbeProjection = Readonly<{
  schema: 2;
  status: "absent" | "warming" | "ready" | "invalid";
  reason: CharacterListProbeReason | null;
  observation: number;
  stableRootReads: number;
  revision: number;
  transition: CharacterListProbeTransition;
  count: number | null;
  selectedIndex: number | null;
  selectedIdentity: "none" | "unique" | "invalid";
  fields: Readonly<{
    names: boolean;
    primaryProfession: boolean;
    secondaryProfession: boolean;
    characterIdentity: boolean;
    characterType: boolean;
    campaign: boolean;
    level: boolean;
    currentMapId: boolean;
  }>;
  ranges: Readonly<{
    primaryProfession: NumericRange | null;
    secondaryProfession: NumericRange | null;
    campaign: NumericRange | null;
    level: NumericRange | null;
    currentMapId: NumericRange | null;
  }>;
}>;

type ProbeDependencies = Readonly<{
  memory: WebAssembly.Memory;
}>;

const EMPTY_FIELDS = Object.freeze({
  names: false,
  primaryProfession: false,
  secondaryProfession: false,
  characterIdentity: false,
  characterType: false,
  campaign: false,
  level: false,
  currentMapId: false,
});
const EMPTY_RANGES = Object.freeze({
  primaryProfession: null,
  secondaryProfession: null,
  campaign: null,
  level: null,
  currentMapId: null,
});

function boundedRange(values: readonly number[]): NumericRange | null {
  if (values.length === 0) return null;
  return Object.freeze({ min: Math.min(...values), max: Math.max(...values) });
}

function readName(
  view: DataView,
  pointer: number,
  allowEmpty: boolean,
): string | null {
  const units: number[] = [];
  let terminated = false;
  for (let index = 0; index < NAME_CODE_UNITS; index += 1) {
    const unit = view.getUint16(pointer + index * 2, true);
    if (unit === 0) {
      terminated = true;
      break;
    }
    units.push(unit);
  }
  if (!terminated || (!allowEmpty && units.length === 0)) return null;
  const value = String.fromCharCode(...units);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return null;
    }
  }
  return value;
}

function mixFingerprint(hash: number, value: number): number {
  return Math.imul((hash ^ value) >>> 0, 16_777_619) >>> 0;
}

function invalidProjection(
  state: ProbeState,
  reason: CharacterListProbeReason,
  count: number | null,
): CharacterListProbeProjection {
  const transition = state.previousStatus === "invalid" ? "unchanged" : "invalidated";
  state.previousStatus = "invalid";
  state.stableRootReads = 0;
  state.rootPointer = null;
  state.rootCount = null;
  return Object.freeze({
    schema: 2,
    status: "invalid",
    reason,
    observation: state.observation,
    stableRootReads: 0,
    revision: state.revision,
    transition,
    count,
    selectedIndex: null,
    selectedIdentity: "invalid",
    fields: EMPTY_FIELDS,
    ranges: EMPTY_RANGES,
  });
}

type ProbeState = {
  observation: number;
  stableRootReads: number;
  revision: number;
  rootPointer: number | null;
  rootCount: number | null;
  fingerprint: number | null;
  previousStatus: CharacterListProbeProjection["status"] | null;
};

export function createCharacterListProbeReader({
  memory,
}: ProbeDependencies): () => CharacterListProbeProjection {
  const state: ProbeState = {
    observation: 0,
    stableRootReads: 0,
    revision: 0,
    rootPointer: null,
    rootCount: null,
    fingerprint: null,
    previousStatus: null,
  };

  return () => {
    state.observation += 1;
    const bytes = new Uint8Array(memory.buffer);
    const view = new DataView(memory.buffer);
    if (
      CHARACTER_ARRAY_COUNT + 4 > bytes.length
      || SELECTED_CHARACTER_NAME + NAME_CODE_UNITS * 2 > bytes.length
    ) {
      return invalidProjection(state, "probe-unavailable", null);
    }

    const pointer = view.getUint32(CHARACTER_ARRAY_POINTER, true);
    const count = view.getUint32(CHARACTER_ARRAY_COUNT, true);
    if (count === 0 && pointer === 0) {
      const transition = state.previousStatus === null
        ? "initial"
        : state.previousStatus === "absent"
          ? "unchanged"
          : "cleared";
      state.previousStatus = "absent";
      state.rootPointer = pointer;
      state.rootCount = count;
      state.stableRootReads += 1;
      state.fingerprint = null;
      return Object.freeze({
        schema: 2,
        status: "absent",
        reason: "not-initialized",
        observation: state.observation,
        stableRootReads: state.stableRootReads,
        revision: state.revision,
        transition,
        count: 0,
        selectedIndex: null,
        selectedIdentity: "none",
        fields: EMPTY_FIELDS,
        ranges: EMPTY_RANGES,
      });
    }
    if (count < 1 || count > MAX_CHARACTER_COUNT) {
      return invalidProjection(state, "count-out-of-range", null);
    }
    const arrayBytes = count * RECORD_BYTES;
    if (
      pointer === 0
      || (pointer & 3) !== 0
      || pointer > bytes.length
      || arrayBytes > bytes.length - pointer
    ) {
      return invalidProjection(state, "array-out-of-range", count);
    }

    const sameRoot = state.rootPointer === pointer && state.rootCount === count;
    const rootChanged = state.rootPointer !== null && !sameRoot;
    state.stableRootReads = sameRoot ? state.stableRootReads + 1 : 1;
    state.rootPointer = pointer;
    state.rootCount = count;

    const names: string[] = [];
    const professions: number[] = [];
    const secondaryProfessions: number[] = [];
    const characterKeys = new Set<string>();
    const campaigns: number[] = [];
    const levels: number[] = [];
    const maps: number[] = [];
    const types: number[] = [];
    let fingerprint = 2_166_136_261;
    for (let index = 0; index < count; index += 1) {
      const record = pointer + index * RECORD_BYTES;
      const summaryBytes = view.getUint32(record + SUMMARY_LENGTH, true);
      if (summaryBytes < 33 || summaryBytes > MAX_SUMMARY_BYTES) {
        return invalidProjection(state, "record-invalid", count);
      }
      let characterHash = 0xcbf2_9ce4_8422_2325n;
      let uuidNonzero = 0;
      for (let wordIndex = 0; wordIndex < 4; wordIndex += 1) {
        const word = view.getUint32(record + UUID_OFFSET + wordIndex * 4, true);
        uuidNonzero |= word;
        for (const byte of [word, word >>> 8, word >>> 16, word >>> 24]) {
          characterHash ^= BigInt(byte & 0xff);
          characterHash = BigInt.asUintN(64, characterHash * 0x100_0000_01b3n);
        }
      }
      const characterKey = characterHash.toString(16).padStart(16, "0");
      if (uuidNonzero === 0 || characterHash === 0n || characterKeys.has(characterKey)) {
        return invalidProjection(state, "record-invalid", count);
      }
      characterKeys.add(characterKey);
      const name = readName(view, record + NAME_OFFSET, false);
      if (name === null) return invalidProjection(state, "name-invalid", count);
      if (names.includes(name)) return invalidProjection(state, "name-duplicate", count);
      names.push(name);

      const summary = record + SUMMARY_OFFSET;
      if (view.getUint16(summary, true) !== CURRENT_SUMMARY_FORMAT) {
        return invalidProjection(state, "summary-invalid", count);
      }
      // Exact current func_9478 reads format 8 directly. func_6866's certified
      // profession slot 3 is shift 20, width 4. Reproducing those loads avoids
      // both a game-function call and every write to the live game heap.
      const appearance = view.getUint32(summary + 8, true);
      const campaignLevelType = view.getUint16(summary + 28, true);
      const profession = (appearance >>> 20) & 0xf;
      const secondaryProfession = (campaignLevelType >>> 10) & 0xf;
      const campaign = campaignLevelType & 0xf;
      const level = (campaignLevelType >>> 4) & 0x1f;
      const map = view.getUint16(summary + 2, true);
      const type = (campaignLevelType >>> 9) & 1;
      if (
        profession < 1 || profession > 10
        || secondaryProfession > 10
        || campaign > 5
        || level < 1 || level > 20
        || map > MAX_MAP_ID
        || type > 1
        || (type === 0 && campaign === 0)
      ) {
        return invalidProjection(state, "field-out-of-range", count);
      }
      professions.push(profession);
      secondaryProfessions.push(secondaryProfession);
      campaigns.push(campaign);
      levels.push(level);
      maps.push(map);
      types.push(type);
      for (let unit = 0; unit < name.length; unit += 1) {
        fingerprint = mixFingerprint(fingerprint, name.charCodeAt(unit));
      }
      for (const field of [profession, secondaryProfession, campaign, level, map, type]) {
        fingerprint = mixFingerprint(fingerprint, field);
      }
    }

    if (
      view.getUint32(CHARACTER_ARRAY_POINTER, true) !== pointer
      || view.getUint32(CHARACTER_ARRAY_COUNT, true) !== count
    ) {
      return invalidProjection(state, "unstable-root", count);
    }

    const selectedName = readName(view, SELECTED_CHARACTER_NAME, true);
    if (selectedName === null) {
      return invalidProjection(state, "selected-identity-invalid", count);
    }
    const selectedIndex = selectedName.length === 0 ? null : names.indexOf(selectedName);
    if (selectedIndex !== null && selectedIndex < 0) {
      return invalidProjection(state, "selected-identity-invalid", count);
    }
    fingerprint = mixFingerprint(fingerprint, selectedIndex ?? 0xffff_ffff);
    const changed = rootChanged
      || (state.fingerprint !== null && state.fingerprint !== fingerprint);
    if (state.fingerprint !== fingerprint) state.revision += 1;
    state.fingerprint = fingerprint;
    const status = state.stableRootReads >= REQUIRED_STABLE_ROOT_READS
      ? "ready"
      : "warming";
    const transition: CharacterListProbeTransition = state.previousStatus === null
      ? "initial"
      : changed
        ? "changed"
        : state.previousStatus === "absent"
          ? "appeared"
          : state.previousStatus === "invalid"
            ? "recovered"
            : "unchanged";
    state.previousStatus = status;
    return Object.freeze({
      schema: 2,
      status,
      reason: status === "warming" ? "unstable-root" : null,
      observation: state.observation,
      stableRootReads: state.stableRootReads,
      revision: state.revision,
      transition,
      count,
      selectedIndex,
      selectedIdentity: selectedIndex === null ? "none" : "unique",
      fields: Object.freeze({
        names: true,
        primaryProfession: professions.length === count,
        secondaryProfession: secondaryProfessions.length === count,
        characterIdentity: characterKeys.size === count,
        characterType: types.length === count,
        campaign: campaigns.length === count,
        level: levels.length === count,
        currentMapId: maps.length === count,
      }),
      ranges: Object.freeze({
        primaryProfession: boundedRange(professions),
        secondaryProfession: boundedRange(secondaryProfessions),
        campaign: boundedRange(campaigns),
        level: boundedRange(levels),
        currentMapId: boundedRange(maps),
      }),
    });
  };
}

export function installCharacterListProbe(
  memory: WebAssembly.Memory,
  buildId: number,
): Readonly<{ read(): CharacterListProbeProjection; dispose(): void }> | null {
  if (!(memory instanceof WebAssembly.Memory) || buildId !== EXPECTED_BUILD_ID) {
    return null;
  }
  const read = createCharacterListProbeReader({ memory });
  let disposed = false;
  return Object.freeze({
    read() {
      if (disposed) {
        return Object.freeze({
          schema: 2,
          status: "invalid",
          reason: "probe-unavailable",
          observation: 0,
          stableRootReads: 0,
          revision: 0,
          transition: "invalidated",
          count: null,
          selectedIndex: null,
          selectedIdentity: "invalid",
          fields: EMPTY_FIELDS,
          ranges: EMPTY_RANGES,
        });
      }
      return read();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  });
}
