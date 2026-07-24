import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePublishedClientManifest,
} from "../../src/main/core/published-client.ts";
import { AppError } from "../../src/shared/errors.ts";

describe("published client manifest", () => {
  const valid = {
    compressionMode: "gzip",
    chunkSize: 4,
    snapshot: "Gw.snapshot",
    size: 5,
    chunkHashes: ["first", "second"],
  };

  it("returns a canonical detached manifest", () => {
    const parsed = parsePublishedClientManifest(valid);
    assert.deepEqual(parsed, valid);
    assert.notEqual(parsed.chunkHashes, valid.chunkHashes);
  });

  it("rejects invalid snapshot identity, dimensions, and chunk count", () => {
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, snapshot: "Other.bin" }),
      AppError,
    );
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, chunkSize: 0 }),
      AppError,
    );
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, size: -1 }),
      AppError,
    );
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, chunkHashes: ["only"] }),
      AppError,
    );
  });
});
