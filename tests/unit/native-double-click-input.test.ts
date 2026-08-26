import assert from "node:assert/strict";
import test from "node:test";
import { nativeDoubleClickFlagForPress } from "../../src/renderer/native-double-click.ts";

const press = (button: number, detail: number, isTrusted = true) =>
  nativeDoubleClickFlagForPress({ button, detail, isTrusted });

test("trusted presses set or clear the native flag without stale state", () => {
  assert.equal(press(0, 2), 1, "a trusted double-left press sets the flag");
  assert.equal(press(0, 1), 0, "the next ordinary left press clears it");
  assert.equal(press(2, 2), 0, "right-button click runs never inherit it");
  assert.equal(press(0, 4), 1, "every even trusted left press sets it");
});

test("untrusted events cannot change the native flag", () => {
  assert.equal(press(0, 2, false), null);
  assert.equal(press(2, 2, false), null);
});
