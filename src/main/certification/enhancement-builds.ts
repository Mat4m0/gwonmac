/**
 * The certified Enhancement support table: per known client hash, the memory
 * layout the companion kernel reads, the UI message IDs that dirty the party
 * graph, and the output hash of every capability profile derived from it.
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
  enhancementCapabilityProfile,
  enhancementConfigWordActive,
  type EnhancementCapabilityProfile,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  ENHANCEMENT_CONFIG_FIELDS,
  ENHANCEMENT_LAYOUT_FIELDS,
  type EnhancementLayout,
} from "../../shared/enhancement-config.js";
export {
  ENHANCEMENT_LAYOUT_FIELDS,
  type EnhancementLayout,
} from "../../shared/enhancement-config.js";

export type EnhancementOutputHashes = Readonly<
  Record<EnhancementCapabilityProfile, string>
>;

export function enhancementOutputSha256(
  build: KnownEnhancementBuild,
  capabilities: EnhancementCapabilities,
): string | null {
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
export function enhancementLayoutWords(layout: EnhancementLayout): number[] {
  return ENHANCEMENT_LAYOUT_FIELDS.map((field) => layout[field]);
}

export function enhancementConfigWords(
  build: KnownEnhancementBuild,
  capabilities: EnhancementCapabilities,
): number[] {
  const words = ENHANCEMENT_CONFIG_FIELDS.map((field) => {
    if (field.source === "layout") return build.layout[field.key];
    if (field.source === "dispatcher") return build.uiDispatcher[field.key];
    return build.uiDispatcher.partyDirtyMessages[field.index] ?? 0;
  });
  return words.map((word, index) =>
    enhancementConfigWordActive(capabilities, index) ? word : 0);
}

export interface KnownEnhancementBuild {
  sha256: string;
  outputSha256: EnhancementOutputHashes;
  programId: number;
  buildId: number;
  hookFunction: number;
  hookParams: readonly ["i32"];
  hookResults: readonly [];
  tableSlot: number;
  cursorEvent: Readonly<{
    functionIndex: number;
    params: readonly ["i32", "i32", "i32", "i32", "i32"];
    results: readonly [];
    tableSlot: number;
    producerFunctions: readonly [number, number];
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
  commands: Readonly<{
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
  uiDispatcher: Readonly<{
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
  }>;
  layout: EnhancementLayout;
}

// Canonical support manifest. Every value is verified against the exact input
// hash before a derived module is selected.
//
// The input is the template-save client, not the raw official module: that
// transform is the floor every launch lands on, and the Enhancement transform is
// layered on top so opting in never costs template save/load. It only appends
// functions and reserves one new terminal table entry, so the main-loop index,
// original table size and every data address below are certified separately for
// each exact template-save output. Unknown
// Enhancement builds remain off until another complete exact entry is added.
export const ENHANCEMENT_BUILDS: readonly KnownEnhancementBuild[] = Object.freeze([
  Object.freeze({
    sha256: "9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094",
    // Recomputed when the attribute layout landed, as they were for the party
    // layout before it. All profiles move together whenever the manifest's bytes
    // do, and the manifest carries the transform ABI and every config word --
    // so growing the layout changes the output of profiles that do not use one
    // word of it.
    //
    // `pnpm check` cannot catch a stale value here. The transform input is a
    // derived game binary this repository does not contain, so nothing in the
    // suite can run the transform; the first thing that notices is a launch
    // that installs no enhancement at all. Recompute by running
    // `transformEnhancementWasm` against the real derived module whenever
    // ENHANCEMENT_TRANSFORM_ABI or any config word changes.
    outputSha256: Object.freeze({
      cursor: "d187f89fe65ccde26ad3b1cf04a26f73ee5a245960f48d6ff6fb8d94d7156568",
      target: "b1d8a1d05d3ba8875cd02189849fb5c5fd35060ade9b0ec1851b6fbc597e0016",
      cursorTarget: "a8c7da36538171f51dbbf413bdcdc7f5981d8de70b31b107a9d27d750d102d46",
      cursorToolbox: "d09d10ee32ce527320e8955d59a438e056a9e8b07fb8c1677ccdcce011fb76e9",
      // The only derived module that can send anything. Every other profile
      // above is byte-identical to one that carries no command thunk at all.
      cursorToolboxCommands: "76e1ab16d293166d6920b3e27e002ca4558a1d3bce23fb46a73b7bcc99e0c3c4",
      cursorTargetToolboxCommands: "bab9ad6f5f4c5ca56b014737192b353f0449a71348376bb8918c49ffd0e956b2",
    }),
    programId: 1,
    // The client behind this hash identifies itself as build 38797 at runtime
    // (diagnostics build.info); the entry previously carried the baseline's
    // 38771 by mistake.
    buildId: 38797,
    hookFunction: 446,
    hookParams: Object.freeze(["i32"] as const),
    hookResults: Object.freeze([] as const),
    // The input table is fixed at 4,683 entries. The transform extends both
    // limits once and owns only this new terminal entry; statically empty input
    // slot 0 is a game runtime sentinel and must remain untouched.
    tableSlot: 4683,
    cursorEvent: Object.freeze({
      functionIndex: 2469,
      params: Object.freeze(
        ["i32", "i32", "i32", "i32", "i32"] as const,
      ),
      results: Object.freeze([] as const),
      tableSlot: 922,
      producerFunctions: Object.freeze([2828, 2834] as const),
    }),
    // Everything a team apply needs, and nothing else. Kick was sent first,
    // alone, against a live game; the rest joined it once that had worked.
    //
    // `KickAllHeroes` is `kick` with hero id 0x26 and is deliberately *not*
    // here: 0x26 is 38, and Devona is hero 38. GWCAjs verified the sentinel
    // live on build 38,615, which predates her. Kicking heroes one at a time
    // covers every case and never touches the ambiguous value.
    //
    commands: Object.freeze({
      thunkExport: "enhancement_command",
      professionTrace: Object.freeze({
        readerExport: "enhancement_profession_trace",
        // The unique sender shared by all 147 packet builders. The trace
        // wrapper records only fixed opcode-65 and opcode-93 payloads and then
        // calls this exact body unchanged.
        sender: Object.freeze({
          functionIndex: 5951,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "d7f7c74b9cb14ba957ed8de7e74cc18167a3b688301d5f3d765ba04770a8b361",
        }),
      }),
      // GWCA's `GameThread::Enqueue` hooks this recurring frame callback. Its
      // source anchor is FrApi.cpp's unique `renderElapsed >= 0` assertion;
      // the active table relation below proves this is the registered callback,
      // not the nearby one-time frame/message initializer (#6659).
      drain: Object.freeze({
        functionIndex: 6661,
        params: Object.freeze(["i32", "i32"] as const),
        results: Object.freeze([] as const),
        tableSlot: 1721,
        bodySha256:
          "9fb1ca0dee40f5ceef3d0174846ef38af47a8366bfe76cb8da12e86419b40c41",
      }),
      entries: Object.freeze([
        Object.freeze({
          opcode: 31,
          functionIndex: 6887,
          params: Object.freeze(["i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "ad54846e78e293ba4c2a6cef392bb3f3cb62fdd5209d8aadf0e99c75a4914e59",
          label: "CharMsgSendHeroDeactivate(heroId)",
        }),
        Object.freeze({
          opcode: 30,
          functionIndex: 6886,
          params: Object.freeze(["i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "709ce8b36ecd5bb269d211d38a7d504a7577e40312be7c74c125f02bbb3be697",
          label: "CharMsgSendHeroActivate(heroId)",
        }),
        Object.freeze({
          opcode: 21,
          functionIndex: 6878,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "e8c9b33da97ad99f4fabcca08fabf29ecb8a08fb400d8e161bba659775234157",
          label: "CharMsgSendCommandAiMode(agentId, behavior)",
        }),
        // The two that carry a payload. Their third and fourth arguments are
        // addresses of buffers the renderer owns and fills; the client copies
        // out of them and sends. See `COMMAND_PAYLOAD_WORDS`.
        Object.freeze({
          opcode: 93,
          functionIndex: 6943,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "37f53da3c4edecbf9438f093b90e3aff5e65eeac018835da016c472c5fa15a23",
          label: "skillbar set (agentId, count, skills[])",
        }),
        Object.freeze({
          opcode: 65,
          functionIndex: 6917,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "7ea3e38a9cb5dd4bd6edc4d86a89f1e98c531d005b4f3e08a8142b50146f688c",
          label: "CharMsgSendOrderSetProfessionSecondary(agentId, profession)",
        }),
        Object.freeze({
          opcode: 16,
          functionIndex: 6873,
          params: Object.freeze(["i32", "i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "c2b8c55c9cddf538e61911cb6d542196a35700c1d6e5a5e693ab627ca4e53041",
          label: "attributes set (agentId, count, ids[], ranks[])",
        }),
        Object.freeze({
          opcode: 155,
          functionIndex: 10650,
          params: Object.freeze(["i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "99cb42fb99f1503f80beb589f43c7f9bb841352bd95344a7d96f243f0f639287",
          label: "CharMsgSendSetHardMode(enabled)",
        }),
      ] as const),
    }),
    uiDispatcher: Object.freeze({
      functionIndex: 6842,
      params: Object.freeze(["i32", "i32", "i32"] as const),
      results: Object.freeze([] as const),
      playerChatMessage: 0x1000_0082,
      hideHeroPanelMessage: 0x1000_01a3,
      showHeroPanelMessage: 0x1000_01a4,
      // This is the smallest domain-complete dirty set: two hero-readiness
      // notifications, four distinct map-context lifecycle boundaries, and
      // the four party membership mutations that can replace playerParty or
      // its hero vector. Everything else through #6842 remains a no-op for
      // party traversal and the 120-tick reconciliation is the missed-event
      // recovery path.
      partyDirtyMessages: Object.freeze([
        0x1000_0038, // kHeroAgentAdded
        0x1000_0039, // kHeroDataAdded
        0x1000_008c, // kMapLoaded
        0x1000_0098, // kLoadMapContext
        0x1000_00c2, // kStartMapLoad
        0x1000_0111, // kMapChange
        0x1000_011e, // kPartyAddHero
        0x1000_011f, // kPartyRemoveHero
        0x1000_0124, // kPartyAddPlayer
        0x1000_0126, // kPartyRemovePlayer
      ] as const),
      // ChCliApi #8947 contains three independent kPlayerChatMessage sites;
      // each directly calls #6842. Nearby ChCliApi producers #8942/#8945
      // emit 0x1000007f/0x10000080 to that same dispatcher.
      playerChatProducer: 8947,
      playerChatSites: 3,
      nearbyPlayerMessages: Object.freeze([
        0x1000_007f,
        0x1000_0080,
      ] as const),
      nearbyPlayerMessageProducers: Object.freeze([8942, 8945] as const),
    }),
    layout: Object.freeze({
      // Live party-state proof resolves this root to a context array whose
      // slot 6 points at the GameContext. The nearby 0x5a0ed4 global belongs
      // to FcArchive and leaves slot 6 null.
      contextRoot: 0x5a0ee0,
      agentArray: 0x5a4e58,
      manualTargetAgentId: 0x5a394c,
      automaticTargetAgentId: 0x5a3948,
      gameContextSlot: 6,
      characterContext: 0x44,
      mapId: 0x198,
      isExplorable: 0x19c,
      currentMapId: 0x234,
      currentInstanceType: 0x23c,
      playerNumber: 0x2ac,
      agentId: 0x2c,
      agentX: 0x74,
      agentY: 0x78,
      agentType: 0x9c,
      agentPlayerNumber: 0xf4,
      agentModelType: 0xf6,
      // WorldContext::party_profession_states, the same canonical table the
      // client's skill-template loader uses for player and hero professions.
      worldProfessionStates: 0x6bc,
      professionStateStride: 0x14,
      // WorldContext::unlocked_character_skills, the current character's
      // learned-skill bitset used by the in-game skill window.
      worldCharacterSkills: 0x710,
      cursorActiveArt: 0x5a16e0,
      cursorSoftwareModel: 0x5a16e4,
      cursorShowCount: 0x5a16e8,
      cursorColorBuffer: 0x298e50,
      cursorArtHotspot: 0x00,
      cursorArtTexture: 0x0c,
      cursorHandleKey: 0x08,
      cursorHandleObject: 0x00,
      cursorViewTexture: 0x08,
      cursorTextureType: 0x0c,
      cursorTextureWidth: 0x14,
      cursorTextureHeight: 0x18,
      // GameContext -> PartyContext -> current PartyInfo -> heroes Array.
      // Only owned HeroID/AgentID pairs cross the companion ABI.
      partyContext: 0x4c,
      playerParty: 0x54,
      partyHeroes: 0x24,
      heroMemberStride: 0x18,
      heroAgentId: 0x00,
      heroOwnerPlayerId: 0x04,
      heroId: 0x08,
      // Certified live against this build in an outpost, by cross-match
      // against the eight offsets above rather than by plausibility. See
      // plans/tools/hero-builds/evidence/party-memory-layout.md.
      heroLevel: 0x14,
      partyPlayers: 0x04,
      partyHenchmen: 0x14,
      partyFlag: 0x14,
      // GameContext::account and AccountContext::unlocked_account_skills.
      // GWCA exposes this exact array through GetIsSkillUnlocked: one bit per
      // skill id, account-wide and therefore usable by heroes.
      accountContext: 0x28,
      accountUnlockedSkills: 0x124,
      worldContext: 0x2c,
      // Its hero ids *and* agent ids matched the party array exactly.
      worldHeroFlags: 0x584,
      heroFlagStride: 0x24,
      flagHeroId: 0x00,
      flagAgentId: 0x04,
      flagBehavior: 0x0c,
      // The account's unlock table, not the party: its row count held at two
      // across kicking both heroes and re-adding one. `infoAgentId` is zero
      // while a hero is unlocked but out of the party and the live agent id
      // while it is in, so one array answers ownership and membership both.
      worldHeroInfo: 0x594,
      heroInfoStride: 0x9c,
      infoHeroId: 0x00,
      infoAgentId: 0x04,
      infoLevel: 0x08,
      infoPrimary: 0x0c,
      infoSecondary: 0x10,
      // Zero for every non-mercenary observed, as the reference describes. The
      // mercenary rule itself is untestable on an account that owns none, so
      // the kernel publishes mercenaries as *unknown* rather than guessing.
      infoAppearanceBitmap: 0x48,
      worldSkillbars: 0x6f0,
      skillbarStride: 0xbc,
      skillbarAgentId: 0x00,
      skillbarSkills: 0x04,
      skillSlotStride: 0x14,
      skillSlotId: 0x0c,
      skillbarDisabled: 0xa4,
      // Certified live in the same outpost. The stride is proved outright: the
      // words at +0x43c from each row are the next row's agent id. Every real
      // entry satisfies `index == id`, and the set of entries present is each
      // character's primary profession's attributes plus all but one of its
      // secondary's — the one missing is always that secondary's own primary
      // attribute, which no character may invest in. Three rows, three
      // professions pairs, no exception.
      worldAttributes: 0xac,
      attributeStride: 0x43c,
      attributeAgentId: 0x00,
      attributeEntries: 0x04,
      attributeEntryStride: 0x14,
      attributeEntryId: 0x00,
      // `level_base`. `level` at 0x08 adds runes, and a stored build holds the
      // invested rank — Devona reads Strength 7 there and 8 with her rune.
      attributeEntryRank: 0x04,
      // Exact-build initialised `AreaInfo[mapId]`. Cross-checked against
      // GWToolbox++'s flags: Lion's Arch (55) is PvE, Random Arenas (188)
      // carries the PvP bit, and Isle of Wurms (529) the guild-hall bit.
      areaInfo: 0x1cc630,
      areaInfoCount: 883,
      areaInfoStride: 0x7c,
      areaInfoFlags: 0x10,
    }),
  }),
]);

export function findEnhancementBuild(sha256: string): KnownEnhancementBuild | null {
  return ENHANCEMENT_BUILDS.find((build) => build.sha256 === sha256) ?? null;
}
