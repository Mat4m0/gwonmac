import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseSkillNames } from "../../src/main/core/skill-assets.ts";

describe("local skill names", () => {
  it("follows explicit enum jumps instead of assuming source line numbers are ids", () => {
    const names = parseSkillNames(`
      enum class SkillID : uint32_t {
        No_Skill = 0,
        First,
        Jump = 12,
        After_Jump,
      };
    `);
    assert.equal(names.get(0), "No Skill");
    assert.equal(names.get(1), "First");
    assert.equal(names.get(12), "Jump");
    assert.equal(names.get(13), "After Jump");
    assert.equal(names.has(2), false);
  });

  it("reads the vendored vocabulary at the client ids templates carry", () => {
    const source = readFileSync(
      path.resolve("src/native/skill-icons/vendor/gwca/Skills.h"),
      "utf8",
    );
    const names = parseSkillNames(source);
    assert.equal(names.get(25), "Power Drain");
    assert.equal(names.get(282), "Word of Healing");
    assert.equal(names.get(288), "Healing Breeze");
    assert.equal(names.get(314), "Restore Life");
    assert.ok(names.size > 3_000);
  });
});
