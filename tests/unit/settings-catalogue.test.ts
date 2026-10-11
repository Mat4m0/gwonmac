import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSettingsTarget } from "../../src/shared/settings-catalogue.js";

describe("Settings deep-link targets", () => {
  it("accepts a section, or a control inside its own section", () => {
    assert.deepEqual(parseSettingsTarget({ section: "updates" }), { section: "updates" });
    assert.deepEqual(parseSettingsTarget({ section: "game", control: "extendedMemoryEnabled" }), { section: "game", control: "extendedMemoryEnabled" });
    assert.deepEqual(parseSettingsTarget({ section: "tools", control: "tool:quick-travel" }), { section: "tools", control: "tool:quick-travel" });
  });

  it("refuses targets a renderer could use to reach anything else", () => {
    for (const value of [
      null,
      "game",
      ["game"],
      {},
      { section: "accounts" },
      { section: "game", control: "nope" },
      { section: "updates", control: "extendedMemoryEnabled" },
      { section: "game", control: 1 },
      { section: "game", url: "https://example.com" },
    ]) {
      assert.throws(() => parseSettingsTarget(value), JSON.stringify(value));
    }
  });
});
