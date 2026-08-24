/**
 * The bounded HTTP transport every patch-service request goes through: one
 * timeout, one abort composition, one redirect policy, one response ceiling and
 * one backoff schedule, so manifest and chunk downloads cannot drift apart.
 *
 * Bytes are counted as they stream and a declared length over the ceiling is
 * refused before the body is read, so an unbounded or lying response is never
 * buffered first and judged second. Redirects are `manual` and a 3xx is fatal:
 * the patch service is addressed by a fixed root, and a redirect out of it is
 * not a route to follow. Retries are exponential and exist for transport
 * faults; the statuses that no retry can fix throw on the first answer.
 */
import { AppError, HttpStatusError } from "../../shared/errors.js";
import { FATAL_HTTP } from "./access-key.js";
import { readBoundedResponse } from "./bounded-response.js";

export type PatchFetch = (
  url: string,
  init: {
    headers: Readonly<Record<string, string>>;
    method?: string;
    maxBytes: number;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; body: Uint8Array }>;

export type ResponseFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/**
 * Adapt one native HTTP implementation to the bounded patch transport.
 *
 * Production supplies Electron's `net.fetch`; tests may supply global fetch.
 * Timeout, abort composition, redirect policy, and response limits therefore
 * have one owner instead of diverging between manifest and chunk downloads.
 */
export function createBoundedPatchFetch(
  fetchResponse: ResponseFetch,
  requestTimeoutMs: number,
): PatchFetch {
  return async (url, init) => {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const request: RequestInit = {
      method: init.method ?? "GET",
      redirect: "manual",
      signal: init.signal
        ? AbortSignal.any([init.signal, timeout])
        : timeout,
    };
    request.headers = init.headers;
    const response = await fetchResponse(url, request);
    return {
      status: response.status,
      body: await readBoundedResponse(response, init.maxBytes),
    };
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function sleep(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchPatchBytes(options: {
  fetch: PatchFetch;
  url: string;
  headers: Readonly<Record<string, string>>;
  tries?: number;
  maxBytes: number;
  onAttempt?: (durationMs: number) => void;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new AppError("response_limit", "response limit must be positive");
  }
  const tries = options.tries ?? 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    throwIfAborted(options.signal);
    const started = performance.now();
    try {
      const init = {
        headers: options.headers,
        maxBytes: options.maxBytes,
        ...(options.signal ? { signal: options.signal } : {}),
      };
      const { status, body } = await options.fetch(options.url, init);
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
      throwIfAborted(options.signal);
      lastError = error;
      if (
        error instanceof HttpStatusError &&
        (FATAL_HTTP.has(error.status) || (error.status >= 300 && error.status < 400))
      ) {
        throw error;
      }
      if (error instanceof AppError && error.code === "response_too_large") throw error;
    }
    if (attempt < tries - 1) {
      await sleep(2 ** attempt * 1_000, options.signal);
    }
  }
  // Classification happens here because only the transport knows a throw was
  // a fetch: an `AppError` (HTTP status, response limit) keeps its code, and
  // anything else is a request that never got an HTTP answer — offline, no
  // DNS, or a timeout — which `errorCode()` would otherwise collapse to
  // `unknown` and the renderer could not tell apart from an app fault.
  if (lastError instanceof AppError) throw lastError;
  if (lastError instanceof Error) {
    throw new AppError("net_offline", `${options.url}: ${lastError.message}`, {
      cause: lastError,
    });
  }
  throw new AppError("fetch_failed", String(lastError));
}
