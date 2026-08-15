/** Focused contract tests for Travel autocomplete, aliases, and persisted slots. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTravelRequest,
  isTravelShortcuts,
  searchTravelDestinations,
  travelDestination,
} from "../../src/shared/travel.js";

describe("Travel", () => {
  it("ranks exact aliases and useful partial names first", () => {
    assert.equal(searchTravelDestinations("ac")[0]?.name, "Ascalon City");
    assert.equal(searchTravelDestinations("kama")[0]?.name, "Kamadan, Jewel of Istan");
    assert.equal(searchTravelDestinations("central transfer")[0]?.mapId, 652);
  });

  it("keeps the numbered shortcut list bounded and typed", () => {
    assert.equal(isTravelShortcuts([
      { mapId: 81, district: "international", districtNumber: 0 },
    ]), true);
    assert.equal(isTravelShortcuts(Array.from({ length: 10 }, () => ({
      mapId: 81,
      district: "international",
      districtNumber: 0,
    }))), false);
    assert.equal(isTravelShortcuts([
      { mapId: 81, district: "unknown", districtNumber: 0 },
    ]), false);
    assert.equal(isTravelShortcuts([
      { mapId: 81, district: "international", districtNumber: 0 },
      null,
      { mapId: 642, district: "international", districtNumber: 0 },
    ]), true);
  });

  it("resolves only catalogue map ids", () => {
    assert.equal(travelDestination(81)?.name, "Ascalon City");
    assert.equal(travelDestination(2_000), null);
    assert.equal(isTravelRequest({
      mapId: 2_000,
      district: "international",
      districtNumber: 0,
    }), false);
  });
});
