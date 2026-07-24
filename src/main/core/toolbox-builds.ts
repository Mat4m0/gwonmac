export interface ToolboxLayout {
  contextRoot: number;
  agentArray: number;
  targetAgentId: number;
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

// Canonical support manifest. Every value is verified against the exact
// official client hash before a derived module is selected.
export const TOOLBOX_BUILDS: readonly KnownToolboxBuild[] = Object.freeze([
  Object.freeze({
    sha256: "b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483",
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
      targetAgentId: 0x5a1664,
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
    }),
  }),
]);

export function findToolboxBuild(sha256: string): KnownToolboxBuild | null {
  return TOOLBOX_BUILDS.find((build) => build.sha256 === sha256) ?? null;
}
