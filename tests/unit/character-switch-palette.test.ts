import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  moveCharacterSelection,
  numberedCharacterPosition,
  orderCharacters,
  searchCharacters,
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

  it("searches all 27 characters without changing their alphabetical order", () => {
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

  it("keeps every account complete before and during search", () => {
    for (const size of [1, 9, 10, 11, 27, 64]) {
      const account = Object.freeze(Array.from({ length: size }, (_, index) => Object.freeze({
        ...character(`Character ${String(index + 1).padStart(2, "0")}`),
        characterKey: (index + 1).toString(16).padStart(16, "0"),
      })));
      const ordered = orderCharacters(account);
      assert.equal(searchCharacters(ordered, "").length, size);
      assert.equal(searchCharacters(ordered, "Character").length, size);
    }
  });

  it("matches reordered words and accents while preserving alphabetical order", () => {
    const account = Object.freeze([
      character("Á Candy Cane Shard", 2),
      character("Dhuum Survivor", 3),
      character("Eternal Foo", 4),
    ]);
    const ordered = orderCharacters(account);
    assert.deepEqual(
      searchCharacters(ordered, "shard candy").map(({ character: row }) => row.name),
      ["Á Candy Cane Shard"],
    );
    assert.deepEqual(
      searchCharacters(ordered, "a candy").map(({ character: row }) => row.name),
      ["Á Candy Cane Shard"],
    );
  });
});
