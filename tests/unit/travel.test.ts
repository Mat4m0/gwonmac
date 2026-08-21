/** Focused contract tests for Travel catalogue, autocomplete, and persisted slots. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRAVEL_DESTINATIONS,
  TRAVEL_SEARCH_QUERY_LIMIT,
  isStoredTravelShortcuts,
  isTravelRequest,
  isTravelShortcuts,
  parseTravelUserPreferencesUpdate,
  searchTravelDestinations,
  storeTravelShortcuts,
  travelDestination,
  travelShortcutsFromStored,
} from "../../src/shared/travel.js";

describe("Travel", () => {
  it("contains the complete reviewed direct-travel catalogue", () => {
    const reviewedMapIds = [
      10, 11, 12, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 28, 29, 30, 32, 35,
      36, 38, 39, 40, 49, 51, 55, 57, 73, 77, 81, 82, 85, 109, 116, 117, 118,
      120, 122, 123, 124, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139,
      140, 141, 142, 148, 152, 153, 154, 155, 156, 157, 158, 159, 163, 164, 165,
      166, 181, 188, 193, 194, 206, 213, 214, 216, 217, 218, 219, 220, 222, 224,
      225, 226, 230, 234, 242, 243, 248, 249, 250, 251, 272, 273, 274, 277, 278,
      279, 281, 282, 283, 284, 286, 287, 288, 289, 291, 292, 293, 294, 295, 296,
      297, 298, 303, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 348,
      349, 350, 368, 376, 378, 381, 387, 388, 389, 390, 391, 393, 396, 398, 403,
      407, 414, 421, 424, 425, 426, 427, 428, 431, 433, 434, 435, 438, 440, 442,
      449, 450, 457, 467, 469, 473, 474, 476, 477, 478, 479, 480, 489, 491, 492,
      493, 494, 495, 496, 497, 502, 544, 545, 554, 555, 559, 624, 638, 639, 640,
      641, 642, 643, 644, 645, 648, 650, 652, 675, 721, 778, 795, 796, 857,
    ];
    assert.equal(TRAVEL_DESTINATIONS.length, 199);
    assert.deepEqual(
      TRAVEL_DESTINATIONS.map(({ mapId }) => mapId).sort((left, right) => left - right),
      reviewedMapIds,
    );
    assert.deepEqual(
      TRAVEL_DESTINATIONS
        .filter(({ name }) => name.startsWith("Gate of "))
        .map(({ mapId }) => mapId)
        .sort((left, right) => left - right),
      [450, 469, 473, 474, 478, 494, 495, 559],
    );
    assert.equal(travelDestination(30)?.name, "Ruins of Surmia");
    assert.equal(travelDestination(266), null, "Urgoz requires passage-scroll UI");
    assert.equal(travelDestination(307), null, "The Deep requires passage-scroll UI");
    assert.equal(new Set(TRAVEL_DESTINATIONS.map(({ mapId }) => mapId)).size, 199);
  });

  it("ranks exact aliases and useful partial names first", () => {
    assert.equal(searchTravelDestinations("ac")[0]?.name, "Ascalon City");
    assert.equal(searchTravelDestinations("kama")[0]?.name, "Kamadan, Jewel of Istan");
    assert.equal(searchTravelDestinations("central transfer")[0]?.mapId, 652);
    assert.equal(searchTravelDestinations("kamadna")[0]?.mapId, 449);
    assert.equal(searchTravelDestinations("nightfall").length > 0, true);
  });

  it("bounds search work before normalization or scoring", () => {
    assert.deepEqual(
      searchTravelDestinations("a".repeat(TRAVEL_SEARCH_QUERY_LIMIT + 1)),
      [],
    );
    assert.equal(searchTravelDestinations("gate", 1).length, 1);
    assert.equal(searchTravelDestinations("gate", 100).length <= 12, true);
  });

  it("keeps the numbered shortcut list bounded and typed", () => {
    const slots = [
      { mapId: 81 }, null, { mapId: 642 }, null, null, null, null, null, null,
    ];
    assert.equal(isTravelShortcuts(slots), true);
    assert.equal(isTravelShortcuts(Array.from({ length: 10 }, () => ({
      mapId: 81,
    }))), false);
    assert.equal(isTravelShortcuts([{ mapId: 81 }]), false);
    assert.equal(isTravelShortcuts(slots.map((entry, index) =>
      index === 0 && entry ? { ...entry, district: "international" } : entry
    )), false);
  });

  it("keeps Stable-readable shortcut fields on disk while runtime stays map-only", () => {
    const stored = [
      { mapId: 55, district: "europe-english" as const, districtNumber: 2 },
      null,
    ];
    assert.equal(isStoredTravelShortcuts(stored), true);
    const runtime = travelShortcutsFromStored(stored);
    assert.deepEqual(runtime, [
      { mapId: 55 }, null, null, null, null, null, null, null, null,
    ]);
    assert.deepEqual(storeTravelShortcuts(runtime, stored), [
      { mapId: 55, district: "europe-english", districtNumber: 2 },
      null, null, null, null, null, null, null, null,
    ]);
  });

  it("resolves only catalogue map ids", () => {
    assert.equal(travelDestination(81)?.name, "Ascalon City");
    assert.equal(travelDestination(2_000), null);
    assert.equal(isTravelRequest({
      mapId: 2_000,
    }), false);
  });

  it("rejects one request that would write both preference files", () => {
    const expected = {
      shortcuts: travelShortcutsFromStored([]),
      synonyms: [],
      recentLimit: 5,
      recentMapIds: [],
    };
    assert.throws(() => parseTravelUserPreferencesUpdate({
      expected,
      patch: { shortcuts: expected.shortcuts, recentLimit: 3 },
    }), /exactly one durable owner/u);
    assert.throws(() => parseTravelUserPreferencesUpdate({
      expected,
      patch: {},
    }), /exactly one durable owner/u);
    assert.throws(() => parseTravelUserPreferencesUpdate({
      expected,
      patch: { futurePreference: true },
    }), /exactly one durable owner/u);
    assert.deepEqual(parseTravelUserPreferencesUpdate({
      expected,
      patch: { recentLimit: 3, recentMapIds: [] },
    }).patch, { recentLimit: 3, recentMapIds: [] });
  });
});
