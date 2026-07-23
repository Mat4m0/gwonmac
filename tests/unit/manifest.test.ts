import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Manifest } from "../../src/main/core/manifest.js";
import { AppError } from "../../src/shared/errors.js";

describe("manifest", () => {
  it("accepts flat files and finds by basename", () => {
    const mf = new Manifest({
      compressionMode: "none",
      chunkSize: 4,
      files: [{ name: "a.bin", size: 6, chunkHashes: ["x", "y"] }],
    });
    assert.equal(mf.find("a.bin"), "a.bin");
    assert.equal(mf.compression, "none");
    assert.equal(mf.chunkSize, 4);
  });

  it("rebuilds nested paths via parentIndex", () => {
    const mf = new Manifest({
      compressionMode: "gzip",
      chunkSize: 4,
      // parentIndex 0 is falsy (root), so nesting starts from index >= 1
      directories: [
        { name: "pad" },
        { name: "client" },
        { name: "bin", parentIndex: 1 },
      ],
      files: [
        {
          name: "Gw.jspi.wasm",
          size: 4,
          chunkHashes: ["aa"],
          parentIndex: 2,
        },
      ],
    });
    assert.equal(mf.find("Gw.jspi.wasm"), "client/bin/Gw.jspi.wasm");
  });

  it("rejects chunk count mismatch", () => {
    assert.throws(
      () =>
        new Manifest({
          compressionMode: "none",
          chunkSize: 4,
          files: [{ name: "a", size: 99, chunkHashes: ["x"] }],
        }),
      (e: unknown) => e instanceof AppError && e.code === "chunk_count",
    );
  });

  it("rejects unknown compression", () => {
    assert.throws(
      () =>
        new Manifest({
          compressionMode: "brotli",
          chunkSize: 4,
          files: [{ name: "a.bin", size: 6, chunkHashes: ["x", "y"] }],
        }),
      (e: unknown) => e instanceof AppError && e.code === "bad_compression",
    );
  });
});
