import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRangeHeader,
  contentRangeHeader,
  rangeLength,
  requireSnapshotRange,
} from "../../src/main/core/ranges.js";
import { AppError } from "../../src/shared/errors.js";

describe("ranges", () => {
  it("parses closed, open-ended, and suffix ranges", () => {
    assert.deepEqual(parseRangeHeader("bytes=10-19", 100), { start: 10, end: 19 });
    assert.deepEqual(parseRangeHeader("bytes=10-", 100), { start: 10, end: 99 });
    assert.deepEqual(parseRangeHeader("bytes=-8", 100), { start: 92, end: 99 });
    assert.equal(rangeLength({ start: 10, end: 19 }), 10);
    assert.equal(contentRangeHeader(10, 19, 100), "bytes 10-19/100");
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

  it("refuses whole-file snapshot reads", () => {
    assert.throws(() => requireSnapshotRange(null, 100), (e: unknown) => {
      assert.ok(e instanceof AppError);
      assert.equal(e.code, "range_required");
      return true;
    });
    assert.deepEqual(requireSnapshotRange("bytes=0-31", 100), { start: 0, end: 31 });
  });
});
