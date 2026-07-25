export interface ToolboxLayout {
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
}

export const TOOLBOX_LAYOUT_FIELDS = [
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
] as const satisfies readonly (keyof ToolboxLayout)[];

export function toolboxLayoutWords(layout: ToolboxLayout): number[] {
  return TOOLBOX_LAYOUT_FIELDS.map((field) => layout[field]);
}

export interface KnownToolboxBuild {
  sha256: string;
  programId: number;
  buildId: number;
  hookFunction: number;
  hookParams: readonly ["i32"];
  hookResults: readonly [];
  tableSlot: number;
  layout: ToolboxLayout;
}

// Canonical support manifest. Every value is verified against the exact input
// hash before a derived module is selected.
//
// The input is the template-save client, not the raw official module: that
// transform is the floor every launch lands on, and the Toolbox transform is
// layered on top so opting in never costs template save/load. It only appends
// functions, so the main-loop index, the free table slot and every data address
// below are the ones certified against official build 38771
// (b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483).
export const TOOLBOX_BUILDS: readonly KnownToolboxBuild[] = Object.freeze([
  Object.freeze({
    sha256: "68c6e09cec0f6992058a44a5617ca9eac7fab4697be1421943bbf664e6d444f6",
    programId: 1,
    buildId: 38771,
    // ArenaNet's exported browser-driven client loop. The older GWCA
    // FrApi/LeaveGameThread anchor (#6656) runs only during startup here.
    hookFunction: 446,
    hookParams: Object.freeze(["i32"] as const),
    hookResults: Object.freeze([] as const),
    tableSlot: 0,
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
      playerNumber: 0x2ac,
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
    }),
  }),
]);

export function findToolboxBuild(sha256: string): KnownToolboxBuild | null {
  return TOOLBOX_BUILDS.find((build) => build.sha256 === sha256) ?? null;
}
