import { createHash } from "node:crypto";
import type { EnhancementCapabilities } from "../../src/shared/enhancement-contracts.js";
import {
  type EnhancementOutputHashes,
  type KnownEnhancementBuild,
} from "../../src/main/certification/enhancement-builds.js";
import { ENHANCEMENT_MANIFEST_SECTION } from "../../src/main/certification/enhancement-transform.js";
import {
  parseCode,
  sectionById,
  sleb,
  splitSections,
} from "../../src/main/core/wasm-binary.js";

export const UNSUPPORTED_ALL_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  partyObservation: true,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const CURSOR_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const CURSOR_TARGET: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const TARGET_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: true,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const STORAGE_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: true,
  xunlaiAction: true,
  chatAliases: true,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const CURSOR_TOOLBOX: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  partyObservation: true,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const NO_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const CURSOR_TOOLBOX_COMMANDS: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  partyObservation: true,
  teamApply: true,
  travelAction: true,
  xunlaiAction: true,
  chatAliases: true,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const CURSOR_TARGET_TOOLBOX_COMMANDS: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  partyObservation: true,
  teamApply: true,
  travelAction: true,
  xunlaiAction: true,
  chatAliases: true,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const CURSOR_TOOLBOX_STORAGE: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  partyObservation: true,
  teamApply: false,
  travelAction: true,
  xunlaiAction: true,
  chatAliases: true,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
});
export const PARTY_DIRTY_MESSAGES = Object.freeze([
  0x1000_0038,
  0x1000_0039,
  0x1000_008c,
  0x1000_0098,
  0x1000_00c2,
  0x1000_0111,
  0x1000_011e,
  0x1000_011f,
  0x1000_0124,
  0x1000_0126,
] as const);

const PLACEHOLDER_OUTPUTS: EnhancementOutputHashes = Object.freeze({
  "features-01": "0".repeat(64),
  "features-02": "0".repeat(64),
  "features-03": "0".repeat(64),
  "features-04": "0".repeat(64),
  "features-05": "0".repeat(64),
  "features-06": "0".repeat(64),
  "features-07": "0".repeat(64),
  "features-0c": "0".repeat(64),
  "features-0d": "0".repeat(64),
  "features-0e": "0".repeat(64),
  "features-0f": "0".repeat(64),
  "features-70": "0".repeat(64),
  "features-74": "0".repeat(64),
  "features-75": "0".repeat(64),
  "features-76": "0".repeat(64),
  "features-77": "0".repeat(64),
  "features-7c": "0".repeat(64),
  "features-7d": "0".repeat(64),
  "features-7e": "0".repeat(64),
  "features-7f": "0".repeat(64),
});

function uleb(value: number): number[] {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}
function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

export function moduleWithManifest(value: unknown): WebAssembly.Module {
  const name = [...new TextEncoder().encode(ENHANCEMENT_MANIFEST_SECTION)];
  const payload = [...new TextEncoder().encode(JSON.stringify(value))];
  return new WebAssembly.Module(new Uint8Array([
    ...fixture(),
    ...section(0, [...uleb(name.length), ...name, ...payload]),
  ]));
}

// `hookParamType` is the WebAssembly value type of the main loop's single
// parameter: 0x7f is i32, the signature every certified build declares. A
// caller passes another one — 0x7e is i64 — to build the module a manifest
// does not certify, which is the only side the mismatch can come from: a
// KnownEnhancementBuild's hookParams is the literal ["i32"] and cannot say
// otherwise.
export function fixture(hookParamType = 0x7f): Uint8Array {
  const type = section(1, [
    6,
    0x60, 1, hookParamType, 0,
    0x60, 5, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0,
    0x60, 3, 0x7f, 0x7f, 0x7f, 0,
    0x60, 2, 0x7f, 0x7f, 0,
    0x60, 2, 0x7f, 0x7f, 1, 0x7f,
    0x60, 1, 0x7f, 1, 0x7f,
  ]);
  const env = [3, 101, 110, 118];
  const imports = section(2, [
    3,
    ...env, 1, 116, 0, 0,
    ...env, 1, 99, 0, 1,
    ...env, 1, 117, 0, 2,
  ]);
  // Fourteen defined functions: three hooks, three commands, the recurring
  // game-thread callback, packet sender, DataWindow, slash parser, and Travel
  // producer, plus three exact-signature Xunlai fact readers.
  const functions = section(3, [14, 0, 1, 2, 0, 2, 3, 3, 2, 0, 4, 1, 5, 5, 5]);
  const table = section(4, [1, 0x70, 1, 5, 5]);
  const memory = section(5, [1, 1, 1, 1]);
  const globals = section(6, [0]);
  const tableName = [...uleb(3), 116, 98, 108];
  const loopName = [...new TextEncoder().encode("EmscriptenExeThreadMainLoop")];
  const cursorName = [...new TextEncoder().encode("cursor")];
  const uiName = [...new TextEncoder().encode("ui")];
  const frameName = [...new TextEncoder().encode("frame")];
  const professionName = [...new TextEncoder().encode("profession")];
  const skillName = [...new TextEncoder().encode("skill")];
  const senderName = [...new TextEncoder().encode("sender")];
  const slashName = [...new TextEncoder().encode("slash")];
  const memoryName = [...new TextEncoder().encode("memory")];
  const exports = section(7, [
    10,
    ...tableName, 1, 0,
    ...uleb(memoryName.length), ...memoryName, 2, 0,
    ...uleb(loopName.length), ...loopName, 0, 3,
    ...uleb(cursorName.length), ...cursorName, 0, 4,
    ...uleb(uiName.length), ...uiName, 0, 5,
    ...uleb(frameName.length), ...frameName, 0, 8,
    ...uleb(professionName.length), ...professionName, 0, 9,
    ...uleb(skillName.length), ...skillName, 0, 7,
    ...uleb(senderName.length), ...senderName, 0, 10,
    ...uleb(slashName.length), ...slashName, 0, 12,
  ]);
  const mappedSegment = [0, 0x41, 1, 0x0b, 3, 4, 3, 5];
  const frameSegment = [0, 0x41, 4, 0x0b, 1, 8];
  const elements = section(9, [2, ...mappedSegment, ...frameSegment]);
  const tick = [0, 0x20, 0, 0x10, 0, 0x0b];
  const cursor = [
    0, 0x20, 0, 0x20, 1, 0x20, 2, 0x20, 3, 0x20, 4, 0x10, 1, 0x0b,
  ];
  const ui = [0, 0x20, 0, 0x20, 1, 0x20, 2, 0x10, 2, 0x0b];
  const command = [0, 0x41, 0, 0x1a, 0x20, 0, 0x10, 0, 0x0b];
  // A compact real-shape skill-bar builder: packet words are written at 128,
  // then handed to the shared sender unchanged.
  const pair = [
    0,
    0x41, ...sleb(128), 0x41, ...sleb(93), 0x36, 2, 0,
    0x41, ...sleb(128), 0x20, 0, 0x36, 2, 4,
    0x41, ...sleb(128), 0x20, 1, 0x36, 2, 8,
    ...Array.from({ length: 8 }, (_, index) => [
      0x41, ...sleb(128),
      0x20, 2, 0x28, 2, ...uleb(index * 4),
      0x36, 2, ...uleb(12 + index * 4),
    ]).flat(),
    0x41, ...sleb(999), 0x41, ...sleb(44), 0x41, ...sleb(128), 0x10, 10,
    0x0b,
  ];
  const frame = [0, 0x20, 0, 0x10, 0, 0x0b];
  const profession = [
    0,
    0x41, 0, 0x41, ...sleb(65), 0x36, 2, 0,
    0x41, 0, 0x20, 0, 0x36, 2, 4,
    0x41, 0, 0x20, 1, 0x36, 2, 8,
    0x41, 0xe7, 0x07, 0x41, 12, 0x41, 0, 0x10, 10,
    0x0b,
  ];
  const sender = [
    0, 0x20, 0, 0x20, 1, 0x20, 2, 0x10, 2, 0x0b,
  ];
  const dataWindow = [0, 0x20, 0, 0x10, 0, 0x0b];
  const slash = [0, 0x20, 0, 0x10, 0, 0x41, 0, 0x0b];
  const reader = [0, 0x20, 0, 0x0b];
  const code = section(10, [
    14,
    ...uleb(tick.length), ...tick,
    ...uleb(cursor.length), ...cursor,
    ...uleb(ui.length), ...ui,
    ...uleb(command.length), ...command,
    ...uleb(pair.length), ...pair,
    ...uleb(frame.length), ...frame,
    ...uleb(profession.length), ...profession,
    ...uleb(sender.length), ...sender,
    ...uleb(dataWindow.length), ...dataWindow,
    ...uleb(slash.length), ...slash,
    ...uleb(cursor.length), ...cursor,
    ...uleb(reader.length), ...reader,
    ...uleb(reader.length), ...reader,
    ...uleb(reader.length), ...reader,
  ]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...type, ...imports, ...functions, ...table, ...memory, ...globals, ...exports,
    ...elements, ...code,
  ]);
}

/** A fixture function body, as the transform will read it. */
export function commandBody(bytes: Uint8Array, index: number): Uint8Array {
  return parseCode(sectionById(splitSections(bytes), 10))[index]!;
}

export function manifest(bytes: Uint8Array): KnownEnhancementBuild {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    outputSha256: PLACEHOLDER_OUTPUTS,
    programId: 1,
    buildId: 1,
    hookFunction: 3,
    hookParams: ["i32"],
    hookResults: [],
    hookBodySha256: createHash("sha256").update(commandBody(bytes, 0)).digest("hex"),
    tableSlot: 5,
    xunlaiAction: {
      openExport: "enhancement_open_storage",
      configureExport: "enhancement_configure_storage",
      accessProof: {
        layout: {
          worldPlayers: 0x80c, playerRecordStride: 0x50,
          playerRecordAgentId: 0, playerRecordAccessFlags: 0x34,
          playerRecordNumber: 0x38, areaInfoType: 8,
        },
        readers: {
          "agent-id": { functionIndex: 14, params: ["i32"], results: ["i32"], bodySha256: createHash("sha256").update(commandBody(bytes, 11)).digest("hex") },
          "access-flags": { functionIndex: 15, params: ["i32"], results: ["i32"], bodySha256: createHash("sha256").update(commandBody(bytes, 12)).digest("hex") },
          "player-number": { functionIndex: 16, params: ["i32"], results: ["i32"], bodySha256: createHash("sha256").update(commandBody(bytes, 13)).digest("hex") },
        },
      },
      handler: {
          functionIndex: 11,
          params: ["i32"],
          results: [],
          bodySha256: createHash("sha256")
            .update(commandBody(bytes, 8))
            .digest("hex"),
      },
    },
    travelAction: {
      enqueueExport: "enhancement_travel",
      configureExport: "enhancement_configure_travel",
      toggleExport: "enhancement_take_travel_toggle",
      messageId: 0x1000_0183,
      producer: {
        functionIndex: 13,
        params: ["i32", "i32", "i32", "i32", "i32"],
        results: [],
        bodySha256: createHash("sha256")
          .update(commandBody(bytes, 10))
          .digest("hex"),
      },
      contextResolver: {
        functionIndex: 5,
        params: ["i32", "i32", "i32"],
        results: [],
        bodySha256: createHash("sha256")
          .update(commandBody(bytes, 2))
          .digest("hex"),
      },
    },
    chatAliases: {
      parser: {
          functionIndex: 12,
          params: ["i32", "i32"],
          results: ["i32"],
          bodySha256: createHash("sha256")
            .update(commandBody(bytes, 9))
            .digest("hex"),
      },
    },
    gameThread: {
      drain: {
        functionIndex: 8,
        params: ["i32", "i32"],
        results: [],
        tableSlot: 4,
        bodySha256: createHash("sha256")
          .update(commandBody(bytes, 5))
          .digest("hex"),
      },
    },
    teamApply: {
      thunkExport: "enhancement_command",
      professionTrace: {
        readerExport: "enhancement_profession_trace",
        sender: {
          functionIndex: 10,
          params: ["i32", "i32", "i32"],
          results: [],
          bodySha256: createHash("sha256")
            .update(commandBody(bytes, 7))
            .digest("hex"),
        },
      },
      entries: [{
        opcode: 31,
        functionIndex: 6,
        params: ["i32"],
        results: [],
        bodySha256: createHash("sha256")
          .update(commandBody(bytes, 3))
          .digest("hex"),
        label: "fixture command",
      }, {
        opcode: 93,
        functionIndex: 7,
        params: ["i32", "i32", "i32"],
        results: [],
        bodySha256: createHash("sha256")
          .update(commandBody(bytes, 4))
          .digest("hex"),
        label: "fixture pair command",
      }, {
        opcode: 65,
        functionIndex: 9,
        params: ["i32", "i32"],
        results: [],
        bodySha256: createHash("sha256")
          .update(commandBody(bytes, 6))
          .digest("hex"),
        label: "fixture profession command",
      }],
    },
    cursorEvent: {
      functionIndex: 4,
      params: ["i32", "i32", "i32", "i32", "i32"],
      results: [],
      tableSlot: 1,
      producerFunctions: [4, 4],
      producerParams: [
        ["i32", "i32", "i32", "i32", "i32"],
        ["i32", "i32", "i32", "i32", "i32"],
      ],
      producerResults: [[], []],
      bodySha256: createHash("sha256").update(commandBody(bytes, 1)).digest("hex"),
      producerBodySha256: [
        createHash("sha256").update(commandBody(bytes, 1)).digest("hex"),
        createHash("sha256").update(commandBody(bytes, 1)).digest("hex"),
      ],
      tableNeighbourBodySha256: [
        createHash("sha256").update(commandBody(bytes, 0)).digest("hex"),
        createHash("sha256").update(commandBody(bytes, 2)).digest("hex"),
      ],
      layout: {
        cursorActiveArt: 16, cursorSoftwareModel: 17, cursorShowCount: 18,
        cursorColorBuffer: 19, cursorArtHotspot: 0, cursorArtTexture: 12,
        cursorHandleKey: 8, cursorHandleObject: 0, cursorViewTexture: 8,
        cursorTextureType: 12, cursorTextureWidth: 20, cursorTextureHeight: 24,
      },
    },
    observationBase: { layout: {
      contextRoot: 1, agentArray: 2, gameContextSlot: 6,
      characterContext: 4, mapId: 5, isExplorable: 6,
      currentMapId: 7, currentInstanceType: 8, playerNumber: 9,
      agentId: 10, agentX: 11, agentY: 12, agentType: 13,
      agentPlayerNumber: 14, agentModelType: 15,
      worldContext: 46,
      areaInfo: 72, areaInfoCount: 73, areaInfoStride: 74, areaInfoFlags: 75,
    } },
    targetObservation: { layout: {
      manualTargetAgentId: 3, automaticTargetAgentId: 4,
    } },
    uiDispatcher: {
      functionIndex: 5,
      params: ["i32", "i32", "i32"],
      results: [],
      bodySha256: createHash("sha256").update(commandBody(bytes, 2)).digest("hex"),
      playerChatMessage: 0x1000_0082,
      hideHeroPanelMessage: 0x1000_01a3,
      showHeroPanelMessage: 0x1000_01a4,
    },
    partyObservation: {
      partyDirtyMessages: PARTY_DIRTY_MESSAGES,
      playerChatProducer: 5,
      playerChatSites: 3,
      nearbyPlayerMessages: [0x1000_007f, 0x1000_0080],
      nearbyPlayerMessageProducers: [5, 5],
      layout: {
      partyContext: 28, playerParty: 32, partyHeroes: 36,
      heroMemberStride: 24, heroAgentId: 0, heroOwnerPlayerId: 4, heroId: 8,
      // Distinct values rather than zeros: the config ABI is positional, so a
      // fixture padded with zeros would let a mis-ordered field pass.
      heroLevel: 42,
      partyPlayers: 43, partyHenchmen: 44, partyFlag: 45,
      accountContextSlot: 78, accountUnlockedSkills: 79,
      worldHeroFlags: 47, heroFlagStride: 48,
      flagHeroId: 49, flagAgentId: 50, flagBehavior: 51,
      worldHeroInfo: 52, heroInfoStride: 53, infoHeroId: 54,
      infoAgentId: 40, infoLevel: 41,
      infoPrimary: 55, infoSecondary: 56, infoAppearanceBitmap: 57,
      worldSkillbars: 58, skillbarStride: 59, skillbarAgentId: 60,
      skillbarSkills: 61, skillSlotStride: 62, skillSlotId: 63,
      skillbarDisabled: 64,
      worldAttributes: 65,
      attributeStride: 66,
      attributeAgentId: 67,
      attributeEntries: 68,
      attributeEntryStride: 69,
      attributeEntryId: 70,
      attributeEntryRank: 71,
      worldProfessionStates: 76,
      professionStateStride: 77,
      worldCharacterSkills: 80,
      },
    },
  };
}

export function callbackFixture(): Uint8Array {
  const type = section(1, [
    1, 0x60, 6, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0,
  ]);
  const imports = section(2, [
    1, 3, 101, 110, 118, 8, 100, 105, 115, 112, 97, 116, 99, 104, 0, 0,
  ]);
  const functions = section(3, [1, 0]);
  const name = [...new TextEncoder().encode("callback")];
  const exports = section(7, [1, ...uleb(name.length), ...name, 0, 1]);
  const body = [
    0,
    0x20, 0, 0x20, 1, 0x20, 2, 0x20, 3, 0x20, 4, 0x20, 5,
    0x10, 0,
    0x0b,
  ];
  const code = section(10, [1, ...uleb(body.length), ...body]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...type, ...imports, ...functions, ...exports, ...code,
  ]);
}
