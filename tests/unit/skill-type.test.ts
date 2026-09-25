/** Verifies skill labels match the game's own description prefixes for known skills. */
import assert from "node:assert/strict";
import test from "node:test";
import { skillType } from "../../src/main/core/skill-type.js";

const record = (type: number, extra: Partial<Parameters<typeof skillType>[0]> = {}) =>
  ({ type, flash: false, weaponRequirement: 0, combo: 0, profession: 0, ...extra });

test("labels follow the fields of known skills in the current client", () => {
  for (const [name, input, label] of [
    ["Eviscerate", record(14, { weaponRequirement: 1 }), "Axe Attack"],
    ["Barrage", record(14, { weaponRequirement: 2 }), "Bow Attack"],
    ["Crippling Slash", record(14, { weaponRequirement: 128 }), "Sword Attack"],
    ["Wild Blow", record(14, { weaponRequirement: 185 }), "Melee Attack"],
    ["Jagged Strike", record(14, { weaponRequirement: 8, combo: 1 }), "Lead Attack"],
    ["Fox Fangs", record(14, { weaponRequirement: 8, combo: 2 }), "Off-Hand Attack"],
    ["Death Blossom", record(14, { weaponRequirement: 8, combo: 3 }), "Dual Attack"],
    ["Hundred Blades", record(16), "Skill"],
    ["Troll Unguent", record(10), "Skill"],
    ["Frenzy", record(3), "Stance"],
    ["Grenth's Aura", record(6, { flash: true }), "Flash Enchantment Spell"],
    ["Order of the Vampire", record(6), "Enchantment Spell"],
    ["Winnowing", record(22, { profession: 2 }), "Nature Ritual"],
    ["Union", record(22, { profession: 8 }), "Binding Ritual"],
    ["Winds", record(22), "Ebon Vanguard Ritual"],
    ["Anthem of Fury", record(27), "Chant"],
    ["Aggressive Refrain", record(28), "Echo"],
    ["an unknown record", record(99), "Skill"],
  ] as const) assert.equal(skillType(input), label, name);
});
