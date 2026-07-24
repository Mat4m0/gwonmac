import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import {
  decodeChunk,
  encodedChunkLimit,
} from "../../src/main/core/chunk-format.ts";
import {
  fetchPatchBytes,
  readBoundedResponse,
} from "../../src/main/core/patch-transport.ts";
import { AppError, HttpStatusError } from "../../src/shared/errors.ts";

const headers = { "X-Test": "1" };

describe("patch transport", () => {
  it("accepts only HTTP 200 and never follows redirects through retries", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        fetchPatchBytes({
          fetch: async () => {
            calls += 1;
            return { status: 302, body: new Uint8Array() };
          },
          url: "https://fixture.invalid/chunk",
          headers,
          maxBytes: 4,
        }),
      (error: unknown) => error instanceof HttpStatusError && error.status === 302,
    );
    assert.equal(calls, 1);
  });

  it("rejects a materialized body above its declared call-site limit", async () => {
    await assert.rejects(
      () =>
        fetchPatchBytes({
          fetch: async (_url, init) => {
            assert.equal(init?.maxBytes, 4);
            return { status: 200, body: new Uint8Array(5) };
          },
          url: "https://fixture.invalid/chunk",
          headers,
          maxBytes: 4,
        }),
      (error: unknown) =>
        error instanceof AppError && error.code === "response_too_large",
    );
  });

  it("bounds streamed bodies with and without content-length", async () => {
    const declared = new Response(new Uint8Array(5), {
      headers: { "content-length": "5" },
    });
    await assert.rejects(
      () => readBoundedResponse(declared, 4),
      (error: unknown) =>
        error instanceof AppError && error.code === "response_too_large",
    );

    const streamed = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(3));
          controller.enqueue(new Uint8Array(3));
          controller.close();
        },
      }),
    );
    await assert.rejects(
      () => readBoundedResponse(streamed, 4),
      (error: unknown) =>
        error instanceof AppError && error.code === "response_too_large",
    );
  });

  it("enforces exact decoded chunk lengths and gzip output bounds", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    assert.deepEqual(await decodeChunk(data, "none", 4), data);
    await assert.rejects(
      () => decodeChunk(data, "none", 3),
      (error: unknown) => error instanceof AppError && error.code === "chunk_length",
    );

    const compressed = gzipSync(data);
    assert.deepEqual([...(await decodeChunk(compressed, "gzip", 4))], [...data]);
    await assert.rejects(
      () => decodeChunk(compressed, "gzip", 3),
      (error: unknown) => error instanceof AppError && error.code === "chunk_decode",
    );
    assert.equal(encodedChunkLimit(4, "none"), 4);
    assert.ok(encodedChunkLimit(4, "gzip") > compressed.byteLength);
  });
});
