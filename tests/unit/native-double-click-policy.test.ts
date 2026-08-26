/** The renderer writes only Chromium's trusted primary-button click count. */
import assert from "node:assert/strict";
import test from "node:test";
import { applyNativeDoubleClickPress } from
  "../../src/renderer/native-double-click.ts";

const press = (isTrusted: boolean, button: number, detail: number) =>
  ({ isTrusted, button, detail });

test("native double-click state is written and cleared on every trusted press", () => {
  const flag = { value: 0 };
  assert.equal(applyNativeDoubleClickPress(press(true, 0, 2), flag), true);
  assert.equal(flag.value, 1);
  assert.equal(applyNativeDoubleClickPress(press(true, 0, 1), flag), true);
  assert.equal(flag.value, 0, "an ordinary press clears stale double-click state");
  flag.value = 1;
  assert.equal(applyNativeDoubleClickPress(press(true, 2, 2), flag), true);
  assert.equal(flag.value, 0, "a right press cannot inherit a left double-click");
});

test("untrusted input cannot write the native flag", () => {
  const flag = { value: 1 };
  assert.equal(applyNativeDoubleClickPress(press(false, 0, 2), flag), false);
  assert.equal(flag.value, 1);
});
