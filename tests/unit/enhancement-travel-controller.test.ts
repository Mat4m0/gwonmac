/** Travel's one availability answer names the real reason a player sees before Enter. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTravelController } from "../../src/renderer/enhancement-travel-controller.js";

describe("Travel controller", () => {
  it("names a map load or character select, never the setting, while the region policy withdraws Travel (HUB-135)", () => {
    const controller = createTravelController(() => 1, null, () => 1, 64);
    try {
      // While a map loads the play region is unknown, so the region policy reports Travel as off.
      controller.update({ enabled: false, playRegion: "unknown", state: { status: "waiting", reason: "loading" } });
      assert.equal(controller.command.unavailable(), "Travel is unavailable while a map is loading");
      controller.update({ enabled: false, playRegion: "unknown", state: { status: "waiting", reason: "game" } });
      assert.equal(controller.command.unavailable(), "Travel is waiting for Guild Wars");
      controller.update({ enabled: false, playRegion: "pvp", state: { status: "waiting", reason: "loading" } });
      assert.equal(controller.command.unavailable(), "Travel is unavailable during PvP play");
      const ready = { status: "ready", mapId: 55, travelContext: "world", characterKey: null, unlockedMapWords: null, guildHall: false, hasGuildHall: false, explorable: false } as const;
      controller.update({ enabled: false, playRegion: "pve", state: ready });
      assert.equal(controller.command.unavailable(), "Travel is turned off in Settings");
      controller.update({ enabled: true, playRegion: "pve", state: ready });
      assert.equal(controller.command.unavailable(), null);
    } finally { controller.dispose(); }
  });
});
