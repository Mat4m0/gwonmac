import { AppError, HttpStatusError } from "../../shared/errors.js";
import { FATAL_HTTP } from "./access-key.js";

export type PatchFetch = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string },
) => Promise<{ status: number; body: Uint8Array }>;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function fetchPatchBytes(options: {
  fetch: PatchFetch;
  url: string;
  headers: Record<string, string>;
  tries?: number;
  onAttempt?: (durationMs: number) => void;
}): Promise<Uint8Array> {
  const tries = options.tries ?? 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    const started = performance.now();
    try {
      const { status, body } = await options.fetch(options.url, {
        headers: options.headers,
      });
      if (status < 400) {
        options.onAttempt?.(performance.now() - started);
        return body;
      }
      const error = new HttpStatusError(
        status,
        `${options.url}: HTTP ${status}`,
      );
      lastError = error;
      if (FATAL_HTTP.has(status)) throw error;
      options.onAttempt?.(performance.now() - started);
    } catch (error) {
      options.onAttempt?.(performance.now() - started);
      lastError = error;
      if (error instanceof HttpStatusError && FATAL_HTTP.has(error.status)) {
        throw error;
      }
    }
    if (attempt < tries - 1) await sleep(2 ** attempt * 1_000);
  }
  throw lastError instanceof Error
    ? lastError
    : new AppError("fetch_failed", String(lastError));
}
