import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHORTCUTS,
  isShortcutOverrides,
  resolveShortcuts,
  shortcutAccelerator,
  shortcutConflict,
  shortcutDisplay,
  shortcutEquals,
  shortcutKeycaps,
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
      "game.call-target": DEFAULT_SHORTCUTS["game.call-target"],
      "game.resign": DEFAULT_SHORTCUTS["game.resign"],
      "character.switch": DEFAULT_SHORTCUTS["character.switch"],
      "tools.toggle": { key: "k", shift: true, option: false },
      "whispers.toggle": { key: "d", shift: false, option: false },
      "trade.toggle": DEFAULT_SHORTCUTS["trade.toggle"],
      "storage.open": null,
      "travel.open": DEFAULT_SHORTCUTS["travel.open"],
    });
  });

  it("keeps an existing Command-G binding ahead of the new target-call default", () => {
    const overrides = { "tools.toggle": DEFAULT_SHORTCUTS["game.call-target"] };
    assert.equal(resolveShortcuts(overrides)["game.call-target"], null);
    assert.deepEqual(resolveShortcuts(overrides)["tools.toggle"], overrides["tools.toggle"]);
    assert.equal(resolveShortcuts({ "game.call-target": null })["game.call-target"], null);
    assert.deepEqual(resolveShortcuts({ "game.call-target": { key: "j", shift: false, option: false } })["game.call-target"], { key: "j", shift: false, option: false });
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
    assert.deepEqual(shortcutFromInput({
      code: "F1", meta: true, control: false, shift: false, alt: false,
    }), { key: "f1", shift: false, option: false });
    assert.equal(shortcutFromInput({
      code: "KeyK", meta: false, control: false, shift: false, alt: false,
    }), null);
    assert.deepEqual(shortcutFromInput({
      code: "KeyK", meta: true, control: true, shift: false, alt: false,
    }), { key: "k", shift: false, option: false, control: true });
  });

  it("protects editing and lifecycle shortcuts and finds action conflicts", () => {
    assert.equal(shortcutReserved({ key: "c", shift: false, option: false }), true);
    assert.equal(shortcutReserved({ key: "c", shift: true, option: false }), false);
    assert.equal(shortcutReserved({ key: "1", shift: false, option: false }), true);
    assert.equal(shortcutReserved({ key: "0", shift: false, option: false }), false);
    assert.equal(shortcutReserved({ key: "r", shift: false, option: false }), false);
    assert.equal(shortcutReserved({ key: "r", shift: true, option: false }), false);
    assert.equal(shortcutConflict(
      "tools.toggle",
      DEFAULT_SHORTCUTS["storage.open"],
      DEFAULT_SHORTCUTS,
    ), "storage.open");
  });

  it("formats the same binding for Electron and for players", () => {
    const binding = { key: "c", shift: true, option: false };
    assert.equal(shortcutAccelerator(binding), "Command+Shift+C");
    assert.equal(shortcutDisplay(binding), "⇧⌘C");
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


it('captures, persists and exactly matches every modifier combination', () => {
  for (const meta of [false,true]) for (const control of [false,true]) for (const alt of [false,true]) for (const shift of [false,true]) {
    const input = { code:'KeyJ', meta, control, alt, shift };
    const binding = shortcutFromInput(input);
    if (!meta && !control && !alt) { assert.equal(binding,null); continue; }
    assert.ok(binding); assert.ok(isShortcutOverrides({'character.switch':binding}));
    assert.equal(shortcutMatches(binding,input),true);
    assert.equal(shortcutMatches(binding,{...input,control:!control}),false);
    assert.equal(shortcutMatches(binding,{...input,meta:!meta}),false);
    assert.equal(shortcutEquals(binding,JSON.parse(JSON.stringify(binding))),true);
  }
  assert.equal(shortcutEquals({key:'j',option:false,shift:false},{key:'j',option:false,shift:false,command:true,control:false}),true);
});
it('supports function, navigation, punctuation and numpad keys through the same model', () => {
  for (const code of ['F1','F24','Space','Tab','Enter','ArrowLeft','ArrowUp','Home','End','PageUp','PageDown','Minus','Equal','BracketLeft','Backslash','Semicolon','Numpad0','NumpadAdd']) {
    const input = { code, meta:false, control:true, alt:true, shift:false };
    const binding = shortcutFromInput(input); assert.ok(binding,code);
    assert.equal(shortcutMatches(binding,input),true,code);
    assert.equal(isShortcutOverrides({'travel.open':binding}),true,code);
    assert.ok(shortcutAccelerator(binding)?.startsWith('Control+Alt+'));
    assert.deepEqual(shortcutKeycaps(binding).slice(0,2).map(cap=>cap.name),['Control','Option']);
  }
  assert.deepEqual(shortcutFromInput({code:'F12',meta:false,control:false,alt:false,shift:false}),{key:'f12',shift:false,option:false,command:false});
  assert.equal(shortcutFromInput({code:'F25',meta:true,control:false,alt:false,shift:false}),null);
});
