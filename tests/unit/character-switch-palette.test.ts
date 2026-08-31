import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  moveCharacterSelection,
  numberedCharacterPosition,
  orderCharacters,
  searchCharacters,
  visibleCharacterRows,
} from "../../src/renderer/character-switch-palette.js";
import type { CharacterSummary } from "../../src/renderer/companion-character-list-snapshot.js";

const character = (name: string, primaryProfession = 1): CharacterSummary =>
  Object.freeze({
    name,
    characterKey: primaryProfession.toString(16).padStart(16, "0"),
    primaryProfession,
    secondaryProfession: 0,
    characterType: "roleplaying",
    campaign: 1,
    level: 20,
    mapId: 55,
  });

describe("character switch ordering", () => {
  const characters = Object.freeze([
    character("Zed", 2),
    character("alpha", 3),
    character("Beta", 4),
  ]);

  it("sorts alphabetically without losing live indices", () => {
    assert.deepEqual(
      orderCharacters(characters).map(({ character: row, index }) => [row.name, index]),
      [["alpha", 1], ["Beta", 2], ["Zed", 0]],
    );
  });

  it("maps 1–9 plus 0 for row ten and wraps arrow navigation", () => {
    assert.equal(numberedCharacterPosition("1", 4), 0);
    assert.equal(numberedCharacterPosition("4", 4), 3);
    assert.equal(numberedCharacterPosition("5", 4), null);
    assert.equal(numberedCharacterPosition("0", 9), null);
    assert.equal(numberedCharacterPosition("0", 10), 9);
    assert.equal(moveCharacterSelection(0, 4, -1), 3);
    assert.equal(moveCharacterSelection(0, 4, 1), 1);
    assert.equal(moveCharacterSelection(3, 4, 1), 0);
    assert.equal(moveCharacterSelection(0, 4, 1, 1), 2);
    assert.equal(moveCharacterSelection(2, 4, -1, 1), 0);
    assert.equal(moveCharacterSelection(3, 4, 1, 0), 1);
    assert.equal(moveCharacterSelection(0, 4, -1, 3), 2);
    assert.equal(moveCharacterSelection(0, 1, 1, 0), 0);
  });

  it("ranks successful switches by count, recency, then name", () => {
    const usage = {
      formatVersion: 1,
      sequence: 9,
      entries: [
        { characterKey: characters[0]!.characterKey, successfulSwitches: 2, lastUsedSequence: 7 },
        { characterKey: characters[2]!.characterKey, successfulSwitches: 2, lastUsedSequence: 9 },
      ],
    } as const;
    assert.deepEqual(
      orderCharacters(characters, usage).map(({ character: row }) => row.name),
      ["Beta", "Zed", "alpha"],
    );
  });

  it("searches all 27 characters with prefix matches before substring matches", () => {
    const account = Object.freeze(Array.from({ length: 27 }, (_, index) => Object.freeze({
      ...character(index === 26 ? "Rudolph Prime" : `Character ${String(index + 1).padStart(2, "0")}`),
      characterKey: (index + 1).toString(16).padStart(16, "0"),
    })));
    const ordered = orderCharacters(account);
    assert.equal(ordered.slice(0, 10).length, 10);
    assert.deepEqual(
      searchCharacters(ordered, "rud").map(({ character: row }) => row.name),
      ["Rudolph Prime"],
    );
    assert.equal(searchCharacters(ordered, "character").length, 26);
    assert.equal(searchCharacters(ordered, "no result").length, 0);
  });

  it("keeps small accounts complete and large accounts at ten until searched", () => {
    for (const size of [1, 9, 10, 11, 27, 64]) {
      const account = Object.freeze(Array.from({ length: size }, (_, index) => Object.freeze({
        ...character(`Character ${String(index + 1).padStart(2, "0")}`),
        characterKey: (index + 1).toString(16).padStart(16, "0"),
      })));
      const ordered = orderCharacters(account);
      assert.equal(visibleCharacterRows(ordered, size, "").length, Math.min(size, 10));
      assert.equal(visibleCharacterRows(ordered, size, "Character").length, size <= 10 ? size : size);
    }
  });

  it("ignores usage keys that are absent from the live account", () => {
    const usage = {
      formatVersion: 1,
      sequence: 10,
      entries: [{
        characterKey: "ffffffffffffffff",
        successfulSwitches: 99,
        lastUsedSequence: 10,
      }],
    } as const;
    assert.deepEqual(
      orderCharacters(characters, usage).map(({ character: row }) => row.name),
      ["alpha", "Beta", "Zed"],
    );
  });
});
