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
} from "../../shared/contracts.js";

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

export interface EnhancementLayout {
  contextRoot: number;
  agentArray: number;
  manualTargetAgentId: number;
  automaticTargetAgentId: number;
  gameContextSlot: number;
  characterContext: number;
  mapId: number;
  isExplorable: number;
  currentMapId: number;
  currentInstanceType: number;
  playerNumber: number;
  agentId: number;
  agentX: number;
  agentY: number;
  agentType: number;
  agentPlayerNumber: number;
  agentModelType: number;
  cursorActiveArt: number;
  cursorSoftwareModel: number;
  cursorShowCount: number;
  cursorColorBuffer: number;
  cursorArtHotspot: number;
  cursorArtTexture: number;
  cursorHandleKey: number;
  cursorHandleObject: number;
  cursorViewTexture: number;
  cursorTextureType: number;
  cursorTextureWidth: number;
  cursorTextureHeight: number;
  partyContext: number;
  playerParty: number;
  partyHeroes: number;
  heroMemberStride: number;
  heroAgentId: number;
  heroOwnerPlayerId: number;
  heroId: number;
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

export const ENHANCEMENT_CORE_LAYOUT_FIELDS = [
  "contextRoot",
  "agentArray",
  "manualTargetAgentId",
  "automaticTargetAgentId",
  "gameContextSlot",
  "characterContext",
  "mapId",
  "isExplorable",
  "currentMapId",
  "currentInstanceType",
  "playerNumber",
  "agentId",
  "agentX",
  "agentY",
  "agentType",
  "agentPlayerNumber",
  "agentModelType",
] as const satisfies readonly (keyof EnhancementLayout)[];

export const ENHANCEMENT_CURSOR_LAYOUT_FIELDS = [
  "cursorActiveArt",
  "cursorSoftwareModel",
  "cursorShowCount",
  "cursorColorBuffer",
  "cursorArtHotspot",
  "cursorArtTexture",
  "cursorHandleKey",
  "cursorHandleObject",
  "cursorViewTexture",
  "cursorTextureType",
  "cursorTextureWidth",
  "cursorTextureHeight",
] as const satisfies readonly (keyof EnhancementLayout)[];

export const ENHANCEMENT_PARTY_LAYOUT_FIELDS = [
  "partyContext",
  "playerParty",
  "partyHeroes",
  "heroMemberStride",
  "heroAgentId",
  "heroOwnerPlayerId",
  "heroId",
] as const satisfies readonly (keyof EnhancementLayout)[];

export const ENHANCEMENT_LAYOUT_FIELDS = [
  ...ENHANCEMENT_CORE_LAYOUT_FIELDS,
  ...ENHANCEMENT_CURSOR_LAYOUT_FIELDS,
  ...ENHANCEMENT_PARTY_LAYOUT_FIELDS,
] as const satisfies readonly (keyof EnhancementLayout)[];

export function enhancementLayoutWords(layout: EnhancementLayout): number[] {
  return ENHANCEMENT_LAYOUT_FIELDS.map((field) => layout[field]);
}

export function enhancementConfigWords(
  build: KnownEnhancementBuild,
  capabilities: EnhancementCapabilities,
): number[] {
  const words = [
    ...ENHANCEMENT_LAYOUT_FIELDS.map((field) => build.layout[field]),
    build.uiDispatcher.playerChatMessage,
    build.uiDispatcher.hideHeroPanelMessage,
    build.uiDispatcher.showHeroPanelMessage,
    ...build.uiDispatcher.partyDirtyMessages,
  ];
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
    outputSha256: Object.freeze({
      cursor: "a29b20f64cffff774b554787bf595a6aa8a6d56ff25e66ee73bf944cff5a1da3",
      target: "d2b6970f61026b48f01defd4fbb59032544c27c89684abffed77987b06292f11",
      cursorTarget: "63a330bc7b922ce2432298e8b6f30eb2e4940a218acc999c243c1b0653b28997",
      cursorToolbox: "8ba7836b7d27d9a9e31cd85359b2964d5c88b4f577ea3648fb874155fec6da70",
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
    }),
  }),
]);

export function findEnhancementBuild(sha256: string): KnownEnhancementBuild | null {
  return ENHANCEMENT_BUILDS.find((build) => build.sha256 === sha256) ?? null;
}
