import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  inspectEnhancementStructuralEvidence as inspectStructuralEvidence,
  type PlayerChatMessageAnchors,
} from "../../src/tools/enhancement-structural-evidence.js";
import {
  concat,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  sleb,
  uleb,
  WASM_HEADER,
  type FunctionType,
} from "../../src/main/core/wasm-binary.js";

const I32 = 0x7f;
const PLAYER_CHAT = 0x1000_0082;
const NEARBY_7F = 0x1000_007f;
const NEARBY_80 = 0x1000_0080;
const MESSAGE_ANCHORS: PlayerChatMessageAnchors = Object.freeze({
  playerChatMessage: PLAYER_CHAT,
  nearbyPlayerMessages: Object.freeze([
    NEARBY_7F,
    NEARBY_80,
  ] as [number, number]),
});
const ALTERNATE_MESSAGE_ANCHORS: PlayerChatMessageAnchors = Object.freeze({
  playerChatMessage: 0x1000_0092,
  nearbyPlayerMessages: Object.freeze([
    0x1000_008f,
    0x1000_0090,
  ] as [number, number]),
});

function inspectEvidence(
  input: Uint8Array,
  messageAnchors: PlayerChatMessageAnchors = MESSAGE_ANCHORS,
) {
  return inspectStructuralEvidence(input, messageAnchors);
}

interface FixtureOptions {
  readonly shift?: number;
  readonly tickParams?: number;
  readonly uiParams?: number;
  readonly cursorParams?: number;
  readonly playerChatMessages?: number[];
  readonly nearby80Message?: number;
  readonly cursorProducerCount?: number;
  readonly duplicateUi?: boolean;
  readonly duplicateCursor?: boolean;
  readonly splitUiTarget?: boolean;
  readonly unsupportedInstruction?: boolean;
  readonly tableRelation?: "unique" | "missing" | "duplicate" | "passive";
  readonly messageAnchors?: PlayerChatMessageAnchors;
}

interface Fixture {
  readonly bytes: Uint8Array;
  readonly tick: number;
  readonly ui: number;
  readonly cursor: number;
  readonly chatProducer: number;
  readonly nearby7fProducer: number;
  readonly nearby80Producer: number;
  readonly cursorProducers: number[];
}

interface DefinedFunction {
  readonly typeIndex: number;
  readonly body: Uint8Array;
}

function encodeTypes(types: readonly FunctionType[]): Uint8Array {
  return concat(
    uleb(types.length),
    ...types.map((type) =>
      concat(
        Uint8Array.of(0x60),
        uleb(type.params.length),
        Uint8Array.from(type.params),
        uleb(type.results.length),
        Uint8Array.from(type.results),
      ),
    ),
  );
}

function emptyBody(): Uint8Array {
  return Uint8Array.of(0, 0x0b);
}

function producerBody(
  target: number,
  params: number,
  messages: readonly number[],
): Uint8Array {
  const calls = messages.map((message) =>
    concat(
      Uint8Array.of(0x41),
      sleb(message),
      ...Array.from(
        { length: Math.max(0, params - 1) },
        () => Uint8Array.of(0x41, 0),
      ),
      Uint8Array.of(0x10),
      uleb(target),
    ),
  );
  return concat(Uint8Array.of(0), ...calls, Uint8Array.of(0x0b));
}

function fixture(options: FixtureOptions = {}): Fixture {
  const messageAnchors = options.messageAnchors ?? MESSAGE_ANCHORS;
  const shift = options.shift ?? 0;
  const tickParams = options.tickParams ?? 1;
  const uiParams = options.uiParams ?? 3;
  const cursorParams = options.cursorParams ?? 5;
  const functions: DefinedFunction[] = [];
  const producerType = 3;
  for (let index = 0; index < shift; index += 1) {
    functions.push({ typeIndex: producerType, body: emptyBody() });
  }

  const tick = functions.length;
  functions.push({ typeIndex: 0, body: emptyBody() });
  const ui = functions.length;
  functions.push({ typeIndex: 1, body: emptyBody() });
  const cursor = functions.length;
  functions.push({ typeIndex: 2, body: emptyBody() });
  let chatTarget = ui;
  if (options.splitUiTarget) {
    chatTarget = functions.length;
    functions.push({ typeIndex: 1, body: emptyBody() });
  }

  const chatProducer = functions.length;
  functions.push({
    typeIndex: producerType,
    body: producerBody(
      chatTarget,
      uiParams,
      options.playerChatMessages ?? [
        messageAnchors.playerChatMessage,
        messageAnchors.playerChatMessage,
        messageAnchors.playerChatMessage,
      ],
    ),
  });
  const nearby7fProducer = functions.length;
  functions.push({
    typeIndex: producerType,
    body: producerBody(ui, uiParams, [messageAnchors.nearbyPlayerMessages[0]]),
  });
  const nearby80Producer = functions.length;
  functions.push({
    typeIndex: producerType,
    body: producerBody(
      ui,
      uiParams,
      [
        options.nearby80Message
          ?? messageAnchors.nearbyPlayerMessages[1],
      ],
    ),
  });

  const cursorProducers: number[] = [];
  for (
    let producer = 0;
    producer < (options.cursorProducerCount ?? 2);
    producer += 1
  ) {
    cursorProducers.push(functions.length);
    functions.push({
      typeIndex: producerType,
      body: producerBody(cursor, cursorParams, [0]),
    });
  }

  if (options.duplicateUi) {
    const duplicateUi = functions.length;
    functions.push({ typeIndex: 1, body: emptyBody() });
    functions.push({
      typeIndex: producerType,
      body: producerBody(
        duplicateUi,
        uiParams,
        [
          messageAnchors.playerChatMessage,
          messageAnchors.playerChatMessage,
          messageAnchors.playerChatMessage,
        ],
      ),
    });
    functions.push({
      typeIndex: producerType,
      body: producerBody(
        duplicateUi,
        uiParams,
        [messageAnchors.nearbyPlayerMessages[0]],
      ),
    });
    functions.push({
      typeIndex: producerType,
      body: producerBody(
        duplicateUi,
        uiParams,
        [messageAnchors.nearbyPlayerMessages[1]],
      ),
    });
  }

  let duplicateCursor: number | null = null;
  if (options.duplicateCursor) {
    duplicateCursor = functions.length;
    functions.push({ typeIndex: 2, body: emptyBody() });
    for (let producer = 0; producer < 2; producer += 1) {
      functions.push({
        typeIndex: producerType,
        body: producerBody(duplicateCursor, cursorParams, [0]),
      });
    }
  }
  if (options.unsupportedInstruction) {
    functions.push({
      typeIndex: producerType,
      body: Uint8Array.of(
        0,
        0xfd, 0x0c,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0x1a,
        0x0b,
      ),
    });
  }

  const types: FunctionType[] = [
    { params: Array.from({ length: tickParams }, () => I32), results: [] },
    { params: Array.from({ length: uiParams }, () => I32), results: [] },
    { params: Array.from({ length: cursorParams }, () => I32), results: [] },
    { params: [], results: [] },
  ];
  const tableRelation = options.tableRelation ?? "unique";
  let elementFunctions: number[] = [];
  if (tableRelation === "unique") elementFunctions = [cursor];
  if (tableRelation === "duplicate") elementFunctions = [cursor, cursor];
  if (options.duplicateCursor && duplicateCursor !== null) {
    elementFunctions = [cursor, duplicateCursor];
  }
  const tableSize = Math.max(1, elementFunctions.length + 1);
  const table = concat(
    uleb(1),
    Uint8Array.of(0x70),
    uleb(1),
    uleb(tableSize),
    uleb(tableSize),
  );
  let elements: Uint8Array;
  if (tableRelation === "passive") {
    elements = concat(
      uleb(1),
      uleb(1),
      Uint8Array.of(0),
      uleb(1),
      uleb(cursor),
    );
  } else if (elementFunctions.length === 0) {
    elements = uleb(0);
  } else {
    elements = concat(
      uleb(1),
      uleb(0),
      Uint8Array.of(0x41),
      sleb(1),
      Uint8Array.of(0x0b),
      uleb(elementFunctions.length),
      ...elementFunctions.map(uleb),
    );
  }
  const loopName = new TextEncoder().encode("EmscriptenExeThreadMainLoop");
  const exports = concat(
    uleb(1),
    uleb(loopName.byteLength),
    loopName,
    Uint8Array.of(0),
    uleb(tick),
  );
  const bytes = concat(
    WASM_HEADER,
    encodeSection({ id: 1, body: encodeTypes(types) }),
    encodeSection({
      id: 3,
      body: encodeIndexVector(functions.map((entry) => entry.typeIndex)),
    }),
    encodeSection({ id: 4, body: table }),
    encodeSection({ id: 7, body: exports }),
    encodeSection({ id: 9, body: elements }),
    encodeSection({ id: 10, body: encodeCode(functions.map((entry) => entry.body)) }),
  );
  assert.equal(WebAssembly.validate(new Uint8Array(bytes)), true);
  return {
    bytes,
    tick,
    ui,
    cursor,
    chatProducer,
    nearby7fProducer,
    nearby80Producer,
    cursorProducers,
  };
}

describe("review-only Enhancement structural evidence", () => {
  it("recovers all three boundaries deterministically without a build certificate", () => {
    const input = fixture();
    const first = inspectEvidence(input.bytes);
    const second = inspectEvidence(input.bytes);
    assert.deepEqual(first, second);
    assert.equal(
      first.sha256,
      createHash("sha256").update(input.bytes).digest("hex"),
    );
    assert.equal(first.validWasm, true);
    assert.deepEqual(first.failures, []);
    assert.deepEqual(first.tick.candidate, {
      functionIndex: input.tick,
      signature: { params: ["i32"], results: [] },
    });
    assert.deepEqual(first.playerChatUi.candidate, {
      dispatcherFunctionIndex: input.ui,
      playerChatProducerFunctionIndex: input.chatProducer,
      nearby7fProducerFunctionIndices: [input.nearby7fProducer],
      nearby80ProducerFunctionIndices: [input.nearby80Producer],
    });
    assert.deepEqual(first.cursor.candidate, {
      targetFunctionIndex: input.cursor,
      producerFunctionIndices: input.cursorProducers,
      activeTableSlot: 1,
    });
  });

  it("recovers shifted function indices instead of relying on known numbers", () => {
    const input = fixture({ shift: 7 });
    const report = inspectEvidence(input.bytes);
    assert.equal(report.tick.candidate?.functionIndex, 7);
    assert.equal(
      report.playerChatUi.candidate?.dispatcherFunctionIndex,
      input.ui,
    );
    assert.equal(report.cursor.candidate?.targetFunctionIndex, input.cursor);
  });

  it("uses the caller's immutable message anchors instead of fixed IDs", () => {
    const input = fixture({ messageAnchors: ALTERNATE_MESSAGE_ANCHORS });

    const report = inspectEvidence(input.bytes, ALTERNATE_MESSAGE_ANCHORS);
    assert.equal(
      report.playerChatUi.candidate?.dispatcherFunctionIndex,
      input.ui,
    );
    assert.equal(inspectEvidence(input.bytes).playerChatUi.status, "unavailable");
  });

  it("rejects changed tick, dispatcher, and cursor signatures independently", () => {
    const wrongTick = inspectEvidence(
      fixture({ tickParams: 2 }).bytes,
    );
    assert.equal(wrongTick.tick.status, "unavailable");
    assert.equal(wrongTick.playerChatUi.status, "candidate");
    assert.equal(wrongTick.cursor.status, "candidate");

    const wrongUi = inspectEvidence(
      fixture({ uiParams: 2 }).bytes,
    );
    assert.equal(wrongUi.playerChatUi.status, "unavailable");
    const uiConsideration = wrongUi.playerChatUi.considered.find(
      (entry) => entry.playerChat.length > 0,
    );
    assert.equal(uiConsideration?.signatureMatches, false);
    assert.deepEqual(uiConsideration?.signature?.params, ["i32", "i32"]);

    const wrongCursor = inspectEvidence(
      fixture({ cursorParams: 4 }).bytes,
    );
    assert.equal(wrongCursor.cursor.status, "unavailable");
    assert.equal(wrongCursor.cursor.candidate, null);
  });

  it("rejects changed player message and exact-site cardinality evidence", () => {
    const changedFixture = fixture({
      playerChatMessages: [PLAYER_CHAT, PLAYER_CHAT, 0x1000_0081],
    });
    const changedMessage = inspectEvidence(
      changedFixture.bytes,
    );
    assert.equal(changedMessage.playerChatUi.status, "unavailable");
    const dispatcher = changedMessage.playerChatUi.considered.find(
      (entry) => entry.signatureMatches,
    );
    assert.deepEqual(dispatcher?.playerChat, [{
      producerFunctionIndex: changedFixture.chatProducer,
      messageSites: 2,
      directCallSites: 3,
    }]);

    const changedNeighbour = inspectEvidence(
      fixture({ nearby80Message: 0x1000_0081 }).bytes,
    );
    assert.equal(changedNeighbour.playerChatUi.status, "unavailable");
    assert.deepEqual(
      changedNeighbour.playerChatUi.considered.find(
        (entry) => entry.signatureMatches,
      )?.nearby80,
      [],
    );

    const wrongCardinality = inspectEvidence(
      fixture({
        playerChatMessages: [
          PLAYER_CHAT,
          PLAYER_CHAT,
          PLAYER_CHAT,
          PLAYER_CHAT,
        ],
      }).bytes,
    );
    assert.equal(wrongCardinality.playerChatUi.status, "unavailable");
  });

  it("rejects a changed direct-call target even when both signatures match", () => {
    const report = inspectEvidence(
      fixture({ splitUiTarget: true }).bytes,
    );
    assert.equal(report.playerChatUi.status, "unavailable");
    assert.equal(report.playerChatUi.candidate, null);
    assert.equal(
      report.playerChatUi.considered.filter((entry) => entry.signatureMatches)
        .length,
      2,
    );
  });

  it("reports duplicate dispatcher and cursor candidates as ambiguous", () => {
    const duplicateUi = inspectEvidence(
      fixture({ duplicateUi: true }).bytes,
    );
    assert.equal(duplicateUi.playerChatUi.status, "ambiguous");
    assert.equal(duplicateUi.playerChatUi.candidate, null);
    assert.equal(
      duplicateUi.playerChatUi.considered.filter(
        (entry) =>
          entry.signatureMatches
          && entry.playerChat[0]?.messageSites === 3
          && entry.nearby7f.length === 1
          && entry.nearby80.length === 1,
      ).length,
      2,
    );

    const duplicateCursor = inspectEvidence(
      fixture({ duplicateCursor: true }).bytes,
    );
    assert.equal(duplicateCursor.cursor.status, "ambiguous");
    assert.equal(duplicateCursor.cursor.candidate, null);
  });

  it("distinguishes missing and non-unique active-table relationships", () => {
    const missing = inspectEvidence(
      fixture({ tableRelation: "missing" }).bytes,
    );
    assert.equal(missing.cursor.status, "unavailable");
    assert.deepEqual(missing.cursor.considered[0]?.activeTableSlots, []);

    const passive = inspectEvidence(
      fixture({ tableRelation: "passive" }).bytes,
    );
    assert.equal(passive.cursor.status, "unavailable");
    assert.deepEqual(passive.cursor.considered[0]?.activeTableSlots, []);

    const duplicate = inspectEvidence(
      fixture({ tableRelation: "duplicate" }).bytes,
    );
    assert.equal(duplicate.cursor.status, "ambiguous");
    assert.deepEqual(duplicate.cursor.considered[0]?.activeTableSlots, [1, 2]);
  });

  it("fails closed with a deterministic data report for malformed input", () => {
    const malformed = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 1, 0xff);
    const report = inspectEvidence(malformed);
    assert.equal(report.validWasm, false);
    assert.deepEqual(report.failures, ["invalid-wasm"]);
    assert.equal(report.tick.status, "unavailable");
    assert.equal(report.playerChatUi.status, "unavailable");
    assert.equal(report.cursor.status, "unavailable");
  });

  it("keeps independent tick evidence but rejects an unsupported opcode set", () => {
    const report = inspectEvidence(
      fixture({ unsupportedInstruction: true }).bytes,
    );
    assert.equal(report.validWasm, true);
    assert.deepEqual(report.failures, ["instruction-set-unsupported"]);
    assert.equal(report.tick.status, "candidate");
    assert.equal(report.playerChatUi.status, "unavailable");
    assert.equal(report.cursor.status, "unavailable");
  });
});
