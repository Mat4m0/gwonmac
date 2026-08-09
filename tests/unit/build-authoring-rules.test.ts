import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributePointsRemaining,
  attributePointsSpent,
  availableAttributes,
  canSetAttributeRank,
  resolveSkillPlacement,
  withAttributeRank,
} from "../../src/shared/builds/authoring.js";
import { skillBarOf, skillId } from "../../src/shared/builds/library.js";

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

  it("resolves every catalogue placement without creating an invalid bar", () => {
    const first = skillId(1);
    const oldElite = skillId(2);
    const newElite = skillId(3);
    const unknown = skillId(4);
    const skills = skillBarOf((slot) => slot === 0 ? first : slot === 7 ? oldElite : null);
    const catalogue = (skill: typeof first) => {
      if (skill === first) return { elite: false };
      if (skill === oldElite || skill === newElite) return { elite: true };
      return null;
    };

    assert.deepEqual(resolveSkillPlacement(skills, 0, first, catalogue), {
      outcome: "already-used",
      target: 0,
      existingSlot: 0,
    });
    assert.deepEqual(resolveSkillPlacement(skills, 3, first, catalogue), {
      outcome: "already-used",
      target: 3,
      existingSlot: 0,
    });
    assert.deepEqual(resolveSkillPlacement(skills, 3, unknown, catalogue), {
      outcome: "unavailable",
      target: 3,
    });
    assert.deepEqual(resolveSkillPlacement(skills, 2, skillId(5), (skill) =>
      skill === skillId(5) ? { elite: false } : catalogue(skill)), {
      outcome: "place",
      target: 2,
      skills: skillBarOf((slot) =>
        slot === 0 ? first : slot === 2 ? skillId(5) : slot === 7 ? oldElite : null
      ),
    });
    assert.deepEqual(resolveSkillPlacement(skills, 3, newElite, catalogue), {
      outcome: "replace-elite",
      target: 3,
      replaced: [{ slot: 7, skill: oldElite }],
      skills: skillBarOf((slot) => slot === 0 ? first : slot === 3 ? newElite : null),
    });
  });
});
