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

  it("matches the platform primary modifier", () => {
    const binding = { key: "k", shift: true, option: false };
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: true, control: false, shift: true, alt: false,
    }, "macos"), true);
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: false, control: true, shift: true, alt: false,
    }, "macos"), false);
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: false, control: true, shift: true, alt: false,
    }, "windows"), true);
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: true, control: true, shift: true, alt: false,
    }, "windows"), false);
    assert.equal(shortcutMatches(binding, {
      code: "KeyK", meta: true, control: false, shift: false, alt: false,
    }, "macos"), false);
  });

  it("normalizes physical Command chords across Option-modified layouts", () => {
    assert.deepEqual(shortcutFromInput({
      code: "KeyK", meta: true, control: false, shift: true, alt: true,
    }, "macos"), { key: "k", shift: true, option: true });
    assert.equal(shortcutFromInput({
      code: "F1", meta: true, control: false, shift: false, alt: false,
    }, "macos"), null);
    assert.equal(shortcutFromInput({
      code: "KeyK", meta: false, control: false, shift: false, alt: false,
    }, "macos"), null);
    assert.equal(shortcutFromInput({
      code: "KeyK", meta: true, control: true, shift: false, alt: false,
    }, "macos"), null);
  });

  it("refuses Windows AltGr while accepting Ctrl and Ctrl-Shift", () => {
    assert.deepEqual(shortcutFromInput({
      code: "KeyT", meta: false, control: true, shift: false, alt: false,
    }, "windows"), { key: "t", shift: false, option: false });
    assert.deepEqual(shortcutFromInput({
      code: "KeyT", meta: false, control: true, shift: true, alt: false,
    }, "windows"), { key: "t", shift: true, option: false });
    assert.equal(shortcutFromInput({
      code: "KeyQ", meta: false, control: true, shift: false, alt: true,
    }, "windows"), null);
  });

  it("protects editing and lifecycle shortcuts and finds action conflicts", () => {
    assert.equal(shortcutReserved({ key: "c", shift: false, option: false }), true);
    assert.equal(shortcutReserved({ key: "c", shift: true, option: false }), false);
    assert.equal(shortcutReserved({ key: "1", shift: false, option: false }), true);
    assert.equal(shortcutReserved({ key: "0", shift: false, option: false }), false);
    assert.equal(shortcutConflict(
      "tools.toggle",
      DEFAULT_SHORTCUTS["storage.open"],
      DEFAULT_SHORTCUTS,
    ), "storage.open");
  });

  it("formats the same binding for Electron and for players", () => {
    const binding = { key: "c", shift: true, option: false };
    assert.equal(shortcutAccelerator(binding, "macos"), "Command+Shift+C");
    assert.equal(shortcutAccelerator(binding, "windows"), "Control+Shift+C");
    assert.equal(shortcutDisplay(binding, "macos"), "⌘⇧C");
    assert.equal(shortcutDisplay(binding, "windows"), "Ctrl+Shift+C");
    assert.equal(shortcutDisplay(null, "windows"), "Not set");
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
