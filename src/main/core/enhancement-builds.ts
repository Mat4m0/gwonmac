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
  areaInfoBase: number;
  playerNumber: number;
  partyContext: number;
  playerParty: number;
  partyHeroes: number;
  heroMemberStride: number;
  heroAgentId: number;
  heroOwnerPlayerId: number;
  heroId: number;
  worldContext: number;
  worldAttributes: number;
  partyAttributeStride: number;
  partyAttributeAgentId: number;
  partyAttributeValues: number;
  attributeStride: number;
  attributeId: number;
  attributeBaseRank: number;
  worldHeroFlags: number;
  heroFlagStride: number;
  heroFlagHeroId: number;
  heroFlagAgentId: number;
  heroFlagBehavior: number;
  worldProfessionStates: number;
  professionStateStride: number;
  professionStateAgentId: number;
  professionStatePrimary: number;
  professionStateSecondary: number;
  worldSkillbars: number;
  skillbarStride: number;
  skillbarAgentId: number;
  skillbarSkills: number;
  skillStride: number;
  skillId: number;
  skillbarDisabled: number;
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
  partyPlayers: number;
  playerMemberStride: number;
  partyHenchmen: number;
  henchmanMemberStride: number;
  heroMemberLevel: number;
  worldHeroInfo: number;
  heroInfoStride: number;
  heroInfoHeroId: number;
  heroInfoLevel: number;
  heroInfoPrimary: number;
  heroInfoSecondary: number;
  agentLevel: number;
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
  "areaInfoBase",
  "playerNumber",
  "partyContext",
  "playerParty",
  "partyHeroes",
  "heroMemberStride",
  "heroAgentId",
  "heroOwnerPlayerId",
  "heroId",
  "worldContext",
  "worldAttributes",
  "partyAttributeStride",
  "partyAttributeAgentId",
  "partyAttributeValues",
  "attributeStride",
  "attributeId",
  "attributeBaseRank",
  "worldHeroFlags",
  "heroFlagStride",
  "heroFlagHeroId",
  "heroFlagAgentId",
  "heroFlagBehavior",
  "worldProfessionStates",
  "professionStateStride",
  "professionStateAgentId",
  "professionStatePrimary",
  "professionStateSecondary",
  "worldSkillbars",
  "skillbarStride",
  "skillbarAgentId",
  "skillbarSkills",
  "skillStride",
  "skillId",
  "skillbarDisabled",
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
  "partyPlayers",
  "playerMemberStride",
  "partyHenchmen",
  "henchmanMemberStride",
  "heroMemberLevel",
  "worldHeroInfo",
  "heroInfoStride",
  "heroInfoHeroId",
  "heroInfoLevel",
  "heroInfoPrimary",
  "heroInfoSecondary",
  "agentLevel",
] as const satisfies readonly (keyof EnhancementLayout)[];

export function enhancementLayoutWords(layout: EnhancementLayout): number[] {
  return ENHANCEMENT_LAYOUT_FIELDS.map((field) => layout[field]);
}

export interface KnownEnhancementBuild {
  sha256: string;
  programId: number;
  buildId: number;
  hookFunction: number;
  hookParams: readonly ["i32"];
  hookResults: readonly [];
  tableSlot: number;
  heroAddDispatchFunction: number;
  heroKickDispatchFunction: number;
  difficultyDispatchFunction: number;
  secondaryProfessionDispatchFunction: number;
  attributeDispatchFunction: number;
  skillbarDispatchFunction: number;
  heroBehaviorDispatchFunction: number;
  heroSkillToggleDispatchFunction: number;
  uiMessageDispatchFunction: number;
  layout: EnhancementLayout;
}

// Canonical support manifest. Every value is verified against the exact input
// hash before a derived module is selected.
//
// The input is the template-save client, not the raw official module: that
// transform is the floor every launch lands on, and the Enhancement transform is
// layered on top so opting in never costs template save/load. It only appends
// functions, so the main-loop index, the free table slot and every data address
// below are the ones certified against official build 38771
// (b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483).
export const ENHANCEMENT_BUILDS: readonly KnownEnhancementBuild[] =
  Object.freeze([
    Object.freeze({
      sha256:
        "68c6e09cec0f6992058a44a5617ca9eac7fab4697be1421943bbf664e6d444f6",
      programId: 1,
      buildId: 38771,
      // ArenaNet's exported browser-driven client loop. The older GWCA
      // FrApi/LeaveGameThread anchor (#6656) runs only during startup here.
      hookFunction: 446,
      hookParams: Object.freeze(["i32"] as const),
      hookResults: Object.freeze([] as const),
      tableSlot: 0,
      // ChCliApi #9159/#9160 are the property-context wrappers for add/kick.
      // They validate a HeroID and forward to the adjacent context-free message
      // dispatchers below. The transform re-validates both exact signatures.
      heroAddDispatchFunction: 6883,
      heroKickDispatchFunction: 6884,
      // Party difficulty wrapper #9184 is a direct one-call veneer over this
      // context-free dispatcher. PartyContext::flag bit 0x10 acknowledges it.
      difficultyDispatchFunction: 6885,
      secondaryProfessionDispatchFunction: 6914,
      attributeDispatchFunction: 6870,
      skillbarDispatchFunction: 6940,
      heroBehaviorDispatchFunction: 6875,
      heroSkillToggleDispatchFunction: 6878,
      // Context-free SendUIMessage(msg, wParam, lParam). Production never
      // exports this generic function: the transform appends one wrapper that
      // can emit only ShowHeroPanel/HideHeroPanel for a checked HeroID.
      uiMessageDispatchFunction: 6839,
      layout: Object.freeze({
        contextRoot: 0x5a0e20,
        agentArray: 0x5a4d98,
        // AvSelectGetTarget (#7335) returns manual when non-zero, otherwise
        // automatic. Keep that exact selection rule in the companion.
        manualTargetAgentId: 0x5a388c,
        automaticTargetAgentId: 0x5a3888,
        gameContextSlot: 6,
        characterContext: 0x44,
        mapId: 0x198,
        isExplorable: 0x19c,
        currentMapId: 0x234,
        currentInstanceType: 0x23c,
        // ConstAreaInfoGet (#17521) is `base + mapId * 124` after checking
        // mapId < 888. AreaInfo::flags is the u32 at +0x10.
        areaInfoBase: 0x1cc570,
        playerNumber: 0x2ac,
        // GameContext -> PartyContext -> current PartyInfo -> heroes Array.
        // HeroPartyMember is 24 bytes: AgentID +0, owner login number +4,
        // HeroID +8.
        // These fields are read-only and are used to acknowledge team commands.
        partyContext: 0x4c,
        playerParty: 0x54,
        partyHeroes: 0x24,
        heroMemberStride: 0x18,
        heroAgentId: 0x00,
        heroOwnerPlayerId: 0x04,
        heroId: 0x08,
        // GameContext -> WorldContext and the four bounded build-state arrays.
        // Their record layouts come from the same client structures used by
        // GWCA. The kernel joins every row back to a roster AgentID and publishes
        // no pointers or unrelated world state.
        worldContext: 0x2c,
        worldAttributes: 0x00ac,
        partyAttributeStride: 0x43c,
        partyAttributeAgentId: 0x00,
        partyAttributeValues: 0x04,
        attributeStride: 0x14,
        attributeId: 0x00,
        attributeBaseRank: 0x04,
        worldHeroFlags: 0x0584,
        heroFlagStride: 0x24,
        heroFlagHeroId: 0x00,
        heroFlagAgentId: 0x04,
        heroFlagBehavior: 0x0c,
        worldProfessionStates: 0x06bc,
        professionStateStride: 0x14,
        professionStateAgentId: 0x00,
        professionStatePrimary: 0x04,
        professionStateSecondary: 0x08,
        worldSkillbars: 0x06f0,
        skillbarStride: 0xbc,
        skillbarAgentId: 0x00,
        skillbarSkills: 0x04,
        skillStride: 0x14,
        skillId: 0x0c,
        skillbarDisabled: 0xa4,
        agentId: 0x2c,
        agentX: 0x74,
        agentY: 0x78,
        agentType: 0x9c,
        agentPlayerNumber: 0xf4,
        agentModelType: 0xf6,
        // Live-probe confirmed for build 38771. The game decodes the active
        // cursor into these fixed buffers on every change and then calls an
        // empty Emscripten sink. cursorColorBuffer is 32x32 BGRA, pitch 128;
        // its own alpha already matches the redundant A8 mask.
        cursorActiveArt: 0x5a1620,
        cursorSoftwareModel: 0x5a1624,
        cursorShowCount: 0x5a1628,
        cursorColorBuffer: 0x298d90,
        cursorArtHotspot: 0x00,
        cursorArtTexture: 0x0c,
        cursorHandleKey: 0x08,
        cursorHandleObject: 0x00,
        cursorViewTexture: 0x08,
        cursorTextureType: 0x0c,
        cursorTextureWidth: 0x14,
        cursorTextureHeight: 0x18,
        // PartyInfo owns three independent arrays. Capacity preflight counts
        // players, henchmen, and every owner's heroes before changing ours.
        partyPlayers: 0x04,
        playerMemberStride: 0x0c,
        partyHenchmen: 0x14,
        henchmanMemberStride: 0x34,
        heroMemberLevel: 0x14,
        // WorldContext::hero_info exists in outposts and is the client-owned
        // available-hero roster used by Toolbox's IsHeroUnlocked. HeroInfo is
        // 0x9c bytes; only identity, level, and professions are read. An
        // absent mercenary stays unsupported because assignment is
        // account/name-specific and this boundary does not read names.
        worldHeroInfo: 0x0594,
        heroInfoStride: 0x9c,
        heroInfoHeroId: 0x00,
        heroInfoLevel: 0x08,
        heroInfoPrimary: 0x0c,
        heroInfoSecondary: 0x10,
        // AgentLiving::level is a byte. The player has no level field in
        // PlayerPartyMember, so preflight reads it from the already joined
        // player agent.
        agentLevel: 0x110,
      }),
    }),
  ]);

export function findEnhancementBuild(
  sha256: string,
): KnownEnhancementBuild | null {
  return ENHANCEMENT_BUILDS.find((build) => build.sha256 === sha256) ?? null;
}
