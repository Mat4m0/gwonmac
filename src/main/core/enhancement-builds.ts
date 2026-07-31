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

export const ENHANCEMENT_LAYOUT_FIELDS = [
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
  "partyContext",
  "playerParty",
  "partyHeroes",
  "heroMemberStride",
  "heroAgentId",
  "heroOwnerPlayerId",
  "heroId",
] as const satisfies readonly (keyof EnhancementLayout)[];

export function enhancementLayoutWords(layout: EnhancementLayout): number[] {
  return ENHANCEMENT_LAYOUT_FIELDS.map((field) => layout[field]);
}

export function enhancementConfigWords(build: KnownEnhancementBuild): number[] {
  return [
    ...enhancementLayoutWords(build.layout),
    build.uiDispatcher.playerChatMessage,
    build.uiDispatcher.hideHeroPanelMessage,
    build.uiDispatcher.showHeroPanelMessage,
  ];
}

export interface KnownEnhancementBuild {
  sha256: string;
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
    playerChatProducer: number;
    playerChatSites: 3;
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
// functions, so the main-loop index, the free table slot and every data address
// below are certified separately for each exact template-save output. Unknown
// Enhancement builds remain off until another complete exact entry is added.
export const ENHANCEMENT_BUILDS: readonly KnownEnhancementBuild[] = Object.freeze([
  Object.freeze({
    sha256: "9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094",
    programId: 1,
    buildId: 38797,
    hookFunction: 446,
    hookParams: Object.freeze(["i32"] as const),
    hookResults: Object.freeze([] as const),
    tableSlot: 0,
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
      // ChCliApi #8947 contains three independent kPlayerChatMessage sites;
      // each directly calls #6842. Nearby ChCliApi producers #8942/#8945
      // emit 0x1000007f/0x10000080 to that same dispatcher.
      playerChatProducer: 8947,
      playerChatSites: 3,
      nearbyPlayerMessageProducers: Object.freeze([8942, 8945] as const),
    }),
    layout: Object.freeze({
      // Recovered independently. This root moved differently from the other
      // static data, which is why Enhancement never relocates unknown builds.
      contextRoot: 0x5a0ed4,
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
