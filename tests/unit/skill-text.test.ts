import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeSkillDescription,
  encodeTextId,
  finishSkillDescription,
  type SkillDescriptionSource,
} from "../../src/renderer/skill-text.js";

const source: SkillDescriptionSource = {
  stringId: 59_371,
  scale0: 5,
  scale15: 80,
  bonusScale0: 12,
  bonusScale15: 12,
  duration0: 1,
  duration15: 16,
};

describe("installed-client skill text", () => {
  it("encodes short and extended numeric string ids", () => {
    assert.deepEqual(encodeTextId(25_774), [26_030]);
    assert.deepEqual(encodeTextId(59_371), [0xe7eb, 0x101]);
    assert.throws(() => encodeTextId(-1), /outside/);
  });

  it("appends the three official skill-description substitutions", () => {
    assert.deepEqual(
      [...encodeSkillDescription(source)],
      [
        0xe7eb, 0x101,
        0x10a, 0x104, 0x101, 0x100 + 991, 0x001,
        0x10b, 0x104, 0x101, 0x100 + 12, 0x001,
        0x10c, 0x104, 0x101, 0x100 + 993, 0x001,
        0,
      ],
    );
  });

  it("expands ranges and removes renderer-only control characters", () => {
    assert.equal(
      finishSkillDescription(
        "\u0002Heal for 991 plus 12. Lasts 993 seconds.\u0001",
        source,
      ),
      "Heal for 5–80 plus 12. Lasts 1–16 seconds.",
    );
  });
});
