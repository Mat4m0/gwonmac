/**
 * Independent structural proofs for Travel, Xunlai, aliases, and dependencies.
 * Each action keeps its own refusal boundary.
 */
import { createHash } from "node:crypto";
import { CLIENT_TICK_ROLE } from "./enhancement-client-hook-role.js";
import { deriveObservationLayout } from "./enhancement-target-proof.js";
import { dataEvidence } from "./wasm-data-evidence.js";
import {
  derivePartyObservation,
  deriveTeamApply,
  inspectPartyTeamRoleCandidates,
} from "./enhancement-party-team-proof.js";
import { playerChatUiEvidence } from "./enhancement-structural-report.js";
import {
  bodyMatchesRole,
  commonRelocationDelta,
  enhancementProofContext,
  functionBody,
  functionBodySha256,
  isolatedProof,
  MAX_INPUT_BYTES,
  matchesEvidenceInput,
  mutableSpans,
  parseActiveTableRelations,
  roleFunctions,
  semanticRole,
  signatureMatches,
  soleValue,
  staticBytes,
  staticBytesOccurrenceCount,
  staticCStringHash,
  uniqueExactFunction,
  uniqueRoleFunction,
  unsignedOperand,
  valuesForRole,
} from "./wasm-evidence.js";
import type { EnhancementProofContext } from "./wasm-evidence.js";
import { tickEvidence } from "./enhancement-tick-evidence.js";
import { verifyLayout } from "./semantic-proof.js";
import {
  ENHANCEMENT_BUILDS,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import type {
  EnhancementObservationBaseLayout,
} from "../../shared/enhancement-config.js";
import type {
  AutomaticLocalActionsLocation,
  ModuleShape,
} from "./enhancement-evidence-types.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export type LocalActionRoleCandidateStatus = "candidate" | "ambiguous" | "unavailable";

export interface LocalActionRoleDiagnostics {
  readonly gameThread: Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }>;
  readonly uiDispatcher: Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }>;
  readonly travelAction: Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }>;
  readonly travelContext: Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }>;
  readonly xunlaiAction: Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }>;
  readonly chatAliases: Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }>;
  readonly partyObservation: Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }>;
  readonly teamApply: Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }>;
}

const GAME_THREAD_DRAIN_ROLE = semanticRole(
  764,
  "aa1694915623017676dffcba6b54ef5570b4029e9c9258f8b8e00480e5d37c99",
  Object.freeze([
    ...mutableSpans([
      [29, 34, "frame.clock"], [80, 85, "frame.clock"],
      [108, 113, "frame.previous"], [136, 141, "frame.previous"],
      [153, 158, "frame.ready"], [166, 171, "frame.clock"],
      [175, 180, "frame.elapsed"], [183, 188, "frame.elapsed"],
      [199, 204, "frame.elapsed"], [220, 225, "frame.elapsed"],
      [232, 237, "frame.clock"], [365, 370, "frame.flag"],
      [396, 401, "frame.guard"], [432, 437, "frame.guard"],
      [442, 447, "frame.flag"], [469, 474, "frame.state"],
      [483, 488, "frame.counter"], [495, 500, "frame.counter"],
      [516, 521, "frame.buffer.end"], [536, 541, "frame.buffer.payload"],
      [560, 565, "frame.buffer.start"], [569, 574, "frame.state"],
      [589, 594, "frame.pending"], [623, 628, "frame.pending"],
      [641, 646, "frame.state"], [651, 656, "frame.buffer.start"],
      [675, 680, "frame.pending"], [685, 690, "frame.buffer.start"],
      [706, 711, "frame.flag"],
    ]),
    { start: 253, end: 258, role: "frame.assertion", addressClass: "immutable-data" },
  ]),
  ["i32", "i32"],
  [],
);

const CHAT_ALIASES_ROLE = semanticRole(
  380,
  "290a42320733b1876002e363f057b3d5ef2863a4fc71b33ceba720943af3ca5c",
  Object.freeze([
    ...mutableSpans([
      [50, 55, "aliases.flag"], [63, 68, "aliases.state"],
      [74, 79, "aliases.cursor"], [85, 90, "aliases.end"],
      [96, 101, "aliases.enabled"], [102, 107, "aliases.state"],
      [148, 153, "aliases.flag"], [248, 253, "aliases.state"],
    ]),
    { start: 110, end: 115, role: "aliases.buffer", addressClass: "immutable-data" },
    { start: 195, end: 200, role: "aliases.compare", addressClass: "immutable-data" },
    { start: 326, end: 331, role: "aliases.ui", addressClass: "function-index" },
    { start: 345, end: 350, role: "aliases.ui", addressClass: "function-index" },
  ]),
  ["i32", "i32"],
  ["i32"],
);

const XUNLAI_AGENT_READER_ROLE = semanticRole(
  418,
  "fde5f7f940fb4ab5b55f85290897f47f341056b983514a6b0e03bb6f149aff8d",
  Object.freeze([
    { start: 17, end: 22, role: "xunlai.assertion", addressClass: "immutable-data" },
    { start: 29, end: 31, role: "xunlai.source-line", addressClass: "immutable-data" },
  ]),
  ["i32"],
  ["i32"],
);

const XUNLAI_ACCESS_READER_ROLE = semanticRole(
  85,
  "ea782429f5a29731780e4c962909963b7a00b01f59b5122ec0c9ae292905ba09",
  Object.freeze([
    { start: 17, end: 22, role: "xunlai.assertion", addressClass: "immutable-data" },
    { start: 29, end: 31, role: "xunlai.source-line", addressClass: "immutable-data" },
  ]),
  ["i32"],
  ["i32"],
);

const UI_DISPATCHER_ROLE = semanticRole(
  47,
  "d465b17c204272c3d4318d39a5829f36e6a5c02025e1052fb239580d718caee4",
  Object.freeze([
    { start: 18, end: 23, role: "ui.forwarder", addressClass: "function-index" },
    { start: 41, end: 46, role: "ui.assertion", addressClass: "function-index" },
  ]),
  ["i32", "i32", "i32"],
  [],
);

const TRAVEL_PRODUCER_ROLE = semanticRole(
  216,
  "d4a42987112772c9b18c756e39c6037334002a02c278bb9dbe54fc55f6af0d80",
  Object.freeze([
    { start: 25, end: 30, role: "travel.area-reader", addressClass: "function-index" },
    { start: 70, end: 75, role: "travel.assertion", addressClass: "function-index" },
    { start: 88, end: 93, role: "travel.area-reader", addressClass: "function-index" },
    { start: 124, end: 129, role: "travel.precheck", addressClass: "function-index" },
    { start: 132, end: 137, role: "travel.ui", addressClass: "function-index" },
    { start: 179, end: 184, role: "travel.ui", addressClass: "function-index" },
    { start: 198, end: 203, role: "travel.postcheck", addressClass: "function-index" },
  ]),
  ["i32", "i32", "i32", "i32", "i32"],
  [],
);

const TRAVEL_CONTEXT_RESOLVER_ROLE = semanticRole(
  333,
  "626a6724cd6caad005c7ec900258ff529e4f350e298dd62a32e8217e0ac15657",
  Object.freeze([
    { start: 14, end: 19, role: "context.mission", addressClass: "immutable-data" },
    { start: 20, end: 25, role: "context.assertion-file", addressClass: "immutable-data" },
    { start: 29, end: 34, role: "context.assertion", addressClass: "function-index" },
    { start: 42, end: 47, role: "context.territory", addressClass: "immutable-data" },
    { start: 48, end: 53, role: "context.assertion-file", addressClass: "immutable-data" },
    { start: 57, end: 62, role: "context.assertion", addressClass: "function-index" },
    { start: 70, end: 75, role: "context.language", addressClass: "immutable-data" },
    { start: 76, end: 81, role: "context.assertion-file", addressClass: "immutable-data" },
    { start: 85, end: 90, role: "context.assertion", addressClass: "function-index" },
    { start: 96, end: 101, role: "context.reader-a", addressClass: "function-index" },
    { start: 109, end: 114, role: "context.reader-a", addressClass: "function-index" },
    { start: 136, end: 141, role: "context.reader-b", addressClass: "function-index" },
    { start: 158, end: 163, role: "context.reader-c", addressClass: "function-index" },
    { start: 195, end: 200, role: "context.resolver", addressClass: "function-index" },
    { start: 207, end: 212, role: "context.region-reader", addressClass: "function-index" },
    { start: 236, end: 241, role: "context.resolver", addressClass: "function-index" },
    { start: 262, end: 267, role: "context.resolver", addressClass: "function-index" },
    { start: 276, end: 281, role: "context.map-check", addressClass: "function-index" },
    { start: 290, end: 295, role: "context.reader-c", addressClass: "function-index" },
    { start: 298, end: 303, role: "context.language-reader", addressClass: "function-index" },
    { start: 323, end: 328, role: "context.resolver", addressClass: "function-index" },
  ]),
  ["i32", "i32", "i32"],
  [],
);

const XUNLAI_HANDLER_ROLE = semanticRole(
  247,
  "5f5e99bed43e89cdb3ac384bf51d5c61c1616fa16c29ba985c0cc4bfa6b0ea15",
  Object.freeze([
    { start: 98, end: 103, role: "xunlai.ui", addressClass: "function-index" },
    { start: 130, end: 135, role: "xunlai.ui", addressClass: "function-index" },
    { start: 172, end: 177, role: "xunlai.ui", addressClass: "function-index" },
    { start: 191, end: 196, role: "xunlai.ui", addressClass: "function-index" },
    { start: 210, end: 215, role: "xunlai.ui", addressClass: "function-index" },
    { start: 229, end: 234, role: "xunlai.ui", addressClass: "function-index" },
  ]),
  ["i32"],
  [],
);

const LOCAL_ACTION_HASHES = Object.freeze({
  xunlaiPlayerReader: "b98af3eb50f4c2aa1bc09f0a88712e32a2a14fe0d013126e1e4c0e842008e01f",
  areaTypeReader: "9786e68238b6a2559646f8e0594b3d4ee808003f11ec775a475e337e7dd9aa90",
  frameAssertion: "1db4beca1a3d246ce3f4df09cfdd2a3e60c5cef5564d0361474f7f9cb3c95026",
  xunlaiAssertion: "df83cbe4386b6f8641568f5d2b6444c941f6d448a7efffd9f4737e343b0972d2",
});

function candidateDiagnostic(
  module: ModuleShape,
  role: Parameters<typeof roleFunctions>[1],
): Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }> {
  const candidateCount = roleFunctions(module, role).length;
  return Object.freeze({
    status: candidateCount === 1
      ? "candidate"
      : candidateCount > 1
        ? "ambiguous"
        : "unavailable",
    candidateCount,
  });
}

function aggregateCandidateDiagnostics(
  diagnostics: readonly Readonly<{
    status: LocalActionRoleCandidateStatus;
    candidateCount: number;
  }>[],
): Readonly<{ status: LocalActionRoleCandidateStatus; candidateCount: number }> {
  const ambiguous = diagnostics.filter(({ status }) => status === "ambiguous");
  if (ambiguous.length > 0) {
    return Object.freeze({
      status: "ambiguous",
      candidateCount: Math.max(...ambiguous.map(({ candidateCount }) => candidateCount)),
    });
  }
  return diagnostics.some(({ status }) => status === "candidate")
    ? Object.freeze({ status: "candidate", candidateCount: 1 })
    : Object.freeze({ status: "unavailable", candidateCount: 0 });
}

/** Review diagnostics only; these candidate counts never grant authority. */
export function inspectLocalActionRoleCandidates(
  input: Uint8Array,
  baselines: readonly KnownEnhancementBuild[] = ENHANCEMENT_BUILDS,
  suppliedContext?: EnhancementProofContext,
): LocalActionRoleDiagnostics | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const context = matchesEvidenceInput(suppliedContext, input)
      ? suppliedContext
      : enhancementProofContext(input);
    if (!context) return null;
    const module = context.moduleView();
    const partyTeam = baselines.map((baseline) =>
      inspectPartyTeamRoleCandidates(module, baseline));
    return Object.freeze({
      gameThread: candidateDiagnostic(module, GAME_THREAD_DRAIN_ROLE),
      uiDispatcher: candidateDiagnostic(module, UI_DISPATCHER_ROLE),
      travelAction: candidateDiagnostic(module, TRAVEL_PRODUCER_ROLE),
      travelContext: candidateDiagnostic(module, TRAVEL_CONTEXT_RESOLVER_ROLE),
      xunlaiAction: candidateDiagnostic(module, XUNLAI_HANDLER_ROLE),
      chatAliases: candidateDiagnostic(module, CHAT_ALIASES_ROLE),
      partyObservation: aggregateCandidateDiagnostics(
        partyTeam.map(({ partyObservation }) => partyObservation),
      ),
      teamApply: aggregateCandidateDiagnostics(
        partyTeam.map(({ teamApply }) => teamApply),
      ),
    });
  } catch {
    return null;
  }
}


const CHAT_ALIASES_TABLE_NORMALIZED_SHA256 =
  "9d1a4540fc1cd37c645d9dc5f2a5003803c4968871512b5f2312a3107dc6a0b0";

function isChatAliasesTable(table: Uint8Array, base: number): boolean {
  const pointerOffsets = [0, 8, 16, 96] as const;
  const pointerDeltas = [24, 44, 62, 200] as const;
  const normalized = table.slice();
  for (let index = 0; index < pointerOffsets.length; index += 1) {
    const offset = pointerOffsets[index]!;
    const pointer = table[offset]!
      | (table[offset + 1]! << 8)
      | (table[offset + 2]! << 16)
      | (table[offset + 3]! << 24);
    if ((pointer >>> 0) !== base + pointerDeltas[index]!) return false;
    normalized.fill(0, offset, offset + 4);
  }
  return createHash("sha256").update(normalized).digest("hex")
    === CHAT_ALIASES_TABLE_NORMALIZED_SHA256;
}


function deriveChatAliases(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
  uiDispatcher: NonNullable<KnownEnhancementBuild["uiDispatcher"]>,
): KnownEnhancementBuild["chatAliases"] | null {
  const expected = baseline.chatAliases;
  if (!expected) return null;
  const parserFunction = uniqueRoleFunction(module, CHAT_ALIASES_ROLE);
  if (parserFunction === null) return null;
  const body = functionBody(module, parserFunction);
  const values = valuesForRole(body, CHAT_ALIASES_ROLE);
  const state = soleValue(values, "aliases.state");
  const buffer = soleValue(values, "aliases.buffer");
  const table = staticBytes(module, buffer, 104);
  const { initializedDataEnd } = dataEvidence(module);
  if (
    !table
    || state < initializedDataEnd
    || state % 4 !== 0
    || soleValue(values, "aliases.cursor") !== state + 20
    || soleValue(values, "aliases.end") !== state + 8
    || soleValue(values, "aliases.enabled") !== state + 28
    || soleValue(values, "aliases.flag") !== state + 32
    || soleValue(values, "aliases.compare") !== buffer + 92
    || !isChatAliasesTable(table, buffer)
    || staticBytesOccurrenceCount(module, table) !== 1
    || unsignedOperand(body, 316) !== 0x1000_019d
    || unsignedOperand(body, 335) !== 0x1000_019e
    || soleValue(values, "aliases.ui") !== uiDispatcher.functionIndex
  ) return null;
  return Object.freeze({
    parser: Object.freeze({
      ...expected.parser,
      functionIndex: parserFunction,
      bodySha256: functionBodySha256(module, parserFunction),
    }),
  });
}

function deriveGameThread(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
): KnownEnhancementBuild["gameThread"] | null {
  const functionIndex = uniqueRoleFunction(module, GAME_THREAD_DRAIN_ROLE);
  const expected = baseline.gameThread?.drain;
  if (functionIndex === null || !expected) return null;
  const body = functionBody(module, functionIndex);
  const values = valuesForRole(body, GAME_THREAD_DRAIN_ROLE);
  const delta = commonRelocationDelta([
    [soleValue(values, "frame.clock"), 0x5a2248],
    [soleValue(values, "frame.previous"), 0x5a2244],
    [soleValue(values, "frame.ready"), 0x5a21ec],
    [soleValue(values, "frame.elapsed"), 0x5a2250],
    [soleValue(values, "frame.flag"), 0x5a21f0],
    [soleValue(values, "frame.guard"), 0x5a2254],
    [soleValue(values, "frame.state"), 0x5a223c],
    [soleValue(values, "frame.counter"), 0x5a2258],
    [soleValue(values, "frame.buffer.end"), 0x15ac30],
    [soleValue(values, "frame.buffer.payload"), 0x15ac20],
    [soleValue(values, "frame.buffer.start"), 0x15ac10],
    [soleValue(values, "frame.pending"), 0x5a2240],
  ]);
  const slots = parseActiveTableRelations(module.elementSection).get(functionIndex) ?? [];
  if (
    delta === null
    || staticCStringHash(module, soleValue(values, "frame.assertion"))
      !== LOCAL_ACTION_HASHES.frameAssertion
    || slots.length !== 1
  ) return null;
  return Object.freeze({
    drain: Object.freeze({
      functionIndex,
      params: expected.params,
      results: expected.results,
      tableSlot: slots[0]!,
      bodySha256: functionBodySha256(module, functionIndex),
    }),
  });
}

function deriveXunlaiAccess(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
  observation: EnhancementObservationBaseLayout,
  handlerFunction: number,
): KnownEnhancementBuild["xunlaiAction"] | null {
  const expected = baseline.xunlaiAction;
  if (!expected) return null;
  const agentFunction = uniqueRoleFunction(module, XUNLAI_AGENT_READER_ROLE);
  const accessFunction = uniqueRoleFunction(module, XUNLAI_ACCESS_READER_ROLE);
  const playerFunction = uniqueExactFunction(
    module, LOCAL_ACTION_HASHES.xunlaiPlayerReader, ["i32"], ["i32"],
  );
  const areaTypeFunction = uniqueExactFunction(
    module, LOCAL_ACTION_HASHES.areaTypeReader, ["i32"], ["i32"],
  );
  if (
    agentFunction === null || accessFunction === null
    || playerFunction === null || areaTypeFunction === null
  ) return null;
  const agentBody = functionBody(module, agentFunction);
  const accessBody = functionBody(module, accessFunction);
  const playerBody = functionBody(module, playerFunction);
  const agentValues = valuesForRole(agentBody, XUNLAI_AGENT_READER_ROLE);
  const accessValues = valuesForRole(accessBody, XUNLAI_ACCESS_READER_ROLE);
  const agentLine = soleValue(agentValues, "xunlai.source-line");
  const accessLine = soleValue(accessValues, "xunlai.source-line");
  if (
    staticCStringHash(module, soleValue(agentValues, "xunlai.assertion"))
      !== LOCAL_ACTION_HASHES.xunlaiAssertion
    || staticCStringHash(module, soleValue(accessValues, "xunlai.assertion"))
      !== LOCAL_ACTION_HASHES.xunlaiAssertion
    || agentLine - 4_822 !== accessLine - 4_850
  ) return null;
  const worldPlayers = unsignedOperand(agentBody, 49);
  const playerRecordStride = unsignedOperand(agentBody, 146);
  const layout = verifyLayout({
    worldPlayers,
    playerRecordStride,
    playerRecordAgentId: unsignedOperand(agentBody, 416),
    playerRecordAccessFlags: unsignedOperand(accessBody, 78),
    playerRecordNumber: unsignedOperand(playerBody, 123),
    areaInfoType: unsignedOperand(functionBody(module, areaTypeFunction), 54),
  }, {
    worldPlayers: { sourceRole: "three player-record readers", expression: "WorldContext array field", occurrences: [49, 67, 108] },
    playerRecordStride: { sourceRole: "three player-record readers", expression: "record index multiplier", occurrences: [146, 72, 69, 118] },
    playerRecordAgentId: { sourceRole: "agent-id reader", expression: "record field load", occurrences: [416] },
    playerRecordAccessFlags: { sourceRole: "access-flags reader", expression: "record field load", occurrences: [78] },
    playerRecordNumber: { sourceRole: "player-number reader", expression: "record field address", occurrences: [123] },
    areaInfoType: { sourceRole: "area type reader", expression: "post-lookup field load", occurrences: [54] },
  }).layout;
  if (
    unsignedOperand(accessBody, 67) !== worldPlayers
    || unsignedOperand(playerBody, 108) !== worldPlayers
    || unsignedOperand(accessBody, 72) !== playerRecordStride
    || unsignedOperand(playerBody, 69) !== playerRecordStride
    || unsignedOperand(playerBody, 118) !== playerRecordStride
    || layout.areaInfoType >= observation.areaInfoStride
  ) return null;
  return Object.freeze({
    openExport: expected.openExport,
    configureExport: expected.configureExport,
    accessProof: Object.freeze({
      layout,
      readers: Object.freeze({
        "agent-id": Object.freeze({
          functionIndex: agentFunction, params: ["i32"] as const,
          results: ["i32"] as const, bodySha256: functionBodySha256(module, agentFunction),
        }),
        "access-flags": Object.freeze({
          functionIndex: accessFunction, params: ["i32"] as const,
          results: ["i32"] as const, bodySha256: functionBodySha256(module, accessFunction),
        }),
        "player-number": Object.freeze({
          functionIndex: playerFunction, params: ["i32"] as const,
          results: ["i32"] as const, bodySha256: functionBodySha256(module, playerFunction),
        }),
      }),
    }),
    handler: Object.freeze({
      functionIndex: handlerFunction,
      params: ["i32"] as const,
      results: [] as const,
      bodySha256: functionBodySha256(module, handlerFunction),
    }),
  });
}

const TRAVEL_CONTEXT_CONTENT = Object.freeze({
  mission: "dfae82ea0978bc50205237929d4ece2c7a22b64232b50c1f78bca624f8122069",
  assertionFile: "990259813aee6a5fc56b2c2af745a07251e6ccc9e711128e56c4bbb527378d33",
  territory: "fccfbe045f143c572b41acebac157ded3123ee4d863ee92ebea36221e83b42a0",
  language: "38cee1370de5776c9a9aa325f29afaced033b74ba16b11d20401d727bb8930c9",
});

function uniqueCString(
  module: ModuleShape,
  address: number,
  length: number,
  hash: string,
): boolean {
  const bytes = staticBytes(module, address, length);
  return bytes !== null
    && staticCStringHash(module, address) === hash
    && staticBytesOccurrenceCount(module, bytes) === 1;
}

function deriveTravelContextResolver(
  module: ModuleShape,
): NonNullable<NonNullable<KnownEnhancementBuild["travelAction"]>["contextResolver"]> | null {
  const functionIndex = uniqueRoleFunction(module, TRAVEL_CONTEXT_RESOLVER_ROLE);
  if (functionIndex === null) return null;
  const body = functionBody(module, functionIndex);
  const values = valuesForRole(body, TRAVEL_CONTEXT_RESOLVER_ROLE);
  const assertion = soleValue(values, "context.assertion");
  const readerA = soleValue(values, "context.reader-a");
  const readerB = soleValue(values, "context.reader-b");
  const readerC = soleValue(values, "context.reader-c");
  const resolver = soleValue(values, "context.resolver");
  const regionReader = soleValue(values, "context.region-reader");
  const mapCheck = soleValue(values, "context.map-check");
  const languageReader = soleValue(values, "context.language-reader");
  const callees = [
    assertion, readerA, readerB, readerC, resolver, regionReader, mapCheck, languageReader,
  ];
  if (
    callees.some((value) => value === null)
    || new Set(callees).size !== callees.length
    || !signatureMatches(module, assertion!, ["i32", "i32", "i32"], [])
    || !signatureMatches(module, readerA!, ["i32"], ["i32"])
    || !signatureMatches(module, readerB!, [], ["i32"])
    || !signatureMatches(module, readerC!, [], ["i32"])
    || !signatureMatches(module, resolver!, ["i32", "i32"], ["i32"])
    || !signatureMatches(module, regionReader!, [], ["i32"])
    || !signatureMatches(module, mapCheck!, ["i32"], ["i32"])
    || !signatureMatches(module, languageReader!, ["i32", "i32"], ["i32"])
    || !uniqueCString(
      module, soleValue(values, "context.mission"), 20, TRAVEL_CONTEXT_CONTENT.mission,
    )
    || !uniqueCString(
      module, soleValue(values, "context.assertion-file"), 28,
      TRAVEL_CONTEXT_CONTENT.assertionFile,
    )
    || !uniqueCString(
      module, soleValue(values, "context.territory"), 19, TRAVEL_CONTEXT_CONTENT.territory,
    )
    || !uniqueCString(
      module, soleValue(values, "context.language"), 18, TRAVEL_CONTEXT_CONTENT.language,
    )
  ) return null;
  return Object.freeze({
    functionIndex,
    params: ["i32", "i32", "i32"] as const,
    results: [] as const,
    bodySha256: functionBodySha256(module, functionIndex),
  });
}


export function locateAutomaticLocalActions(
  input: Uint8Array,
  baselines: readonly KnownEnhancementBuild[],
  suppliedContext: EnhancementProofContext | undefined,
  suppliedObservationLayout: EnhancementObservationBaseLayout | undefined,
  suppliedPlayerSkillbar: KnownEnhancementBuild["playerSkillbarObservation"] | null,
): AutomaticLocalActionsLocation | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const context = matchesEvidenceInput(suppliedContext, input)
      ? suppliedContext
      : enhancementProofContext(input);
    if (!context) return null;
    const module = context.moduleView();
    const tick = tickEvidence(module).candidate;
    if (!tick || !bodyMatchesRole(functionBody(module, tick.functionIndex), CLIENT_TICK_ROLE)) {
      return null;
    }
    const locations: AutomaticLocalActionsLocation[] = [];
    for (const baseline of baselines) {
      const expectedUi = baseline.uiDispatcher;
      const party = baseline.partyObservation;
      if (!expectedUi || !party) continue;
      const decoded = context.decodeFunctions([
        expectedUi.playerChatMessage,
        ...party.nearbyPlayerMessages,
        ...party.partyDirtyMessages,
      ]);
      const uiEvidence = isolatedProof(() => playerChatUiEvidence(module, decoded, {
        playerChatMessage: expectedUi.playerChatMessage,
        nearbyPlayerMessages: party.nearbyPlayerMessages,
      }).candidate);
      const uiFunction = uniqueRoleFunction(module, UI_DISPATCHER_ROLE);
      const uiBody = uiFunction === null ? null : functionBody(module, uiFunction);
      const uiValues = uiBody ? valuesForRole(uiBody, UI_DISPATCHER_ROLE) : null;
      const uiForwarder = uiValues ? soleValue(uiValues, "ui.forwarder") : null;
      const uiAssertion = uiValues ? soleValue(uiValues, "ui.assertion") : null;
      const uiDispatcher = uiFunction !== null
        && uiEvidence?.dispatcherFunctionIndex === uiFunction
        && uiForwarder !== null
        && uiAssertion !== null
        && uiForwarder !== uiAssertion
        && uiForwarder !== uiFunction
        && uiAssertion !== uiFunction
        && signatureMatches(module, uiForwarder, ["i32", "i32", "i32"], [])
        && signatureMatches(module, uiAssertion, ["i32", "i32", "i32"], [])
        ? Object.freeze({
            ...expectedUi,
            functionIndex: uiFunction,
            bodySha256: functionBodySha256(module, uiFunction),
          })
        : null;
      const gameThread = isolatedProof(() => deriveGameThread(module, baseline));

      const travelExpected = baseline.travelAction;
      const travelFunction = travelExpected
        ? uniqueRoleFunction(module, TRAVEL_PRODUCER_ROLE)
        : null;
      const travelBody = travelFunction === null ? null : functionBody(module, travelFunction);
      const travelValues = travelBody
        ? valuesForRole(travelBody, TRAVEL_PRODUCER_ROLE)
        : null;
      const travelAreaReader = travelValues
        ? isolatedProof(() => soleValue(travelValues, "travel.area-reader"))
        : null;
      const travelAssertion = travelValues
        ? soleValue(travelValues, "travel.assertion")
        : null;
      const travelPrecheck = travelValues
        ? soleValue(travelValues, "travel.precheck")
        : null;
      const travelPostcheck = travelValues
        ? soleValue(travelValues, "travel.postcheck")
        : null;
      const travelContextResolver = travelExpected
        ? deriveTravelContextResolver(module)
        : null;
      const unlockAccessor = travelExpected
        ? uniqueExactFunction(
            module,
            travelExpected.unlockProof.accessor.bodySha256,
            travelExpected.unlockProof.accessor.params,
            travelExpected.unlockProof.accessor.results,
          )
        : null;
      const unlockConsumer = travelExpected
        ? uniqueExactFunction(
            module,
            travelExpected.unlockProof.consumer.bodySha256,
            travelExpected.unlockProof.consumer.params,
            travelExpected.unlockProof.consumer.results,
          )
        : null;
      const travelAction = uiDispatcher && gameThread && travelExpected && travelBody
        && unsignedOperand(travelBody, 169) === travelExpected.messageId
        && travelValues !== null
        && isolatedProof(() => soleValue(travelValues, "travel.ui"))
          === uiDispatcher.functionIndex
        && travelAreaReader !== null
        && travelAssertion !== null
        && travelPrecheck !== null
        && travelPostcheck !== null
        && travelAssertion === uiAssertion
        && new Set([
          travelAreaReader,
          travelAssertion,
          travelPrecheck,
          uiDispatcher.functionIndex,
          travelPostcheck,
        ]).size === 5
        && signatureMatches(module, travelAreaReader, ["i32"], ["i32"])
        && signatureMatches(module, travelAssertion, ["i32", "i32", "i32"], [])
        && signatureMatches(module, travelPrecheck, [], ["i32"])
        && signatureMatches(module, travelPostcheck, ["i32", "i32", "f32"], [])
        && travelContextResolver !== null
        && unlockAccessor !== null
        && unlockConsumer !== null
        ? Object.freeze({
            ...travelExpected,
            producer: Object.freeze({
              ...travelExpected.producer,
              functionIndex: travelFunction!,
              bodySha256: functionBodySha256(module, travelFunction!),
            }),
            contextResolver: travelContextResolver,
            unlockProof: Object.freeze({
              layout: travelExpected.unlockProof.layout,
              accessor: Object.freeze({
                ...travelExpected.unlockProof.accessor,
                functionIndex: unlockAccessor,
              }),
              consumer: Object.freeze({
                ...travelExpected.unlockProof.consumer,
                functionIndex: unlockConsumer,
              }),
            }),
          })
        : null;

      const handlerExpected = baseline.xunlaiAction?.handler;
      const handlerFunction = handlerExpected
        ? uniqueRoleFunction(module, XUNLAI_HANDLER_ROLE)
        : null;
      const handlerBody = handlerFunction === null ? null : functionBody(module, handlerFunction);
      const handlerValues = handlerBody
        ? valuesForRole(handlerBody, XUNLAI_HANDLER_ROLE)
        : null;
      const observationLayout = suppliedObservationLayout
        ?? isolatedProof(() => deriveObservationLayout(module));
      const xunlaiAction = uiDispatcher && gameThread && observationLayout
        && handlerBody
        && handlerValues
        && [85, 117, 159, 181, 200, 219].every(
          (offset, index) => unsignedOperand(handlerBody, offset) === 0x1000_0040 + index,
        )
        && isolatedProof(() => soleValue(handlerValues, "xunlai.ui"))
          === uiDispatcher.functionIndex
        ? isolatedProof(() => deriveXunlaiAccess(
            module, baseline, observationLayout, handlerFunction!,
          ))
        : null;

      const chatAliases = uiDispatcher
        ? isolatedProof(() => deriveChatAliases(module, baseline, uiDispatcher))
        : null;
      const partyObservation = suppliedPlayerSkillbar
          && uiDispatcher && observationLayout && uiEvidence
        ? isolatedProof(() => derivePartyObservation(
            module, baseline, observationLayout, suppliedPlayerSkillbar,
            uiDispatcher, uiEvidence, decoded,
          ))
        : null;
      const teamApply = partyObservation && gameThread
        ? isolatedProof(() => deriveTeamApply(module, baseline, decoded))
        : null;
      if (!travelAction && !xunlaiAction && !chatAliases && !partyObservation) continue;
      locations.push(Object.freeze({
        baseline,
        hookFunction: tick.functionIndex,
        hookBodySha256: tick.bodySha256,
        observationLayout: travelAction || xunlaiAction || partyObservation
          ? observationLayout
          : null,
        uiDispatcher,
        gameThread: travelAction || xunlaiAction || teamApply ? gameThread : null,
        travelAction,
        xunlaiAction,
        chatAliases,
        partyObservation,
        teamApply,
      }));
    }
    if (locations.length === 0) return null;
    const identity = (value: AutomaticLocalActionsLocation) => JSON.stringify({
      hookFunction: value.hookFunction,
      observationLayout: value.observationLayout,
      uiDispatcher: value.uiDispatcher,
      gameThread: value.gameThread,
      travelAction: value.travelAction,
      xunlaiAction: value.xunlaiAction,
      chatAliases: value.chatAliases,
      partyObservation: value.partyObservation,
      teamApply: value.teamApply,
    });
    return locations.every((match) => identity(match) === identity(locations[0]!))
      ? locations[0]!
      : null;
  } catch {
    return null;
  }
}
