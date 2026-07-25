import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Manifest } from "../../src/main/core/manifest.js";
import { AppError } from "../../src/shared/errors.js";

const hashA = "a".repeat(32);
const hashB = "b".repeat(32);

describe("manifest", () => {
  it("accepts flat files and finds by basename", () => {
    const mf = new Manifest({
      compressionMode: "none",
      chunkSize: 4,
      files: [{ name: "a.bin", size: 6, chunkHashes: [hashA, hashB] }],
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
          chunkHashes: [hashA],
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
          files: [{ name: "a", size: 99, chunkHashes: [hashA] }],
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
          files: [{ name: "a.bin", size: 6, chunkHashes: [hashA, hashB] }],
        }),
      (e: unknown) => e instanceof AppError && e.code === "bad_compression",
    );
  });

  it("rejects cycles and invalid parent indexes", () => {
    assert.throws(
      () =>
        new Manifest({
          compressionMode: "none",
          chunkSize: 4,
          directories: [
            { name: "root" },
            { name: "a", parentIndex: 2 },
            { name: "b", parentIndex: 1 },
          ],
        }),
      (e: unknown) => e instanceof AppError && e.code === "manifest_cycle",
    );
    assert.throws(
      () =>
        new Manifest({
          compressionMode: "none",
          chunkSize: 4,
          directories: [{ name: "root" }],
          files: [{ name: "a", size: 1, chunkHashes: [hashA], parentIndex: 9 }],
        }),
      (e: unknown) => e instanceof AppError && e.code === "manifest_parent",
    );
  });

  it("rejects unsafe names, duplicate paths, and invalid sizes", () => {
    for (const name of ["", "..", "__proto__", "a/b", "a\\b", "a\0b"]) {
      assert.throws(
        () =>
          new Manifest({
            compressionMode: "none",
            chunkSize: 4,
            files: [{ name, size: 1, chunkHashes: [hashA] }],
          }),
        (e: unknown) => e instanceof AppError && e.code === "manifest_name",
      );
    }
    assert.throws(
      () =>
        new Manifest({
          compressionMode: "none",
          chunkSize: 4,
          files: [
            { name: "a", size: 1, chunkHashes: [hashA] },
            { name: "a", size: 1, chunkHashes: [hashA] },
          ],
        }),
      (e: unknown) => e instanceof AppError && e.code === "manifest_duplicate",
    );
    for (const size of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () =>
          new Manifest({
            compressionMode: "none",
            chunkSize: 4,
            files: [{ name: "a", size, chunkHashes: [] }],
          }),
        (e: unknown) => e instanceof AppError && e.code === "manifest_size",
      );
    }
  });

  it("rejects conflicting lengths for one content hash", () => {
    assert.throws(
      () =>
        new Manifest({
          compressionMode: "none",
          chunkSize: 4,
          files: [
            { name: "a", size: 4, chunkHashes: [hashA] },
            { name: "b", size: 3, chunkHashes: [hashA] },
          ],
        }),
      (e: unknown) => e instanceof AppError && e.code === "chunk_length",
    );
  });

  it("requires exactly one copy of each product basename", () => {
    const mf = new Manifest({
      compressionMode: "none",
      chunkSize: 4,
      directories: [{ name: "unused" }, { name: "nested" }],
      files: [
        { name: "Gw.jspi.wasm", size: 1, chunkHashes: [hashA] },
        {
          name: "Gw.jspi.wasm",
          size: 1,
          chunkHashes: [hashA],
          parentIndex: 1,
        },
      ],
    });
    assert.throws(
      () => mf.requireUniqueBasenames(["Gw.jspi.wasm"]),
      (e: unknown) => e instanceof AppError && e.code === "manifest_required",
    );
    assert.throws(
      () => mf.requireUniqueBasenames(["Gw.snapshot"]),
      (e: unknown) => e instanceof AppError && e.code === "manifest_required",
    );
  });
});
