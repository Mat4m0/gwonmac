import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHORTCUTS,
  isShortcutOverrides,
  resolveShortcuts,
  shortcutAccelerator,
  shortcutConflict,
  shortcutDisplay,
  shortcutFromInput,
  shortcutMatches,
  shortcutReserved,
  withShortcutOverride,
} from "../../src/shared/keyboard-shortcuts.js";

describe("keyboard shortcuts", () => {
  it("uses defaults until a player replaces or clears one action", () => {
    assert.deepEqual(resolveShortcuts({}), DEFAULT_SHORTCUTS);
    assert.deepEqual(resolveShortcuts({
      "tools.toggle": { key: "k", shift: true, option: false },
      "storage.open": null,
    }), {
      "cartography.grid.toggle": null,
      "cartography.walkability.toggle": null,
      "character.switch": DEFAULT_SHORTCUTS["character.switch"],
      "tools.toggle": { key: "k", shift: true, option: false },
      "trade.toggle": DEFAULT_SHORTCUTS["trade.toggle"],
      "storage.open": null,
      "travel.open": DEFAULT_SHORTCUTS["travel.open"],
    });
  });

  it("stores only differences from defaults", () => {
    assert.deepEqual(withShortcutOverride(
      { "tools.toggle": { key: "k", shift: false, option: false } },
      "tools.toggle",
      DEFAULT_SHORTCUTS["tools.toggle"],
    ), {});
    assert.deepEqual(withShortcutOverride({}, "tools.toggle", null), {
      "tools.toggle": null,
    });
  });

  it("matches only Command and keeps Control chords in the game", () => {
    const binding = { key: "k", shift: true, option: false };
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: true, control: false, shift: true, alt: false,
    }), true);
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: false, control: true, shift: true, alt: false,
    }), false);
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: true, control: true, shift: true, alt: false,
    }), false);
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: true, control: false, shift: false, alt: false,
    }), false);
  });

  it("normalizes physical Command chords across Option-modified layouts", () => {
    assert.deepEqual(shortcutFromInput({
      code: "KeyK", meta: true, control: false, shift: true, alt: true,
    }), { key: "k", shift: true, option: true });
    assert.equal(shortcutFromInput({
      code: "F1", meta: true, control: false, shift: false, alt: false,
    }), null);
    assert.equal(shortcutFromInput({
      code: "KeyK", meta: false, control: false, shift: false, alt: false,
    }), null);
    assert.equal(shortcutFromInput({
      code: "KeyK", meta: true, control: true, shift: false, alt: false,
    }), null);
  });

  it("protects editing and lifecycle shortcuts and finds action conflicts", () => {
    assert.equal(shortcutReserved({ key: "c", shift: false, option: false }), true);
    assert.equal(shortcutReserved({ key: "c", shift: true, option: false }), false);
    assert.equal(shortcutReserved({ key: "1", shift: false, option: false }), true);
    assert.equal(shortcutReserved({ key: "0", shift: false, option: false }), false);
    assert.equal(shortcutReserved({ key: "r", shift: false, option: false }), false);
    assert.equal(shortcutReserved({ key: "r", shift: true, option: false }), true);
    assert.equal(shortcutConflict(
      "tools.toggle",
      DEFAULT_SHORTCUTS["storage.open"],
      DEFAULT_SHORTCUTS,
    ), "storage.open");
  });

  it("formats the same binding for Electron and for players", () => {
    const binding = { key: "c", shift: true, option: false };
    assert.equal(shortcutAccelerator(binding), "Command+Shift+C");
    assert.equal(shortcutDisplay(binding), "⌘⇧C");
    assert.equal(shortcutDisplay(null), "Not set");
  });

  it("refuses unknown actions, keys, fields, and modifier types", () => {
    assert.equal(isShortcutOverrides({
      "tools.toggle": { key: "b", shift: false, option: false },
    }), true);
    assert.equal(isShortcutOverrides({ mystery: null }), false);
    assert.equal(isShortcutOverrides({
      "tools.toggle": { key: "F1", shift: false, option: false },
    }), false);
    assert.equal(isShortcutOverrides({
      "tools.toggle": { key: "b", shift: false, option: false, extra: true },
    }), false);
  });
});
