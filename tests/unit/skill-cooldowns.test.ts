import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSkillCooldown,
  isSkillCooldownColor,
  skillCooldownCssColor,
} from "../../src/shared/skill-cooldowns.js";

test("cooldown formatting rounds active values upward without showing zero", () => {
  assert.equal(formatSkillCooldown(0), null);
  assert.equal(formatSkillCooldown(1), "0.1");
  assert.equal(formatSkillCooldown(99), "0.1");
  assert.equal(formatSkillCooldown(100), "0.1");
  assert.equal(formatSkillCooldown(101), "0.2");
  assert.equal(formatSkillCooldown(400), "0.4");
  assert.equal(formatSkillCooldown(2_899), "2.9");
  assert.equal(formatSkillCooldown(2_999), "3.0");
  assert.equal(formatSkillCooldown(3_000), "3");
  assert.equal(formatSkillCooldown(3_001), "4");
  assert.equal(formatSkillCooldown(14_001), "15");
  assert.equal(formatSkillCooldown(1_800_000), "1800");
  assert.equal(formatSkillCooldown(1_800_001), null);
  assert.equal(formatSkillCooldown(-1), null);
  assert.equal(formatSkillCooldown(1.5), null);
  assert.equal(formatSkillCooldown(Number.NaN), null);
});

test("cooldown colors accept only the closed presets or exact six-digit RGB", () => {
  for (const preset of ["red", "cream", "gold", "blue"] as const) {
    const color = { kind: "preset", preset } as const;
    assert.equal(isSkillCooldownColor(color), true);
    assert.match(skillCooldownCssColor(color), /^#[0-9a-f]{6}$/u);
  }
  assert.equal(isSkillCooldownColor({ kind: "custom", value: "#12aBcF" }), true);
  assert.equal(skillCooldownCssColor({ kind: "custom", value: "#12aBcF" }), "#12aBcF");
  for (const value of ["#fff", "#1234567", "123456", "#gg0000", "#12345 "]) {
    assert.equal(isSkillCooldownColor({ kind: "custom", value }), false);
  }
  assert.equal(isSkillCooldownColor({ kind: "preset", preset: "green" }), false);
  assert.equal(isSkillCooldownColor({ kind: "preset", preset: "red", extra: true }), false);
});
