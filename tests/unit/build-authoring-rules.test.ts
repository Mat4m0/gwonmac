import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributePointsRemaining,
  attributePointsSpent,
  availableAttributes,
  canSetAttributeRank,
  withAttributeRank,
} from "../../src/shared/builds/authoring.js";

describe("build authoring rules", () => {
  it("uses the exact nonlinear 200-point Guild Wars budget", () => {
    const spread = {
      Swordsmanship: 12,
      Tactics: 12,
    } as const;
    assert.equal(attributePointsSpent(spread), 194);
    assert.equal(attributePointsRemaining(spread), 6);
    assert.equal(canSetAttributeRank(spread, "Strength", 3), true);
    assert.equal(canSetAttributeRank(spread, "Strength", 4), false);
  });

  it("offers both professions but never a secondary primary attribute", () => {
    const attributes = availableAttributes(["W", "R"]);
    assert.equal(attributes.includes("Strength"), true);
    assert.equal(attributes.includes("Marksmanship"), true);
    assert.equal(attributes.includes("Expertise"), false);
  });

  it("stores rank zero as no investment", () => {
    assert.deepEqual(withAttributeRank({ Strength: 8 }, "Strength", 0), {});
  });
});
