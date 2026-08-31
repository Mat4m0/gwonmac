/** The Windows update fixture always builds one immediate older Stable. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { windowsQualificationBaseline } from "../../scripts/windows-update-fixture.ts";

describe("Windows update fixture version", () => {
  it("selects the preceding Stable patch", () => {
    assert.equal(windowsQualificationBaseline("2026.8.10"), "2026.8.9");
  });

  it("refuses prereleases, malformed versions, and a missing prior patch", () => {
    for (const version of ["2026.8.10-beta.1", "2026.8.0", "latest"]) {
      assert.throws(() => windowsQualificationBaseline(version));
    }
  });
});
