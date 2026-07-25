import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fullDownloadFailureMessage } from "../../src/main/core/recovery.js";

describe("recovery messages", () => {
  it("offers one concrete action for disk failures, including nested causes", () => {
    const disk = Object.assign(new Error("write failed"), { code: "ENOSPC" });
    const wrapped = new Error("download failed", { cause: disk });
    assert.equal(
      fullDownloadFailureMessage(wrapped),
      "There is not enough free disk space to download the full game. Free some space, then choose Resume Download.",
    );
  });

  it("offers resume after network and unknown failures", () => {
    assert.equal(
      fullDownloadFailureMessage(new Error("timeout")),
      "The download could not continue. Check your connection, then choose Resume Download.",
    );
  });
});
