import assert from "node:assert/strict";
import test from "node:test";
import { parseSkillCatalogue } from "../../src/shared/skill-catalogue.js";

const skill = () => ({
  id: 42,
  name: "Arcane Echo",
  profession: "Me",
  attribute: "DominationMagic",
  elite: false,
  availability: "pve",
  energyCost: 15,
  adrenalineCost: 0,
  healthCost: 0,
  overcast: 0,
  activationSeconds: 2,
  aftercastSeconds: 0.75,
  rechargeSeconds: 20,
  description: "For 20 seconds, your next spell is replaced.",
  hasIcon: true,
});

test("the skill catalogue has one complete cross-process parser", () => {
  assert.deepEqual(parseSkillCatalogue([skill()]), [skill()]);
  assert.throws(() => parseSkillCatalogue([]), /must not be empty/);
  assert.throws(() => parseSkillCatalogue({}), /must be an array/);
});

test("one malformed skill refuses the whole catalogue", () => {
  assert.throws(
    () => parseSkillCatalogue([skill(), { ...skill(), rechargeSeconds: "soon" }]),
    /\[1\]\.rechargeSeconds must be a finite number/,
  );
  assert.throws(
    () => parseSkillCatalogue([{ ...skill(), profession: "Chronomancer" }]),
    /\[0\]\.profession names no known value/,
  );
  assert.throws(
    () => parseSkillCatalogue([{ ...skill(), id: -1 }]),
    /\[0\]\.id must be a non-negative safe integer/,
  );
  const partial = Object.fromEntries(
    Object.entries(skill()).filter(([field]) => field !== "hasIcon"),
  );
  assert.throws(
    () => parseSkillCatalogue([partial]),
    /\[0\]\.hasIcon must be a boolean/,
  );
  assert.throws(
    () => parseSkillCatalogue([skill(), { ...skill(), name: "Echo" }]),
    /\[1\]\.id duplicates skill 42/,
  );
});
