/** Every public feature and keyboard action shares the canonical settings policy. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.ts";
import { GLOBAL_TOOLS, GLOBAL_TOOL_FEATURES } from "../../src/shared/launcher-contracts.ts";
import { FEATURE_SELECTION_POLICIES, featureActivationRequested } from "../../src/shared/feature-contracts.ts";
import { DEFAULT_SHORTCUTS, resolveShortcuts } from "../../src/shared/keyboard-shortcuts.ts";
import { allGlobalToolsPatch, globalToolPatch, launcherToolSettings, launcherShortcutPatch } from "../../src/main/core/launcher-tools.ts";

describe("global launcher Tools", () => {
  it("projects every independently configurable feature from its canonical setting", () => {
    assert.deepEqual(Object.keys(launcherToolSettings(DEFAULT_SETTINGS)), GLOBAL_TOOLS);
    for (const tool of GLOBAL_TOOLS) {
      const id = GLOBAL_TOOL_FEATURES[tool];
      for (const enabled of [false, true]) {
        const settings = { ...DEFAULT_SETTINGS, gwonmacTools: true, ...globalToolPatch(tool, enabled) };
        assert.equal(launcherToolSettings(settings)[tool].enabled, enabled, tool);
        assert.equal(featureActivationRequested(id, settings), enabled, tool);
      }
    }
    const settings = new Set(GLOBAL_TOOLS.map(tool => FEATURE_SELECTION_POLICIES[GLOBAL_TOOL_FEATURES[tool]].activation.setting));
    for (const policy of Object.values(FEATURE_SELECTION_POLICIES)) {
      if (policy.activation.kind !== "master") assert.ok(settings.has(policy.activation.setting));
    }
  });

  it("preserves the existing fresh-install opt-in without enabling new features", () => {
    assert.deepEqual(allGlobalToolsPatch(true), { gwonmacTools: true, buildLibrary: true, travelPalette: true, xunlaiStorage: true });
    assert.deepEqual(globalToolPatch("maps", false), { cartographyEnabled: false });
    assert.deepEqual(globalToolPatch("character-switch", false), { characterSwitchEnabled: false });
  });

  it("replaces conflicts across Core, Trade, Travel, and Maps even when disabled", () => {
    for (const action of ["character.switch", "trade.toggle", "travel.open"] as const) {
      const patch = launcherShortcutPatch(DEFAULT_SETTINGS, "cartography.grid.toggle", DEFAULT_SHORTCUTS[action]);
      const resolved = resolveShortcuts(patch.shortcutOverrides!);
      assert.equal(resolved[action], null);
      assert.deepEqual(resolved["cartography.grid.toggle"], DEFAULT_SHORTCUTS[action]);
    }
    assert.throws(() => launcherShortcutPatch(DEFAULT_SETTINGS, "travel.open", { key: "q", shift: false, option: false }), /reserved/);
  });

  it("never lets a tool take Command-R while the Hub uses it, and keeps an older saved owner (HUB-095)", () => {
    const commandR = { key: "r", shift: false, option: false };
    assert.throws(() => launcherShortcutPatch(DEFAULT_SETTINGS, "travel.open", commandR), /Used by Hub/);
    // A binding saved before the Hub claimed Command-R stays the player's data and may be moved.
    const older = { ...DEFAULT_SETTINGS, shortcutOverrides: { "travel.open": commandR } };
    assert.deepEqual(resolveShortcuts(launcherShortcutPatch(older, "tools.toggle", commandR).shortcutOverrides!)["tools.toggle"], commandR);
  });

  it("clears map shortcuts back to an empty override without changing other preferences", () => {
    const settings = { ...DEFAULT_SETTINGS, shortcutOverrides: { "cartography.grid.toggle": { key: "g", shift: false, option: false } } };
    assert.deepEqual(launcherShortcutPatch(settings, "cartography.grid.toggle", null), { shortcutOverrides: {} });
    assert.equal(DEFAULT_SHORTCUTS["cartography.walkability.toggle"], null);
  });
});
