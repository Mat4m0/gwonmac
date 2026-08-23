/**
 * The one owner of signed project news. Network bytes stop here: only verified,
 * closed content crosses IPC, and failures can never affect game startup.
 */
import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  CONTENT_ENVELOPE_MAX_BYTES,
  CONTENT_PAYLOAD_MAX_BYTES,
  currentContentNotices,
  parseContentPayload,
  parseSignedContentEnvelope,
  type ContentFeedState,
  type ContentPayloadV1,
  type ContentReadMarker,
  type SignedContentEnvelopeV1,
} from "../shared/content-feed.js";
import { writeAtomicJson } from "./core/atomic-file.js";
import { readBoundedResponse } from "./core/patch-transport.js";

const REFRESH_INTERVAL_MS = 30 * 60 * 1_000;
const CURRENT_FOR_MS = 6 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_READ_MARKERS = 256;

export type ContentFeedFailure =
  | "network"
  | "timeout"
  | "oversized"
  | "invalid-signature"
  | "invalid-schema"
  | "rollback"
  | "server";

interface StoredContentStateV1 {
  readonly formatVersion: 1;
  readonly highestSequence: number;
  readonly fetchedAt: string;
  readonly etag?: string;
  readonly envelope: SignedContentEnvelopeV1;
  readonly read: readonly ContentReadMarker[];
}

interface AcceptedContent {
  readonly envelope: SignedContentEnvelopeV1;
  readonly payload: ContentPayloadV1;
  readonly payloadBytes: Uint8Array;
}

export interface ContentFeedControllerOptions {
  readonly statePath: string;
  readonly endpoint: string;
  readonly publicKeys: Readonly<Record<string, string>>;
  readonly enabled: boolean;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly publish?: (state: ContentFeedState) => void;
  readonly recordFailure?: (reason: ContentFeedFailure) => void;
}

function decodeBase64Url(value: string): Uint8Array {
  return Buffer.from(value, "base64url");
}

function acceptedEnvelope(
  raw: unknown,
  publicKeys: Readonly<Record<string, string>>,
): AcceptedContent {
  const envelope = parseSignedContentEnvelope(raw);
  const encodedKey = publicKeys[envelope.keyId];
  if (!encodedKey) throw new ContentFeedError("invalid-signature");
  const payloadBytes = decodeBase64Url(envelope.payload);
  if (payloadBytes.byteLength > CONTENT_PAYLOAD_MAX_BYTES) {
    throw new ContentFeedError("oversized");
  }
  const publicKey = createPublicKey({
    key: Buffer.from(encodedKey, "base64"),
    format: "der",
    type: "spki",
  });
  if (!verify(null, payloadBytes, publicKey, decodeBase64Url(envelope.signature))) {
    throw new ContentFeedError("invalid-signature");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    throw new ContentFeedError("invalid-schema");
  }
  try {
    return { envelope, payload: parseContentPayload(value), payloadBytes };
  } catch {
    throw new ContentFeedError("invalid-schema");
  }
}

class ContentFeedError extends Error {
  readonly reason: ContentFeedFailure;

  constructor(reason: ContentFeedFailure) {
    super(reason);
    this.reason = reason;
  }
}

function parseStoredState(
  value: unknown,
  publicKeys: Readonly<Record<string, string>>,
): { readonly stored: StoredContentStateV1; readonly accepted: AcceptedContent } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("content state must be an object");
  }
  const src = value as Record<string, unknown>;
  const allowed = new Set(["formatVersion", "highestSequence", "fetchedAt", "etag", "envelope", "read"]);
  if (Object.keys(src).some((key) => !allowed.has(key)) || src.formatVersion !== 1) {
    throw new TypeError("content state has an unknown format");
  }
  if (!Number.isSafeInteger(src.highestSequence) || (src.highestSequence as number) <= 0) {
    throw new TypeError("content state sequence is invalid");
  }
  if (typeof src.fetchedAt !== "string" || !Number.isFinite(Date.parse(src.fetchedAt))) {
    throw new TypeError("content state time is invalid");
  }
  if (src.etag !== undefined && (typeof src.etag !== "string" || src.etag.length > 256)) {
    throw new TypeError("content state etag is invalid");
  }
  if (!Array.isArray(src.read) || src.read.length > MAX_READ_MARKERS) {
    throw new TypeError("content read markers are invalid");
  }
  const read = src.read.map((entry): ContentReadMarker => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("content read marker is invalid");
    }
    const marker = entry as Record<string, unknown>;
    if (
      Object.keys(marker).some((key) => key !== "id" && key !== "revision")
      || typeof marker.id !== "string"
      || marker.id.length === 0
      || marker.id.length > 96
      || !Number.isSafeInteger(marker.revision)
      || (marker.revision as number) <= 0
    ) throw new TypeError("content read marker is invalid");
    return { id: marker.id, revision: marker.revision as number };
  });
  const accepted = acceptedEnvelope(src.envelope, publicKeys);
  if (accepted.payload.sequence > (src.highestSequence as number)) {
    throw new TypeError("content state sequence is inconsistent");
  }
  return {
    stored: {
      formatVersion: 1,
      highestSequence: src.highestSequence as number,
      fetchedAt: src.fetchedAt,
      ...(src.etag === undefined ? {} : { etag: src.etag }),
      envelope: accepted.envelope,
      read,
    },
    accepted,
  };
}

export class ContentFeedController {
  readonly #options: ContentFeedControllerOptions;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  #enabled: boolean;
  #stored: StoredContentStateV1 | null = null;
  #payload: ContentPayloadV1 | null = null;
  #refreshing: Promise<ContentFeedState> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastFailure = false;

  constructor(options: ContentFeedControllerOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#enabled = options.enabled;
  }

  async start(): Promise<void> {
    await this.#load();
    this.#publish();
    this.#timer = setInterval(() => {
      if (this.#enabled) void this.refresh();
    }, REFRESH_INTERVAL_MS);
    if (this.#enabled) void this.refresh();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.#publish();
    if (enabled) void this.refresh();
  }

  getState(): ContentFeedState {
    if (!this.#enabled) return this.#state("disabled");
    if (this.#refreshing) return this.#state("refreshing");
    if (!this.#stored || !this.#payload) {
      return this.#state(this.#lastFailure ? "unavailable" : "refreshing");
    }
    const age = this.#now() - Date.parse(this.#stored.fetchedAt);
    return this.#state(this.#lastFailure || age > CURRENT_FOR_MS ? "stale" : "current");
  }

  refresh(): Promise<ContentFeedState> {
    if (!this.#enabled) return Promise.resolve(this.getState());
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#performRefresh().then(() => {
      this.#refreshing = null;
      this.#publish();
      return this.getState();
    });
    this.#publish();
    return this.#refreshing;
  }

  async markRead(value: ContentReadMarker): Promise<void> {
    if (!this.#stored || !this.#payload) return;
    const exists = this.#payload.notices.some((notice) =>
      notice.id === value.id && notice.revision === value.revision
    ) || this.#payload.releases.some((release) =>
      `release-${release.version}` === value.id && value.revision === 1
    );
    if (!exists) return;
    const read = [
      ...this.#stored.read.filter((entry) => entry.id !== value.id),
      value,
    ].slice(-MAX_READ_MARKERS);
    this.#stored = { ...this.#stored, read };
    await writeAtomicJson(this.#options.statePath, this.#stored);
    this.#publish();
  }

  async #load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.#options.statePath, "utf8")) as unknown;
      const { stored, accepted } = parseStoredState(raw, this.#options.publicKeys);
      this.#stored = stored;
      this.#payload = accepted.payload;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.#options.recordFailure?.("invalid-schema");
      }
    }
  }

  async #performRefresh(): Promise<void> {
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.#stored?.etag) headers["If-None-Match"] = this.#stored.etag;
      const response = await this.#fetch(this.#options.endpoint, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 304 && this.#stored) {
        this.#stored = { ...this.#stored, fetchedAt: new Date(this.#now()).toISOString() };
        await writeAtomicJson(this.#options.statePath, this.#stored);
        this.#lastFailure = false;
        return;
      }
      if (response.status !== 200) throw new ContentFeedError("server");
      const bytes = await readBoundedResponse(response, CONTENT_ENVELOPE_MAX_BYTES);
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new ContentFeedError("invalid-schema");
      }
      const accepted = acceptedEnvelope(raw, this.#options.publicKeys);
      const highest = this.#stored?.highestSequence ?? 0;
      if (accepted.payload.sequence < highest) throw new ContentFeedError("rollback");
      if (
        accepted.payload.sequence === highest
        && this.#stored
        && accepted.envelope.payload !== this.#stored.envelope.payload
      ) throw new ContentFeedError("rollback");
      const etag = response.headers.get("etag") ?? undefined;
      this.#stored = {
        formatVersion: 1,
        highestSequence: Math.max(highest, accepted.payload.sequence),
        fetchedAt: new Date(this.#now()).toISOString(),
        ...(etag ? { etag } : {}),
        envelope: accepted.envelope,
        read: this.#stored?.read ?? [],
      };
      this.#payload = accepted.payload;
      await writeAtomicJson(this.#options.statePath, this.#stored);
      this.#lastFailure = false;
    } catch (error) {
      let reason: ContentFeedFailure = "network";
      if (error instanceof ContentFeedError) reason = error.reason;
      else if (error instanceof DOMException && error.name === "TimeoutError") reason = "timeout";
      else if ((error as { code?: unknown }).code === "response_too_large") reason = "oversized";
      this.#lastFailure = true;
      this.#options.recordFailure?.(reason);
    }
  }

  #state(phase: ContentFeedState["phase"]): ContentFeedState {
    const now = this.#now();
    const notices = this.#enabled && this.#payload
      ? currentContentNotices(this.#payload, now)
      : [];
    const releases = this.#payload?.releases ?? [];
    const read = new Set(this.#stored?.read.map((entry) => `${entry.id}:${entry.revision}`));
    const unreadCount = [
      ...notices.map((notice) => `${notice.id}:${notice.revision}`),
      ...releases.map((release) => `release-${release.version}:1`),
    ].filter((key) => !read.has(key)).length;
    return {
      phase,
      ...(this.#stored ? { lastSuccessfulAt: this.#stored.fetchedAt } : {}),
      notices,
      releases,
      unreadCount,
    };
  }

  #publish(): void {
    this.#options.publish?.(this.getState());
  }
}

export const PRODUCTION_CONTENT_PUBLIC_KEYS = {
  "content-2026-01": "MCowBQYDK2VwAyEAj0KdcosR6qYd4AxBBOQRCny6yVDrr3TyU6d/sIoGx0U=",
} as const;
