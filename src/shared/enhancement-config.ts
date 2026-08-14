/**
 * The positional companion-config ABI. This tuple is the only source of truth
 * for field order, word counts, and capability activation.
 */
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
  heroLevel: number;
  partyPlayers: number;
  partyHenchmen: number;
  partyFlag: number;
  accountContext: number;
  accountUnlockedSkills: number;
  worldContext: number;
  worldHeroFlags: number;
  heroFlagStride: number;
  flagHeroId: number;
  flagAgentId: number;
  flagBehavior: number;
  worldHeroInfo: number;
  heroInfoStride: number;
  infoHeroId: number;
  infoAgentId: number;
  infoLevel: number;
  infoPrimary: number;
  infoSecondary: number;
  infoAppearanceBitmap: number;
  worldSkillbars: number;
  skillbarStride: number;
  skillbarAgentId: number;
  skillbarSkills: number;
  skillSlotStride: number;
  skillSlotId: number;
  skillbarDisabled: number;
  worldAttributes: number;
  attributeStride: number;
  attributeAgentId: number;
  attributeEntries: number;
  attributeEntryStride: number;
  attributeEntryId: number;
  attributeEntryRank: number;
  areaInfo: number;
  areaInfoCount: number;
  areaInfoStride: number;
  areaInfoFlags: number;
  worldProfessionStates: number;
  professionStateStride: number;
  worldCharacterSkills: number;
}

export type EnhancementCommonLayout = Pick<EnhancementLayout,
  | "contextRoot" | "gameContextSlot" | "characterContext" | "mapId"
  | "isExplorable" | "currentMapId" | "currentInstanceType" | "playerNumber"
>;
export type EnhancementTargetLayout = Pick<EnhancementLayout,
  | "agentArray" | "manualTargetAgentId" | "automaticTargetAgentId"
  | "agentId" | "agentX" | "agentY" | "agentType"
  | "agentPlayerNumber" | "agentModelType"
>;
export type EnhancementCursorLayout = Pick<EnhancementLayout,
  | "cursorActiveArt" | "cursorSoftwareModel" | "cursorShowCount"
  | "cursorColorBuffer" | "cursorArtHotspot" | "cursorArtTexture"
  | "cursorHandleKey" | "cursorHandleObject" | "cursorViewTexture"
  | "cursorTextureType" | "cursorTextureWidth" | "cursorTextureHeight"
>;
export type EnhancementPartyLayout = Omit<EnhancementLayout,
  keyof EnhancementCommonLayout | keyof EnhancementTargetLayout | keyof EnhancementCursorLayout
>;

type Activation = "target" | "target-or-party" | "cursor" | "party";
type ConfigField =
  | Readonly<{ source: "layout"; key: keyof EnhancementLayout; activation: Activation }>
  | Readonly<{ source: "dispatcher"; key: "playerChatMessage" | "hideHeroPanelMessage" | "showHeroPanelMessage"; activation: "party" }>
  | Readonly<{ source: "party-dirty"; index: number; activation: "party" }>;

const layout = (
  activation: Activation,
  ...keys: readonly (keyof EnhancementLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, activation }));

export const ENHANCEMENT_CONFIG_FIELDS = Object.freeze([
  ...layout("target-or-party", "contextRoot"),
  ...layout("target", "agentArray", "manualTargetAgentId", "automaticTargetAgentId"),
  ...layout("target-or-party", "gameContextSlot", "characterContext", "mapId", "isExplorable", "currentMapId", "currentInstanceType", "playerNumber"),
  ...layout("target", "agentId", "agentX", "agentY", "agentType", "agentPlayerNumber", "agentModelType"),
  ...layout("cursor", "cursorActiveArt", "cursorSoftwareModel", "cursorShowCount", "cursorColorBuffer", "cursorArtHotspot", "cursorArtTexture", "cursorHandleKey", "cursorHandleObject", "cursorViewTexture", "cursorTextureType", "cursorTextureWidth", "cursorTextureHeight"),
  ...layout("party", "partyContext", "playerParty", "partyHeroes", "heroMemberStride", "heroAgentId", "heroOwnerPlayerId", "heroId", "heroLevel", "partyPlayers", "partyHenchmen", "partyFlag", "accountContext", "accountUnlockedSkills", "worldContext", "worldHeroFlags", "heroFlagStride", "flagHeroId", "flagAgentId", "flagBehavior", "worldHeroInfo", "heroInfoStride", "infoHeroId", "infoAgentId", "infoLevel", "infoPrimary", "infoSecondary", "infoAppearanceBitmap", "worldSkillbars", "skillbarStride", "skillbarAgentId", "skillbarSkills", "skillSlotStride", "skillSlotId", "skillbarDisabled", "worldAttributes", "attributeStride", "attributeAgentId", "attributeEntries", "attributeEntryStride", "attributeEntryId", "attributeEntryRank", "areaInfo", "areaInfoCount", "areaInfoStride", "areaInfoFlags", "worldProfessionStates", "professionStateStride", "worldCharacterSkills"),
  { source: "dispatcher", key: "playerChatMessage", activation: "party" },
  { source: "dispatcher", key: "hideHeroPanelMessage", activation: "party" },
  { source: "dispatcher", key: "showHeroPanelMessage", activation: "party" },
  ...Array.from({ length: 10 }, (_, index): ConfigField => ({ source: "party-dirty", index, activation: "party" })),
] as const satisfies readonly ConfigField[]);

export const ENHANCEMENT_LAYOUT_FIELDS = Object.freeze(
  ENHANCEMENT_CONFIG_FIELDS.flatMap((field) => field.source === "layout" ? [field.key] : []),
) as readonly (keyof EnhancementLayout)[];

export const ENHANCEMENT_LAYOUT_WORD_COUNT = ENHANCEMENT_LAYOUT_FIELDS.length;
export const ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT = ENHANCEMENT_CONFIG_FIELDS
  .filter((field) => field.source === "party-dirty").length;
export const ENHANCEMENT_CONFIG_WORD_COUNT = ENHANCEMENT_CONFIG_FIELDS.length;

export type EnhancementConfigActivation = Activation;
