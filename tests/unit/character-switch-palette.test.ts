import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  characterCarouselRows,
  moveCharacterSelection,
  numberedCharacterPosition,
  orderCharacters,
  searchCharacters,
} from "../../src/renderer/character-switch-palette.js";
import type { CharacterSummary } from "../../src/renderer/companion-character-list-snapshot.js";

const character = (
  name: string,
  primaryProfession = 1,
  secondaryProfession = 0,
): CharacterSummary =>
  Object.freeze({
    name,
    characterKey: primaryProfession.toString(16).padStart(16, "0"),
    primaryProfession,
    secondaryProfession,
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

  it("shows finite carousel ends before navigation wraps", () => {
    assert.deepEqual(characterCarouselRows(0, 20), [null, null, null, 0, 1, 2, 3]);
    assert.deepEqual(characterCarouselRows(10, 20), [7, 8, 9, 10, 11, 12, 13]);
    assert.deepEqual(characterCarouselRows(19, 20), [16, 17, 18, 19, null, null, null]);
  });

  it("centres every character when the account fits in the visible slots", () => {
    assert.deepEqual(characterCarouselRows(0, 5), [null, 0, 1, 2, 3, 4, null]);
    assert.deepEqual(characterCarouselRows(4, 5), [null, 0, 1, 2, 3, 4, null]);
    assert.deepEqual(characterCarouselRows(0, 5, 2), [0, 1, 2, 3, 4]);
    assert.deepEqual(characterCarouselRows(0, 1), [null, null, null, 0, null, null, null]);
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

  it("matches primary profession substrings without searching secondaries", () => {
    const ordered = orderCharacters(Object.freeze([
      character("Alpha", 6),
      character("Helen", 1),
      character("Gamma", 1, 6),
      character("Shadow", 7),
      character("Delta", 1, 7),
      character("Oracle", 8),
    ]));
    const names = (query: string) => searchCharacters(ordered, query)
      .map(({ character: row }) => row.name);

    assert.deepEqual(names("ele"), ["Alpha", "Helen"]);
    assert.deepEqual(names("sin"), ["Shadow"]);
    assert.deepEqual(names("rit"), ["Oracle"]);
    assert.deepEqual(names("rt"), []);
    assert.deepEqual(names("alpha ele"), []);
  });
});
