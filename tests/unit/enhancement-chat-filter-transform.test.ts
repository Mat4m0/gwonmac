import assert from "node:assert/strict";
import test from "node:test";
import {
  chatFilterConfigure,
  chatFilterDecision,
} from "../../src/main/certification/enhancement-chat-filter-transform.js";
import { ENHANCEMENT_CHAT_FILTER_MASKS } from "../../src/shared/enhancement-contracts.js";
import type { KnownEnhancementBuild } from "../../src/main/certification/enhancement-build-model.js";
import {
  concat,
  encodeCode,
  encodeSection,
  uleb,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import { configuredChatFilterMask } from
  "../../src/renderer/certified-companion-tools-installation.js";

const fact = Object.freeze({
  writeToChatLogMessage: 0x1000_007f,
  packetChannelOffset: 0,
  packetMessageOffset: 4,
  allyDropTemplate: 0x7f1,
  numericSegment: 0x10f,
  encodedNumberBase: 0x100,
  playerNameToken: 0xba9,
  encodedStringStart: 0x107,
  encodedStringEnd: 0x1,
  maxPlayerNameUnits: 20,
  currentPlayerNameOffset: 0x74,
  systemPrefix: 0x8102,
  hallOfHeroesTemplate: 0x223b,
  titleTemplates: [0x1443, 0x23e2, 0x23e5, 0x23e6],
  producer: {
    functionIndex: 1,
    params: ["i32", "i32"],
    results: [],
    bodySha256: "0".repeat(64),
  },
} as const satisfies NonNullable<KnownEnhancementBuild["chatFiltering"]>);

const layout = Object.freeze({
  contextRoot: 0x20,
  gameContextSlot: 1,
  characterContext: 8,
  playerNumber: 12,
}) satisfies Pick<
  NonNullable<KnownEnhancementBuild["observationBase"]>["layout"],
  "contextRoot" | "gameContextSlot" | "characterContext" | "playerNumber"
>;

const section = (id: number, body: Uint8Array) => encodeSection({ id, body });
const playerName = 0x3f4;
const name = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return concat(uleb(bytes.length), bytes);
};

function moduleBytes(): Uint8Array {
  return concat(
    WASM_HEADER,
    section(1, concat(
      uleb(2),
      Uint8Array.of(0x60), uleb(2), Uint8Array.of(0x7f, 0x7f), uleb(1), Uint8Array.of(0x7f),
      Uint8Array.of(0x60), uleb(1), Uint8Array.of(0x7f), uleb(1), Uint8Array.of(0x7f),
    )),
    section(3, concat(uleb(3), uleb(0), uleb(1), uleb(1))),
    section(5, concat(uleb(1), Uint8Array.of(0x00), uleb(1))),
    section(6, concat(uleb(1), Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b))),
    section(7, concat(
      uleb(3),
      name("memory"), Uint8Array.of(0x02), uleb(0),
      name("filter"), Uint8Array.of(0x00), uleb(0),
      name("configure"), Uint8Array.of(0x00), uleb(1),
    )),
    section(10, encodeCode([
      chatFilterDecision(fact, layout, 0),
      chatFilterConfigure(0),
      concat(uleb(0), Uint8Array.of(0x41), uleb(playerName), Uint8Array.of(0x0b)),
    ])),
  );
}

test("chat filtering recognizes only bounded certified encoded templates", async () => {
  const bytes = moduleBytes();
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  assert.equal(WebAssembly.validate(buffer), true);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(buffer));
  const memory = instance.exports.memory as WebAssembly.Memory;
  const filter = instance.exports.filter as (event: number, packet: number) => number;
  const configure = instance.exports.configure as (mask: number) => number;
  const view = new DataView(memory.buffer);
  const packet = 0x100;
  const message = 0x200;
  view.setUint32(packet + fact.packetMessageOffset, message, true);
  const write = (...units: number[]) => units.forEach(
    (unit, index) => view.setUint16(message + index * 2, unit, true),
  );

  assert.equal(configure(ENHANCEMENT_CHAT_FILTER_MASKS.all + 1), 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  assert.equal(configure(ENHANCEMENT_CHAT_FILTER_MASKS.all), 1);
  assert.equal(filter(0x1000_0080, packet), 0);

  write(fact.systemPrefix, fact.hallOfHeroesTemplate, 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 1);
  write(fact.systemPrefix, fact.titleTemplates[2], 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 1);
  write(fact.systemPrefix, 0x777, 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);

  const root = 0x300;
  const game = 0x340;
  const character = 0x380;
  view.setUint32(layout.contextRoot, root, true);
  view.setUint32(root + layout.gameContextSlot * 4, game, true);
  view.setUint32(game + layout.characterContext, character, true);
  view.setUint32(character + layout.playerNumber, 7, true);
  write(fact.allyDropTemplate, 0x222, fact.numericSegment, fact.encodedNumberBase + 8, 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 1);
  write(fact.allyDropTemplate, fact.numericSegment, fact.encodedNumberBase + 7, 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);

  const currentName = [..."Necronimo"].map((unit) => unit.charCodeAt(0));
  currentName.forEach((unit, index) => {
    view.setUint16(playerName + index * 2, unit, true);
  });
  view.setUint16(
    playerName + currentName.length * 2,
    0,
    true,
  );
  write(
    fact.allyDropTemplate,
    0x222,
    fact.playerNameToken,
    fact.encodedStringStart,
    ...currentName,
    fact.encodedStringEnd,
    0,
  );
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  write(
    fact.allyDropTemplate,
    fact.playerNameToken,
    fact.encodedStringStart,
    ...[..."Toefte"].map((unit) => unit.charCodeAt(0)),
    fact.encodedStringEnd,
    0,
  );
  assert.equal(filter(fact.writeToChatLogMessage, packet), 1);

  view.setUint32(packet + fact.packetMessageOffset, 65_535, true);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
});

test("chat filtering keeps categories independent and malformed messages visible", async () => {
  const bytes = moduleBytes();
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(buffer));
  const memory = instance.exports.memory as WebAssembly.Memory;
  const filter = instance.exports.filter as (event: number, packet: number) => number;
  const configure = instance.exports.configure as (mask: number) => number;
  const view = new DataView(memory.buffer);
  const packet = 0x100;
  const message = 0x200;
  view.setUint32(packet + fact.packetMessageOffset, message, true);
  const write = (...units: number[]) => units.forEach(
    (unit, index) => view.setUint16(message + index * 2, unit, true),
  );

  configure(ENHANCEMENT_CHAT_FILTER_MASKS.hallOfHeroes);
  write(fact.systemPrefix, fact.hallOfHeroesTemplate, 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 1);
  for (const titleTemplate of fact.titleTemplates) {
    write(fact.systemPrefix, titleTemplate, 0);
    assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  }

  configure(ENHANCEMENT_CHAT_FILTER_MASKS.titleAchievements);
  write(fact.systemPrefix, fact.hallOfHeroesTemplate, 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  for (const titleTemplate of fact.titleTemplates) {
    write(fact.systemPrefix, titleTemplate, 0);
    assert.equal(filter(fact.writeToChatLogMessage, packet), 1);
  }

  configure(ENHANCEMENT_CHAT_FILTER_MASKS.allyDrops);
  write(fact.allyDropTemplate, 0x222, 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  const root = 0x300;
  const game = 0x340;
  const character = 0x380;
  view.setUint32(layout.contextRoot, root, true);
  view.setUint32(root + layout.gameContextSlot * 4, game, true);
  view.setUint32(game + layout.characterContext, character, true);
  [..."Necronimo"].forEach((unit, index) => {
    view.setUint16(
      playerName + index * 2,
      unit.charCodeAt(0),
      true,
    );
  });
  view.setUint16(playerName + "Necronimo".length * 2, 0, true);
  write(
    fact.allyDropTemplate,
    fact.playerNameToken,
    fact.encodedStringStart,
    ...Array.from({ length: fact.maxPlayerNameUnits }, () => 0x41),
    0,
  );
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  for (let index = 0; index < fact.maxPlayerNameUnits; index += 1) {
    view.setUint16(playerName + index * 2, 0x41, true);
  }
  write(
    fact.allyDropTemplate,
    fact.playerNameToken,
    fact.encodedStringStart,
    0x42,
    fact.encodedStringEnd,
    0,
  );
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  write(fact.allyDropTemplate, ...Array.from({ length: 63 }, () => 0x222), 0);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  view.setUint32(packet + fact.packetMessageOffset, 0, true);
  assert.equal(filter(fact.writeToChatLogMessage, packet), 0);
  assert.equal(filter(fact.writeToChatLogMessage, 0), 0);
});

test("saved category choices become the closed three-bit WASM mask", () => {
  const settings = {
    chatFilterAllyDrops: true,
    chatFilterHallOfHeroes: false,
    chatFilterTitleAchievements: true,
  };
  assert.equal(configuredChatFilterMask(settings, true), 5);
  assert.equal(configuredChatFilterMask(settings, false), 0);
});
