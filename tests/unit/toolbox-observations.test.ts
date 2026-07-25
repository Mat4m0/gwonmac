import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolboxObservations } from "../../src/tools/toolbox-observations.js";

describe("Toolbox scoped observations", () => {
  it("accepts only bounded typed scalar addresses", () => {
    assert.deepEqual(parseToolboxObservations("u32:0x10,f32:32"), [
      { type: "u32", address: 16 },
      { type: "f32", address: 32 },
    ]);
    assert.throws(() => parseToolboxObservations("bytes:0x10"), /invalid/);
    assert.throws(
      () => parseToolboxObservations(
        Array.from({ length: 17 }, (_, index) => `u8:${index}`).join(","),
      ),
      /at most 16/,
    );
  });
});
