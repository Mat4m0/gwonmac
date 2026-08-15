/**
 * The typed certificate model and capability algebra shared by every exact
 * Enhancement build. Exact build facts live in the small registry beside it.
 *
 * Entries are matched by exact input hash and by nothing else. Every offset
 * here was measured against one build, so there is no nearest match, no
 * inheritance between entries and no default: a client with no entry gets no
 * Enhancement rather than a plausible guess.
 *
 * The order of `ENHANCEMENT_*_LAYOUT_FIELDS` is the config ABI — the kernel
 * decodes those words positionally. Reordering or inserting a field changes
 * what the kernel reads and invalidates every `outputSha256` in the table, so
 * the two must be edited together or not at all.
 */
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  enhancementCapabilityProfile,
  enhancementConfigWordActive,
  type EnhancementCapabilityProfile,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  ENHANCEMENT_CONFIG_FIELDS,
  type EnhancementCursorLayout,
  type EnhancementObservationBaseLayout,
  type EnhancementPartyLayout,
  type EnhancementTargetLayout,
} from "../../shared/enhancement-config.js";
export {
  ENHANCEMENT_LAYOUT_FIELDS,
  type EnhancementLayout,
} from "../../shared/enhancement-config.js";

export type EnhancementOutputHashes = Readonly<
  Partial<Record<EnhancementCapabilityProfile, string>>
>;

export function enhancementOutputSha256(
  build: KnownEnhancementBuild,
  capabilities: EnhancementCapabilities,
): string | null {
  if (!hasCompleteEnhancementProfileHashes(build)) return null;
  const profile = enhancementCapabilityProfile(capabilities);
  if (profile === null) return null;
  const output = build.outputSha256?.[profile];
  return typeof output === "string" && /^[0-9a-f]{64}$/.test(output)
    ? output
    : null;
}

/**
 * Build-local UI messages that can replace or mutate the party/hero graph.
 * Tuple order is part of the companion config ABI; the labels keep the
 * certificate reviewable without teaching Rust unversioned message IDs.
 */
export type EnhancementPartyDirtyMessages = readonly [
  heroAgentAdded: number,
  heroDataAdded: number,
  mapLoaded: number,
  loadMapContext: number,
  startMapLoad: number,
  mapChange: number,
  partyAddHero: number,
  partyRemoveHero: number,
  partyAddPlayer: number,
  partyRemovePlayer: number,
];

/**
 * Everything the full party projection needs beyond the first owned hero.
 *
 * A separate group because it was a separate certification round. Appended
 * rather than interleaved so the words the kernel already decodes keep their
 * positions — the config ABI is positional, and a field inserted mid-list
 * changes what every later word means.
 *
 * Professions are absent by measurement, not oversight: `HeroPartyMember`
 * carries zero at the two offsets the reference names, for a Warrior, so they
 * are read from `HeroInfo` instead. A field whose value the client does not
 * populate is worse than a missing one — it reads as Profession::None.
 */
/**
 * The attribute table, which is what makes a captured build publishable.
 *
 * Its own group, appended for the same positional reason as the one above: a
 * word inserted anywhere earlier changes what every later word means.
 *
 * There is no entry-count word. The array is sparse and indexed by attribute
 * id — every real entry satisfies `index == id` — so the walk runs the 45 ids
 * the client defines and takes that equality as the admission rule. The
 * reference struct pads to 54 entries, and indices 51-53 hold values that
 * decode as plausible ranks; a count word would have walked straight into
 * them. See the evidence file, C5.
 */
export function enhancementConfigWords(
  build: KnownEnhancementBuild,
  capabilities: EnhancementCapabilities,
): number[] {
  return ENHANCEMENT_CONFIG_FIELDS.map((field, index) => {
    if (!enhancementConfigWordActive(capabilities, index)) return 0;
    if (field.source === "layout") {
      const value = field.owner === "observation"
        ? build.observationBase?.layout[field.key]
        : field.owner === "target"
          ? build.targetObservation?.layout[field.key]
          : field.owner === "cursor"
            ? build.cursorEvent?.layout[field.key]
            : build.partyObservation?.layout[field.key];
      if (typeof value !== "number") {
        throw new Error(`${field.owner} configuration is not certified`);
      }
      return value;
    }
    const party = build.partyObservation;
    if (!party) {
      throw new Error("party observation configuration is not certified");
    }
    if (field.source === "dispatcher") return party[field.key];
    return party.partyDirtyMessages[field.index] ?? 0;
  });
}

export interface KnownEnhancementBuild {
  sha256: string;
  outputSha256: EnhancementOutputHashes;
  programId: number;
  buildId: number;
  hookFunction: number;
  hookParams: readonly ["i32"];
  hookResults: readonly [];
  hookBodySha256: string;
  tableSlot: number;
  /** Memory facts shared by target and party observation. */
  observationBase?: Readonly<{ layout: EnhancementObservationBaseLayout }>;
  cursorEvent?: Readonly<{
    functionIndex: number;
    params: readonly ["i32", "i32", "i32", "i32", "i32"];
    results: readonly [];
    tableSlot: number;
    producerFunctions: readonly [number, number];
    producerParams: readonly [readonly string[], readonly string[]];
    producerResults: readonly [readonly string[], readonly string[]];
    bodySha256: string;
    producerBodySha256: readonly [string, string];
    tableNeighbourBodySha256: readonly [before: string, after: string];
    layout: EnhancementCursorLayout;
  }>;
  /**
   * The commands the client may be given the ability to send, and nothing
   * else. Emitted into the module as one thunk when — and only when — the
   * `commands` capability is on.
   *
   * Certified on the **opcode**, which is the wire protocol and is identical in
   * every build because the server is on the other end of it. `functionIndex`
   * is a per-build recovery, not a certificate: the eight indices this work
   * originally carried were off by exactly three, and a bare index has no way
   * to notice. `bodySha256` is what makes it fail closed — the transform hashes
   * the body at that index and refuses unless it is byte-for-byte the function
   * that was certified. Recover a new build's indices with
   * `tools/packet_builders.py`.
   */
  /** Exact read-only memory layout authority for target observation. */
  targetObservation?: Readonly<{ layout: EnhancementTargetLayout }>;
  /** Exact command authority. Omitted builds can never emit a command thunk. */
  teamApply?: Readonly<{
    thunkExport: string;
    professionTrace: Readonly<{
      readerExport: string;
      sender: Readonly<{
        functionIndex: number;
        params: readonly ["i32", "i32", "i32"];
        results: readonly [];
        bodySha256: string;
      }>;
    }>;
    drain: Readonly<{
      functionIndex: number;
      params: readonly ["i32", "i32"];
      results: readonly [];
      tableSlot: number;
      bodySha256: string;
    }>;
    entries: readonly Readonly<{
      opcode: number;
      functionIndex: number;
      params: readonly "i32"[];
      results: readonly [];
      bodySha256: string;
      /** What this sends, for the reader. Never used to decide anything. */
      label: string;
    }>[];
  }>;
  /** Exact UI-dispatch and party-observation authority. */
  partyObservation?: Readonly<{
    functionIndex: number;
    params: readonly ["i32", "i32", "i32"];
    results: readonly [];
    playerChatMessage: number;
    hideHeroPanelMessage: number;
    showHeroPanelMessage: number;
    partyDirtyMessages: EnhancementPartyDirtyMessages;
    playerChatProducer: number;
    playerChatSites: 3;
    nearbyPlayerMessages: readonly [number, number];
    nearbyPlayerMessageProducers: readonly [number, number];
    layout: EnhancementPartyLayout;
  }>;
}

export function supportedEnhancementCapabilities(
  build: KnownEnhancementBuild,
): EnhancementCapabilities {
  const observationBase = build.observationBase !== undefined;
  const partyObservation = observationBase && build.partyObservation !== undefined;
  return Object.freeze({
    nativeCursor: build.cursorEvent !== undefined,
    targetObservation: observationBase && build.targetObservation !== undefined,
    partyObservation,
    commands: partyObservation && build.teamApply !== undefined,
  });
}

export function enhancementProfilesForBuild(
  build: KnownEnhancementBuild,
): EnhancementCapabilityProfile[] {
  const supported = supportedEnhancementCapabilities(build);
  return (
    Object.keys(
      ENHANCEMENT_CAPABILITY_PROFILES,
    ) as EnhancementCapabilityProfile[]
  ).filter((profile) => {
    const value = ENHANCEMENT_CAPABILITY_PROFILES[profile];
    return (
      (!value.nativeCursor || supported.nativeCursor) &&
      (!value.targetObservation || supported.targetObservation) &&
      (!value.partyObservation || supported.partyObservation) &&
      (!value.commands || supported.commands)
    );
  });
}

/**
 * A certificate carries one hash for every profile its optional fact groups
 * authorize, and no hash for a profile those groups do not authorize. This is
 * the authoring boundary that keeps a stale or copied hash from granting a
 * capability whose facts are absent.
 */
export function hasCompleteEnhancementProfileHashes(
  build: KnownEnhancementBuild,
): boolean {
  const hasObservation = build.targetObservation !== undefined
    || build.partyObservation !== undefined;
  if (hasObservation && build.observationBase === undefined) {
    return false;
  }
  if (
    build.teamApply !== undefined
    && (build.observationBase === undefined || build.partyObservation === undefined)
  ) {
    return false;
  }
  const expected = enhancementProfilesForBuild(build);
  if (expected.length === 0) return false;
  const expectedSet = new Set<string>(expected);
  const actual = Object.entries(build.outputSha256);
  return (
    actual.length === expected.length &&
    actual.every(
      ([profile, digest]) =>
        expectedSet.has(profile) &&
        typeof digest === "string" &&
        /^[0-9a-f]{64}$/.test(digest),
    )
  );
}
