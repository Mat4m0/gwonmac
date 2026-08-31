/** Verifies the launcher's public three-Tool projection and shortcut policy. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.ts";
import {
  allGlobalToolsPatch,
  globalToolPatch,
  launcherToolSettings,
  shortcutOwner,
} from "../../src/main/core/launcher-tools.ts";

describe("global launcher Tools", () => {
  it("projects only Build Management, Quick Travel, and Xunlai Storage", () => {
    const tools = launcherToolSettings(DEFAULT_SETTINGS);
    assert.deepEqual(Object.keys(tools), ["build-management", "quick-travel", "xunlai-storage"]);
    assert.equal(tools["quick-travel"].shortcut?.key, "t");
  });

  it("enables the complete fresh-install Tool set in one settings write", () => {
    assert.deepEqual(allGlobalToolsPatch(true), {
      gwonmacTools: true,
      buildLibrary: true,
      travelPalette: true,
      xunlaiStorage: true,
    });
    assert.deepEqual(globalToolPatch("xunlai-storage", false), { xunlaiStorage: false });
  });

  it("finds a conflict only among the three visible Tool shortcuts", () => {
    assert.equal(
      shortcutOwner({ key: "t", shift: false, option: false }, DEFAULT_SETTINGS, "build-management"),
      "quick-travel",
    );
    assert.equal(
      shortcutOwner({ key: "k", shift: false, option: false }, DEFAULT_SETTINGS, "build-management"),
      null,
    );
  });
});
