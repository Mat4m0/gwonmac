import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRangeHeader } from "../../src/main/core/ranges.js";

describe("ranges", () => {
  it("parses closed, open-ended, and suffix ranges", () => {
    assert.deepEqual(parseRangeHeader("bytes=10-19", 100), { start: 10, end: 19 });
    assert.deepEqual(parseRangeHeader("bytes=10-", 100), { start: 10, end: 99 });
    assert.deepEqual(parseRangeHeader("bytes=-8", 100), { start: 92, end: 99 });
  });

  it("returns null without a usable Range header", () => {
    assert.equal(parseRangeHeader(null, 100), null);
    assert.equal(parseRangeHeader("bytes=-", 100), null);
    assert.equal(parseRangeHeader("birds=1-2", 100), null);
  });

  it("marks unsatisfiable ranges", () => {
    assert.equal(parseRangeHeader("bytes=999-1000", 100), "unsatisfiable");
    assert.equal(parseRangeHeader("bytes=50-40", 100), "unsatisfiable");
  });
});
