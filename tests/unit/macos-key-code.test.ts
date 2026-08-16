import assert from "node:assert/strict";
import { test } from "node:test";
import { physicalCodeForMacKeyCode } from "../../src/main/core/macos-key-code.js";

test("macOS key positions cover movement and player-bindable keys", () => {
  const physicalCodes = Array.from(
    { length: 0x80 },
    (_, keyCode) => physicalCodeForMacKeyCode(keyCode),
  ).filter((code): code is string => code !== null);
  assert.equal(physicalCodes.length, 120);
  assert.equal(new Set(physicalCodes).size, physicalCodes.length);
  for (const code of [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((key) => `Key${key}`),
    ..."0123456789".split("").map((key) => `Digit${key}`),
    ...Array.from({ length: 20 }, (_, index) => `F${index + 1}`),
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Space", "Tab", "Enter", "Escape", "Backspace", "Delete",
  ]) {
    assert.ok(physicalCodes.includes(code), `${code} has no macOS position`);
  }
  assert.deepEqual(
    [0x00, 0x01, 0x02, 0x0c, 0x0d].map(physicalCodeForMacKeyCode),
    ["KeyA", "KeyS", "KeyD", "KeyQ", "KeyW"],
  );
  assert.equal(physicalCodeForMacKeyCode(0x12), "Digit1");
  assert.equal(physicalCodeForMacKeyCode(0x31), "Space");
  assert.equal(physicalCodeForMacKeyCode(0x41), "NumpadDecimal");
  assert.equal(physicalCodeForMacKeyCode(0x7b), "ArrowLeft");
  assert.equal(physicalCodeForMacKeyCode(0x7a), "F1");
  assert.equal(physicalCodeForMacKeyCode(0xff), null);
});
