import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import {
  decodeChunk,
  encodedChunkLimit,
} from "../../src/main/core/chunk-format.ts";
import {
  createBoundedPatchFetch,
  fetchPatchBytes,
  readBoundedResponse,
} from "../../src/main/core/patch-transport.ts";
import { PATCH_REQUEST_HEADERS } from "../../src/main/core/access-key.ts";
import { AppError, HttpStatusError } from "../../src/shared/errors.ts";

const headers = { "X-Test": "1" };

describe("patch transport", () => {
  it("owns patch identity, redirect policy, caller abort, and response bounds", async () => {
    const controller = new AbortController();
    const reason = new AppError("download_stopped", "controlled request abort");
    let observedUrl = "";
    // Collected rather than held in a `let`: TypeScript narrows a `let` seeded
    // with `null` and cannot see the callback assign it, so every field read
    // below would be a read off `never`. The list also says how many times the
    // bounded fetch reached the underlying one, which was previously implicit.
    const observedRequests: RequestInit[] = [];
    const fetch = createBoundedPatchFetch(async (url, request) => {
      observedUrl = url;
      observedRequests.push(request);
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }, 30_000);

    assert.deepEqual(
      await fetch("https://fixture.invalid/chunk", {
        headers: PATCH_REQUEST_HEADERS,
        maxBytes: 4,
        signal: controller.signal,
      }),
      { status: 200, body: new Uint8Array([1, 2, 3, 4]) },
    );
    assert.equal(observedRequests.length, 1);
    const [observedRequest] = observedRequests;
    assert.equal(observedUrl, "https://fixture.invalid/chunk");
    assert.equal(observedRequest?.redirect, "manual");
    assert.equal(observedRequest?.method, "GET");
    assert.deepEqual(observedRequest?.headers, PATCH_REQUEST_HEADERS);
    assert.equal(
      PATCH_REQUEST_HEADERS["User-Agent"],
      "gwonmac (Guild Wars interoperability client)",
    );
    assert.equal(observedRequest?.signal?.aborted, false);
    controller.abort(reason);
    assert.equal(observedRequest?.signal?.aborted, true);
    assert.equal(observedRequest?.signal?.reason, reason);

    const oversized = createBoundedPatchFetch(
      async () => new Response(new Uint8Array(5)),
      30_000,
    );
    await assert.rejects(
      () =>
        oversized("https://fixture.invalid/chunk", {
          headers: PATCH_REQUEST_HEADERS,
          maxBytes: 4,
        }),
      (error: unknown) =>
        error instanceof AppError && error.code === "response_too_large",
    );
  });

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

  it("classifies a request that never got an HTTP answer as net_offline", async () => {
    // Chromium's net.fetch throws a plain TypeError when offline; without
    // classification at this seam it would collapse to `unknown` and the
    // renderer could not tell a dead connection from an app fault.
    await assert.rejects(
      () =>
        fetchPatchBytes({
          fetch: async () => {
            throw new TypeError("net::ERR_INTERNET_DISCONNECTED");
          },
          url: "https://fixture.invalid/chunk",
          headers,
          maxBytes: 4,
          tries: 1,
        }),
      (error: unknown) =>
        error instanceof AppError && error.code === "net_offline",
    );

    // An HTTP answer, even a failing one, keeps its own code through retries.
    await assert.rejects(
      () =>
        fetchPatchBytes({
          fetch: async () => ({ status: 503, body: new Uint8Array() }),
          url: "https://fixture.invalid/chunk",
          headers,
          maxBytes: 4,
          tries: 1,
        }),
      (error: unknown) =>
        error instanceof HttpStatusError && error.status === 503,
    );
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

  it("interrupts retry backoff without starting another request", async () => {
    const controller = new AbortController();
    const reason = new AppError(
      "download_stopped",
      "controlled retry interruption",
    );
    let calls = 0;
    const pending = fetchPatchBytes({
      fetch: async (_url, init) => {
        calls += 1;
        assert.equal(init?.signal, controller.signal);
        return { status: 500, body: new Uint8Array() };
      },
      url: "https://fixture.invalid/chunk",
      headers,
      maxBytes: 4,
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const began = performance.now();
    controller.abort(reason);

    await assert.rejects(pending, (error: unknown) => error === reason);
    assert.ok(performance.now() - began < 250);
    assert.equal(calls, 1);
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
