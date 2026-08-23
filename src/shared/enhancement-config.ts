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
  accountContextSlot: number;
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
  worldPlayers: number;
  playerRecordStride: number;
  playerRecordAgentId: number;
  playerRecordAccessFlags: number;
  playerRecordNumber: number;
  areaInfoType: number;
  frameArray: number;
  frameCount: number;
  frameBytes: number;
  frameChildOffsetId: number;
  frameId: number;
  framePositionFlags: number;
  frameViewportWidth: number;
  frameViewportHeight: number;
  frameScreenLeft: number;
  frameScreenBottom: number;
  frameScreenRight: number;
  frameScreenTop: number;
  frameRelation: number;
  frameState: number;
}

export type EnhancementObservationBaseLayout = Pick<EnhancementLayout,
  | "contextRoot" | "gameContextSlot" | "characterContext" | "mapId"
  | "isExplorable" | "currentMapId" | "currentInstanceType" | "playerNumber"
  | "agentArray" | "agentId" | "agentX" | "agentY" | "agentType"
  | "agentPlayerNumber" | "agentModelType"
  | "worldContext" | "areaInfo" | "areaInfoCount" | "areaInfoStride"
  | "areaInfoFlags"
>;
export type EnhancementTargetLayout = Pick<EnhancementLayout,
  | "manualTargetAgentId" | "automaticTargetAgentId"
>;
export type EnhancementCursorLayout = Pick<EnhancementLayout,
  | "cursorActiveArt" | "cursorSoftwareModel" | "cursorShowCount"
  | "cursorColorBuffer" | "cursorArtHotspot" | "cursorArtTexture"
  | "cursorHandleKey" | "cursorHandleObject" | "cursorViewTexture"
  | "cursorTextureType" | "cursorTextureWidth" | "cursorTextureHeight"
>;
export type EnhancementStorageLayout = Pick<EnhancementLayout,
  | "worldPlayers" | "playerRecordStride" | "playerRecordAgentId"
  | "playerRecordAccessFlags" | "playerRecordNumber" | "areaInfoType"
>;
export type EnhancementSkillKeyOverlayLayout = Pick<EnhancementLayout,
  | "frameArray" | "frameCount" | "frameBytes" | "frameChildOffsetId"
  | "frameId" | "framePositionFlags" | "frameViewportWidth"
  | "frameViewportHeight" | "frameScreenLeft" | "frameScreenBottom"
  | "frameScreenRight" | "frameScreenTop" | "frameRelation" | "frameState"
>;
export type EnhancementPartyLayout = Omit<EnhancementLayout,
  keyof EnhancementObservationBaseLayout | keyof EnhancementTargetLayout
  | keyof EnhancementCursorLayout | keyof EnhancementStorageLayout
  | keyof EnhancementSkillKeyOverlayLayout
>;

type Owner = "observation" | "target" | "cursor" | "party" | "storage"
  | "skill-overlay";
type ConfigField =
  | Readonly<{
    source: "layout";
    owner: "observation";
    key: keyof EnhancementObservationBaseLayout;
  }>
  | Readonly<{ source: "layout"; owner: "target"; key: keyof EnhancementTargetLayout }>
  | Readonly<{ source: "layout"; owner: "cursor"; key: keyof EnhancementCursorLayout }>
  | Readonly<{ source: "layout"; owner: "party"; key: keyof EnhancementPartyLayout }>
  | Readonly<{ source: "layout"; owner: "storage"; key: keyof EnhancementStorageLayout }>
  | Readonly<{
    source: "layout";
    owner: "skill-overlay";
    key: keyof EnhancementSkillKeyOverlayLayout;
  }>
  | Readonly<{
    source: "dispatcher";
    key: "playerChatMessage" | "hideHeroPanelMessage" | "showHeroPanelMessage";
    owner: "party";
  }>
  | Readonly<{ source: "party-dirty"; index: number; owner: "party" }>;

const observation = (
  ...keys: readonly (keyof EnhancementObservationBaseLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "observation" }));
const target = (
  ...keys: readonly (keyof EnhancementTargetLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "target" }));
const cursor = (
  ...keys: readonly (keyof EnhancementCursorLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "cursor" }));
const party = (
  ...keys: readonly (keyof EnhancementPartyLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "party" }));
const storage = (
  ...keys: readonly (keyof EnhancementStorageLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "storage" }));
const skillOverlay = (
  ...keys: readonly (keyof EnhancementSkillKeyOverlayLayout)[]
): readonly ConfigField[] => keys.map((key) => ({
  source: "layout", key, owner: "skill-overlay",
}));

export const ENHANCEMENT_CONFIG_FIELDS = Object.freeze([
  ...observation("contextRoot", "agentArray"),
  ...target("manualTargetAgentId", "automaticTargetAgentId"),
  ...observation("gameContextSlot", "characterContext", "mapId", "isExplorable", "currentMapId", "currentInstanceType", "playerNumber", "agentId"),
  ...observation("agentX", "agentY", "agentType"),
  ...observation("agentPlayerNumber", "agentModelType"),
  ...cursor("cursorActiveArt", "cursorSoftwareModel", "cursorShowCount", "cursorColorBuffer", "cursorArtHotspot", "cursorArtTexture", "cursorHandleKey", "cursorHandleObject", "cursorViewTexture", "cursorTextureType", "cursorTextureWidth", "cursorTextureHeight"),
  ...party("partyContext", "playerParty", "partyHeroes", "heroMemberStride", "heroAgentId", "heroOwnerPlayerId", "heroId", "heroLevel", "partyPlayers", "partyHenchmen", "partyFlag", "accountContextSlot", "accountUnlockedSkills"),
  ...observation("worldContext"),
  ...party("worldHeroFlags", "heroFlagStride", "flagHeroId", "flagAgentId", "flagBehavior", "worldHeroInfo", "heroInfoStride", "infoHeroId", "infoAgentId", "infoLevel", "infoPrimary", "infoSecondary", "infoAppearanceBitmap", "worldSkillbars", "skillbarStride", "skillbarAgentId", "skillbarSkills", "skillSlotStride", "skillSlotId", "skillbarDisabled", "worldAttributes", "attributeStride", "attributeAgentId", "attributeEntries", "attributeEntryStride", "attributeEntryId", "attributeEntryRank"),
  ...observation("areaInfo", "areaInfoCount", "areaInfoStride", "areaInfoFlags"),
  ...party("worldProfessionStates", "professionStateStride", "worldCharacterSkills"),
  ...storage("worldPlayers", "playerRecordStride", "playerRecordAgentId", "playerRecordAccessFlags", "playerRecordNumber", "areaInfoType"),
  ...skillOverlay(
    "frameArray", "frameCount", "frameBytes", "frameChildOffsetId", "frameId",
    "framePositionFlags", "frameViewportWidth", "frameViewportHeight",
    "frameScreenLeft", "frameScreenBottom", "frameScreenRight", "frameScreenTop",
    "frameRelation", "frameState",
  ),
  { source: "dispatcher", key: "playerChatMessage", owner: "party" },
  { source: "dispatcher", key: "hideHeroPanelMessage", owner: "party" },
  { source: "dispatcher", key: "showHeroPanelMessage", owner: "party" },
  ...Array.from({ length: 10 }, (_, index): ConfigField => ({ source: "party-dirty", index, owner: "party" })),
] as const satisfies readonly ConfigField[]);

export const ENHANCEMENT_LAYOUT_FIELDS = Object.freeze(
  ENHANCEMENT_CONFIG_FIELDS.flatMap((field) => field.source === "layout" ? [field.key] : []),
) as readonly (keyof EnhancementLayout)[];

export const ENHANCEMENT_LAYOUT_WORD_COUNT = ENHANCEMENT_LAYOUT_FIELDS.length;
export const ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT = ENHANCEMENT_CONFIG_FIELDS
  .filter((field) => field.source === "party-dirty").length;
export const ENHANCEMENT_CONFIG_WORD_COUNT = ENHANCEMENT_CONFIG_FIELDS.length;

export type EnhancementConfigOwner = Owner;
