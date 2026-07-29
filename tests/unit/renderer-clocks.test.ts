import assert from "node:assert/strict";
import { test } from "node:test";
import { RendererClocks } from "../../src/main/renderer-clocks.js";

test("renderer clock offsets belong to exact owner objects", () => {
  const clocks = new RendererClocks<object>();
  const first = {};
  const second = {};
  clocks.synchronize(first, 500);

  assert.deepEqual(clocks.translate(first, 1_000, 9_000), {
    synchronized: true,
    timestampUs: 1_500,
  });
  assert.deepEqual(clocks.translate(second, 1_000, 9_000), {
    synchronized: false,
    timestampUs: 9_000,
  });
});

test("translated renderer time is integral and never negative", () => {
  const clocks = new RendererClocks<object>();
  const owner = {};
  clocks.synchronize(owner, -1_000.25);
  assert.deepEqual(clocks.translate(owner, 100, 7_000), {
    synchronized: true,
    timestampUs: 0,
  });
});
