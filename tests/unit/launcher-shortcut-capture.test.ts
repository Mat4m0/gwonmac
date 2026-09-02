/** Native capture owns cancellation, reserved bindings, and every action's conflicts. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { BrowserWindow, Input } from "electron";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.ts";
import { captureLauncherShortcut } from "../../src/main/launcher-shortcut-capture.ts";

function fixture() {
  const events = Object.assign(new EventEmitter(), { webContents: new EventEmitter() });
  const win = events as unknown as BrowserWindow;
  const send = (key: string, code: string, extra: Partial<Input> = {}) => {
    let prevented = false;
    events.webContents.emit("before-input-event", { preventDefault() { prevented = true; } }, {
      type: "keyDown", key, code, meta: true, control: false, shift: false, alt: false, isAutoRepeat: false, ...extra,
    });
    return prevented;
  };
  return { events, win, send };
}
test("ignores bare modifiers and detects conflicts with Core shortcuts", async () => {
  const f = fixture();
  const result = captureLauncherShortcut(f.win, "cartography.grid.toggle", () => DEFAULT_SETTINGS);
  assert.equal(f.send("Meta", "MetaLeft"), false);
  assert.equal(f.send("r", "KeyR"), true);
  assert.deepEqual(await result, { status: "conflict", action: "character.switch", binding: { key: "r", shift: false, option: false } });
  assert.equal(f.events.webContents.listenerCount("before-input-event"), 0);
  assert.equal(f.events.listenerCount("blur"), 0);
});
test("clears, rejects reserved shortcuts, and cancels on blur without leaking listeners", async () => {
  for (const [key, code, status] of [["Backspace", "Backspace", "cleared"], ["q", "KeyQ", "reserved"], ["Escape", "Escape", "cancelled"]] as const) {
    const f = fixture();
    const result = captureLauncherShortcut(f.win, "travel.open", () => DEFAULT_SETTINGS);
    f.send(key, code);
    assert.deepEqual(await result, { status });
  }
  const f = fixture();
  const first = captureLauncherShortcut(f.win, "travel.open", () => DEFAULT_SETTINGS);
  const second = captureLauncherShortcut(f.win, "cartography.grid.toggle", () => DEFAULT_SETTINGS);
  assert.deepEqual(await first, { status: "cancelled" });
  assert.equal(f.events.webContents.listenerCount("before-input-event"), 1);
  f.events.emit("blur");
  assert.deepEqual(await second, { status: "cancelled" });
  assert.equal(f.events.webContents.listenerCount("before-input-event"), 0);
});
