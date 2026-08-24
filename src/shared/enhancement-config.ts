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
  skillSlotRecharge: number;
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

export type EnhancementPlayRegionLayout = Pick<EnhancementLayout,
  | "contextRoot" | "gameContextSlot" | "characterContext" | "mapId"
  | "isExplorable" | "currentMapId" | "currentInstanceType" | "playerNumber"
  | "areaInfo" | "areaInfoCount" | "areaInfoStride" | "areaInfoFlags"
>;
export type EnhancementObservationBaseLayout = EnhancementPlayRegionLayout & Pick<
  EnhancementLayout,
  | "agentArray" | "agentId" | "agentX" | "agentY" | "agentType"
  | "agentPlayerNumber" | "agentModelType"
  | "worldContext"
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
export type EnhancementSkillSlotGeometryLayout = Pick<EnhancementLayout,
  | "frameArray" | "frameCount" | "frameBytes" | "frameChildOffsetId"
  | "frameId" | "framePositionFlags" | "frameViewportWidth"
  | "frameViewportHeight" | "frameScreenLeft" | "frameScreenBottom"
  | "frameScreenRight" | "frameScreenTop" | "frameRelation" | "frameState"
>;
export type EnhancementSkillCooldownLayout = Pick<EnhancementLayout,
  | "skillSlotRecharge"
>;
export type EnhancementPlayerSkillbarLayout = Pick<EnhancementLayout,
  | "worldSkillbars" | "skillbarStride" | "skillbarAgentId"
  | "skillbarSkills" | "skillSlotStride"
>;
export type EnhancementPartySkillbarLayout = Pick<EnhancementLayout,
  | "skillSlotId" | "skillbarDisabled"
>;
export type EnhancementPartyLayout = Pick<EnhancementLayout,
  | "partyContext" | "playerParty" | "partyHeroes" | "heroMemberStride"
  | "heroAgentId" | "heroOwnerPlayerId" | "heroId" | "heroLevel"
  | "partyPlayers" | "partyHenchmen" | "partyFlag" | "accountContextSlot"
  | "accountUnlockedSkills" | "worldHeroFlags" | "heroFlagStride"
  | "flagHeroId" | "flagAgentId" | "flagBehavior" | "worldHeroInfo"
  | "heroInfoStride" | "infoHeroId" | "infoAgentId" | "infoLevel"
  | "infoPrimary" | "infoSecondary" | "infoAppearanceBitmap"
  | "worldAttributes" | "attributeStride" | "attributeAgentId"
  | "attributeEntries" | "attributeEntryStride" | "attributeEntryId"
  | "attributeEntryRank" | "worldProfessionStates"
  | "professionStateStride" | "worldCharacterSkills"
>;

type Owner = "play-region" | "observation" | "target" | "cursor" | "party" | "storage"
  | "player-skillbar" | "party-skillbar" | "skill-slots" | "skill-cooldown";
type ConfigField =
  | Readonly<{
    source: "layout";
    owner: "play-region";
    key: keyof EnhancementPlayRegionLayout;
  }>
  | Readonly<{
    source: "layout";
    owner: "observation";
    key: keyof EnhancementObservationBaseLayout;
  }>
  | Readonly<{ source: "layout"; owner: "target"; key: keyof EnhancementTargetLayout }>
  | Readonly<{ source: "layout"; owner: "cursor"; key: keyof EnhancementCursorLayout }>
  | Readonly<{ source: "layout"; owner: "party"; key: keyof EnhancementPartyLayout }>
  | Readonly<{
    source: "layout";
    owner: "player-skillbar";
    key: keyof EnhancementPlayerSkillbarLayout;
  }>
  | Readonly<{
    source: "layout";
    owner: "party-skillbar";
    key: keyof EnhancementPartySkillbarLayout;
  }>
  | Readonly<{ source: "layout"; owner: "storage"; key: keyof EnhancementStorageLayout }>
  | Readonly<{
    source: "layout";
    owner: "skill-slots";
    key: keyof EnhancementSkillSlotGeometryLayout;
  }>
  | Readonly<{
    source: "layout";
    owner: "skill-cooldown";
    key: keyof EnhancementSkillCooldownLayout;
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
const playRegion = (
  ...keys: readonly (keyof EnhancementPlayRegionLayout)[]
): readonly ConfigField[] => keys.map((key) => ({
  source: "layout", key, owner: "play-region",
}));
const target = (
  ...keys: readonly (keyof EnhancementTargetLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "target" }));
const cursor = (
  ...keys: readonly (keyof EnhancementCursorLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "cursor" }));
const party = (
  ...keys: readonly (keyof EnhancementPartyLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "party" }));
const playerSkillbar = (
  ...keys: readonly (keyof EnhancementPlayerSkillbarLayout)[]
): readonly ConfigField[] => keys.map((key) => ({
  source: "layout", key, owner: "player-skillbar",
}));
const partySkillbar = (
  ...keys: readonly (keyof EnhancementPartySkillbarLayout)[]
): readonly ConfigField[] => keys.map((key) => ({
  source: "layout", key, owner: "party-skillbar",
}));
const storage = (
  ...keys: readonly (keyof EnhancementStorageLayout)[]
): readonly ConfigField[] => keys.map((key) => ({ source: "layout", key, owner: "storage" }));
const skillSlots = (
  ...keys: readonly (keyof EnhancementSkillSlotGeometryLayout)[]
): readonly ConfigField[] => keys.map((key) => ({
  source: "layout", key, owner: "skill-slots",
}));
const skillCooldown = (
  ...keys: readonly (keyof EnhancementSkillCooldownLayout)[]
): readonly ConfigField[] => keys.map((key) => ({
  source: "layout", key, owner: "skill-cooldown",
}));

export const ENHANCEMENT_CONFIG_FIELDS = Object.freeze([
  ...playRegion("contextRoot"),
  ...observation("agentArray"),
  ...target("manualTargetAgentId", "automaticTargetAgentId"),
  ...playRegion(
    "gameContextSlot", "characterContext", "mapId", "isExplorable",
    "currentMapId", "currentInstanceType", "playerNumber",
  ),
  ...observation("agentId"),
  ...observation("agentX", "agentY", "agentType"),
  ...observation("agentPlayerNumber", "agentModelType"),
  ...cursor("cursorActiveArt", "cursorSoftwareModel", "cursorShowCount", "cursorColorBuffer", "cursorArtHotspot", "cursorArtTexture", "cursorHandleKey", "cursorHandleObject", "cursorViewTexture", "cursorTextureType", "cursorTextureWidth", "cursorTextureHeight"),
  ...party("partyContext", "playerParty", "partyHeroes", "heroMemberStride", "heroAgentId", "heroOwnerPlayerId", "heroId", "heroLevel", "partyPlayers", "partyHenchmen", "partyFlag", "accountContextSlot", "accountUnlockedSkills"),
  ...observation("worldContext"),
  ...party("worldHeroFlags", "heroFlagStride", "flagHeroId", "flagAgentId", "flagBehavior", "worldHeroInfo", "heroInfoStride", "infoHeroId", "infoAgentId", "infoLevel", "infoPrimary", "infoSecondary", "infoAppearanceBitmap"),
  ...playerSkillbar(
    "worldSkillbars", "skillbarStride", "skillbarAgentId",
    "skillbarSkills", "skillSlotStride",
  ),
  ...partySkillbar("skillSlotId", "skillbarDisabled"),
  ...party("worldAttributes", "attributeStride", "attributeAgentId", "attributeEntries", "attributeEntryStride", "attributeEntryId", "attributeEntryRank"),
  ...playRegion("areaInfo", "areaInfoCount", "areaInfoStride", "areaInfoFlags"),
  ...party("worldProfessionStates", "professionStateStride", "worldCharacterSkills"),
  ...storage("worldPlayers", "playerRecordStride", "playerRecordAgentId", "playerRecordAccessFlags", "playerRecordNumber", "areaInfoType"),
  ...skillSlots(
    "frameArray", "frameCount", "frameBytes", "frameChildOffsetId", "frameId",
    "framePositionFlags", "frameViewportWidth", "frameViewportHeight",
    "frameScreenLeft", "frameScreenBottom", "frameScreenRight", "frameScreenTop",
    "frameRelation", "frameState",
  ),
  ...skillCooldown("skillSlotRecharge"),
  { source: "dispatcher", key: "playerChatMessage", owner: "party" },
  { source: "dispatcher", key: "hideHeroPanelMessage", owner: "party" },
  { source: "dispatcher", key: "showHeroPanelMessage", owner: "party" },
  ...Array.from({ length: 10 }, (_, index): ConfigField => ({ source: "party-dirty", index, owner: "party" })),
] as const satisfies readonly ConfigField[]);

export const ENHANCEMENT_LAYOUT_FIELDS = Object.freeze(
  ENHANCEMENT_CONFIG_FIELDS.flatMap((field) => field.source === "layout" ? [field.key] : []),
) as readonly (keyof EnhancementLayout)[];

type ConfiguredLayoutKey = Extract<
  (typeof ENHANCEMENT_CONFIG_FIELDS)[number],
  { source: "layout" }
>["key"];
type LayoutOwnershipIsExhaustive =
  Exclude<keyof EnhancementLayout, ConfiguredLayoutKey> extends never
    ? Exclude<ConfiguredLayoutKey, keyof EnhancementLayout> extends never
      ? true
      : false
    : false;
/** Compile-time guard: every layout field must have a declared config owner. */
export const ENHANCEMENT_LAYOUT_OWNERSHIP_IS_EXHAUSTIVE:
  LayoutOwnershipIsExhaustive = true;

export const ENHANCEMENT_LAYOUT_WORD_COUNT = ENHANCEMENT_LAYOUT_FIELDS.length;
export const ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT = ENHANCEMENT_CONFIG_FIELDS
  .filter((field) => field.source === "party-dirty").length;
export const ENHANCEMENT_CONFIG_WORD_COUNT = ENHANCEMENT_CONFIG_FIELDS.length;

export type EnhancementConfigOwner = Owner;
