import { AppError, HttpStatusError } from "../../shared/errors.js";
import { FATAL_HTTP } from "./access-key.js";

export type PatchFetch = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string; maxBytes?: number },
) => Promise<{ status: number; body: Uint8Array }>;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function fetchPatchBytes(options: {
  fetch: PatchFetch;
  url: string;
  headers: Record<string, string>;
  tries?: number;
  maxBytes: number;
  onAttempt?: (durationMs: number) => void;
}): Promise<Uint8Array> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new AppError("response_limit", "response limit must be positive");
  }
  const tries = options.tries ?? 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    const started = performance.now();
    try {
      const { status, body } = await options.fetch(options.url, {
        headers: options.headers,
        maxBytes: options.maxBytes,
      });
      if (status === 200) {
        if (body.byteLength > options.maxBytes) {
          throw new AppError(
            "response_too_large",
            `${options.url}: response exceeds ${options.maxBytes} bytes`,
          );
        }
        options.onAttempt?.(performance.now() - started);
        return body;
      }
      const error = new HttpStatusError(
        status,
        `${options.url}: HTTP ${status}`,
      );
      lastError = error;
      if (FATAL_HTTP.has(status) || (status >= 300 && status < 400)) throw error;
      options.onAttempt?.(performance.now() - started);
    } catch (error) {
      options.onAttempt?.(performance.now() - started);
      lastError = error;
      if (
        error instanceof HttpStatusError &&
        (FATAL_HTTP.has(error.status) || (error.status >= 300 && error.status < 400))
      ) {
        throw error;
      }
      if (error instanceof AppError && error.code === "response_too_large") throw error;
    }
    if (attempt < tries - 1) await sleep(2 ** attempt * 1_000);
  }
  throw lastError instanceof Error
    ? lastError
    : new AppError("fetch_failed", String(lastError));
}

export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError(
      "response_too_large",
      `response exceeds ${maxBytes} bytes`,
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError(
          "response_too_large",
          `response exceeds ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
