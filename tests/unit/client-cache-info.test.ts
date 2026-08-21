import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  projectClientCacheInfo,
} from "../../src/main/core/client-cache-info.ts";
import { FREE_MARGIN } from "../../src/main/core/chunk-store.ts";

describe("client cache projection", () => {
  it("reports an empty cache without an active generation", async () => {
    assert.deepEqual(await projectClientCacheInfo(null, -1), {
      bytes: 0,
      chunks: 0,
      totalBytes: 0,
      totalChunks: 0,
      freeBytes: -1,
      fullDownloadShortfall: 0,
    });
  });

  it("projects exact residency and the pessimistic capacity shortfall", async () => {
    const info = await projectClientCacheInfo({
      chunksDir: "/cache",
      size: 1_000,
      hashes: ["a", "b", "c"],
      residentIndices: async () => [0, 2],
      chunkByteLength: (index) => index === 2 ? 200 : 400,
    }, 300);

    assert.deepEqual(info, {
      bytes: 600,
      chunks: 2,
      totalBytes: 1_000,
      totalChunks: 3,
      freeBytes: 300,
      fullDownloadShortfall: 400 + FREE_MARGIN - 300,
    });
  });

  it("does not invent a shortfall when capacity is unknown", async () => {
    const info = await projectClientCacheInfo({
      chunksDir: "/cache",
      size: 1_000,
      hashes: ["a"],
      residentIndices: async () => [],
      chunkByteLength: () => 1_000,
    }, -1);

    assert.equal(info.fullDownloadShortfall, 0);
    assert.equal(info.freeBytes, -1);
  });
});
