import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { characterSwitchContext } from "../../src/renderer/character-switch-model.js";
import type { CompanionPlayRegionState } from "../../src/renderer/companion-play-region-snapshot.js";

const region = (instanceType: number, playRegion: "pve" | "pvp"): CompanionPlayRegionState => Object.freeze({
  status: "ready", sequence: 1, mapId: 55, instanceType, playRegion, travelContext: "world",
  characterKey: null, unlockedMapWords: null, guildHall: false, hasGuildHall: false,
});

describe("character switch context", () => {
  it("lets the pre-game screen win over a stale play region", () => {
    assert.equal(characterSwitchContext("character-select", region(0, "pve")), "character-select");
    assert.equal(characterSwitchContext("loading", region(1, "pve")), "loading");
    assert.equal(characterSwitchContext("reconnect", region(0, "pve")), "loading");
  });

  it("reads outposts, explorable areas and PvP from the play region", () => {
    assert.equal(characterSwitchContext("unknown", region(0, "pve")), "outpost");
    assert.equal(characterSwitchContext("unknown", region(0, "pvp")), "outpost");
    assert.equal(characterSwitchContext("unknown", region(1, "pve")), "pve-explorable");
    assert.equal(characterSwitchContext("unknown", region(1, "pvp")), "pvp-explorable");
  });

  it("never guesses without a ready, known instance", () => {
    assert.equal(characterSwitchContext("unknown", { status: "waiting", reason: "loading" }), "unavailable");
    assert.equal(characterSwitchContext("unknown", region(2, "pve")), "unavailable");
  });
});
