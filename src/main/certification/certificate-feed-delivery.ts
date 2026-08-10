/**
 * How a certificate feed reaches this installation and survives a restart:
 * where it is fetched from, how a verified one is stored, and which of the
 * feeds in hand governs this session.
 *
 * A check is two GETs at the release-asset address this project already
 * downloads from — the document and its detached signature — and the
 * application adds nothing to either request. No body, no header, no query, no
 * credential, no identifier, no game-derived value. There is nothing in the ask
 * for an installation to be recognised by, which is what keeps the feed inside
 * the promise that no game traffic is uploaded rather than beside it.
 *
 * Nothing is believed on arrival. A candidate is verified under the pinned key
 * before it is parsed, parsed before it is compared, and replaces the feed in
 * hand only when its `sequence` is strictly greater. The stored record keeps
 * the exact bytes and the exact signature, so a stored feed is verified by the
 * same code path as a fresh one at every launch: a file edited on this machine
 * is refused, and rotating the pin retroactively refuses everything the old key
 * signed. There is deliberately no second, weaker rule for a feed that is
 * already ours.
 *
 * The record states its own version and is read whole or not at all. One this
 * application does not fully understand — a version it does not know, a field
 * it cannot decode, a signature that no longer verifies — is deleted rather
 * than partially read, and the snapshot compiled into the application governs.
 * Falling back is always available because that snapshot needs nothing from
 * disk.
 *
 * With no pinned key this module makes no request at all. A refused response
 * and an ask never sent are the same trust decision, and only one of them
 * costs the player a connection.
 *
 * It refuses to own what a feed *means*: it never decides that a certificate
 * holds — `certificate-feed-proof.ts` does, against the client bytes — and it
 * never decides when to run. The caller owns the schedule.
 */
import { readFile, rm } from "node:fs/promises";
import { latestReleaseAssetUrl } from "../../shared/project-identity.js";
import { AppError } from "../../shared/errors.js";
import { writeAtomicJson } from "../core/atomic-file.js";
import { readBoundedResponse } from "../core/patch-transport.js";
import {
  bundledCertificateFeed,
  governingCertificateFeed,
  MAX_CERTIFICATE_FEED_BYTES,
  type CertificateFeed,
} from "./certificate-feed.js";
import {
  certificateFeedTrust,
  verifyFetchedCertificateFeed,
  type CertificateFeedTrust,
} from "./certificate-feed-trust.js";

/** The two release assets a feed is published as. */
export const CERTIFICATE_FEED_ASSET = "certificate-feed.json";
export const CERTIFICATE_FEED_SIGNATURE_ASSET = "certificate-feed.json.sig";

/**
 * The stored record's own version, which is not the feed's. It changes when
 * the *envelope* changes; a reader that does not know a version deletes the
 * record rather than guessing which fields still mean what they used to.
 */
export const STORED_CERTIFICATE_FEED_RECORD = 1;

const FETCH_TIMEOUT_MS = 5_000;
// A detached Ed25519 signature is 64 bytes: 88 base64 characters and a newline.
// The ceiling is generous enough for stray whitespace and nothing else.
const MAX_SIGNATURE_BYTES = 128;

/**
 * Everything that can come of a check, as one closed vocabulary. It is the
 * gauge a maintainer reads and the field the diagnostics schema declares, so a
 * stuck feed names its own reason instead of being inferred from a silence.
 */
export const CERTIFICATE_FEED_OUTCOMES = [
  /** Nothing stored and nothing fetched: the compiled-in snapshot governs. */
  "bundled",
  /** A stored feed verified and governs. */
  "stored",
  /** A stored record did not survive verification and was deleted. */
  "discarded",
  /** A fetched feed verified, was strictly newer, and was stored. */
  "updated",
  /** A fetched feed verified and was not newer than the feed in hand. */
  "unchanged",
  /** A fetched feed verified but could not be persisted, so it was not adopted. */
  "unstored",
  /** No key is pinned, so no request was made. The normal state of a clone. */
  "unpinned",
  /** A key is pinned and these bytes were not signed by it. */
  "untrusted",
  /** Signed by the pinned key and still not a feed this schema accepts. */
  "malformed",
  /** The current release publishes no feed. */
  "absent",
  "offline",
  "timeout",
  "server",
] as const;

export type CertificateFeedOutcome = (typeof CERTIFICATE_FEED_OUTCOMES)[number];

/**
 * Outcomes that mean a check produced no feed *and* something is wrong — as
 * opposed to the ones that are a configured or ordinary state. Only these are
 * worth a warning; a clone with no pinned key must not log one every launch.
 */
export const CERTIFICATE_FEED_REFUSALS: ReadonlySet<CertificateFeedOutcome> =
  new Set<CertificateFeedOutcome>([
    "discarded",
    "unstored",
    "untrusted",
    "malformed",
    "offline",
    "timeout",
    "server",
  ]);

export const CERTIFICATE_FEED_SOURCES = ["bundled", "stored"] as const;
export type CertificateFeedSource = (typeof CERTIFICATE_FEED_SOURCES)[number];

export interface CertificateFeedStatus {
  readonly source: CertificateFeedSource;
  /** The governing feed's sequence. It only ever increases. */
  readonly sequence: number;
  readonly outcome: CertificateFeedOutcome;
  /** When the stored feed was fetched, or `null` if none was. */
  readonly lastSuccessAt: number | null;
}

export interface CertificateFeedDeliveryOptions {
  readonly storePath: string;
  readonly pinnedKeyPath: string;
  /**
   * False makes `refresh` a no-op that reaches the network zero times. It
   * carries the same answer as the automatic update check, so the consent
   * promise stays one predicate rather than two that have to agree.
   */
  readonly enabled: boolean;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly publish: (status: CertificateFeedStatus) => void;
}

interface StoredCertificateFeed {
  readonly record: typeof STORED_CERTIFICATE_FEED_RECORD;
  /** Base64 of the exact feed bytes. A signature is over bytes, not over text. */
  readonly document: string;
  readonly signature: string;
  readonly fetchedAt: number;
}

type StoredRead =
  | { readonly kind: "absent" }
  | { readonly kind: "corrupt" }
  | { readonly kind: "loaded"; readonly feed: CertificateFeed; readonly fetchedAt: number };

type FetchedCandidate =
  | {
      readonly ok: true;
      readonly document: Uint8Array;
      readonly signature: Uint8Array;
      readonly feed: CertificateFeed;
    }
  | { readonly ok: false; readonly outcome: CertificateFeedOutcome };

/** The exact base64 of `value`, or `null` if it is spelled any other way. */
function canonicalBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

function storedRecord(value: unknown): {
  document: Uint8Array;
  signature: Uint8Array;
  fetchedAt: number;
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  // Field-for-field, in both directions: an unknown field means the writer knew
  // something this reader does not, which is exactly when guessing is wrong.
  if (
    Object.keys(record).sort().join(",")
    !== "document,fetchedAt,record,signature"
  ) return null;
  if (record["record"] !== STORED_CERTIFICATE_FEED_RECORD) return null;
  const fetchedAt = record["fetchedAt"];
  if (
    typeof fetchedAt !== "number"
    || !Number.isSafeInteger(fetchedAt)
    || fetchedAt < 0
  ) return null;
  const document = canonicalBase64(record["document"]);
  const signature = canonicalBase64(record["signature"]);
  if (document === null || signature === null) return null;
  return { document, signature, fetchedAt };
}

/**
 * A refusal the feed's own modules raised, in this module's vocabulary. The
 * two codes are the whole distinction that matters: whether the bytes came
 * from the key holder, or whether the key holder sent something unreadable.
 */
function refusalOutcome(error: unknown): CertificateFeedOutcome {
  if (error instanceof AppError && error.code === "certificate_feed_format") {
    return "malformed";
  }
  return "untrusted";
}

export class CertificateFeedDelivery {
  private readonly options: CertificateFeedDeliveryOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private governing: CertificateFeed = bundledCertificateFeed();
  private sourceValue: CertificateFeedSource = "bundled";
  private outcomeValue: CertificateFeedOutcome = "bundled";
  private lastSuccessAt: number | null = null;
  private trustValue: CertificateFeedTrust | "unreadable" | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: CertificateFeedDeliveryOptions) {
    this.options = options;
    // Resolved at request time, exactly as the updater resolves it, so a test
    // can prove the real main-process network boundary without a second
    // transport existing in production.
    this.fetchImpl = options.fetch
      ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  }

  /** The feed every certification decision in this session is made against. */
  get feed(): CertificateFeed {
    return this.governing;
  }

  get status(): CertificateFeedStatus {
    return {
      source: this.sourceValue,
      sequence: this.governing.sequence,
      outcome: this.outcomeValue,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  /**
   * Reads whatever a previous session stored. Runs before the first
   * certification pass, because a feed that governs only after the launch it
   * arrived on is a fact with two answers in one session.
   */
  async load(): Promise<void> {
    const trust = await this.trust();
    if (trust === "unreadable" || !trust.remote) {
      // Nothing signed may be believed, so nothing stored may be. The record
      // is deleted rather than carried as a file no code path can ever read.
      await this.discardStore();
      this.settle(trust === "unreadable" ? "untrusted" : "unpinned");
      return;
    }
    const stored = await this.readStored(trust);
    if (stored.kind === "absent") {
      this.settle("bundled");
      return;
    }
    if (stored.kind === "corrupt") {
      await this.discardStore();
      this.settle("discarded");
      return;
    }
    this.lastSuccessAt = stored.fetchedAt;
    // A stored feed an application release has since overtaken loses: the
    // tables compiled into a signed application are the stronger claim.
    const { feed, accepted } = governingCertificateFeed(
      this.governing,
      stored.feed,
    );
    this.governing = feed;
    this.sourceValue = accepted ? "stored" : "bundled";
    this.settle(accepted ? "stored" : "bundled");
  }

  /** Coalesced: a second caller joins the check already in flight. */
  refresh(): Promise<void> {
    if (!this.options.enabled) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const operation = this.runRefresh().finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    this.inFlight = operation;
    return operation;
  }

  private async runRefresh(): Promise<void> {
    const candidate = await this.fetchCandidate();
    if (!candidate.ok) {
      this.settle(candidate.outcome);
      return;
    }
    const { feed, accepted } = governingCertificateFeed(
      this.governing,
      candidate.feed,
    );
    if (!accepted) {
      this.settle("unchanged");
      return;
    }
    const fetchedAt = this.now();
    try {
      await writeAtomicJson(
        this.options.storePath,
        {
          record: STORED_CERTIFICATE_FEED_RECORD,
          document: Buffer.from(candidate.document).toString("base64"),
          signature: Buffer.from(candidate.signature).toString("base64"),
          fetchedAt,
        } satisfies StoredCertificateFeed,
        0o600,
      );
    } catch {
      // Adopting a feed this session could not keep would make the certified
      // set flicker between launches. The next check retries; nothing is lost
      // but time, and a stuck `unstored` says which disk to look at.
      this.settle("unstored");
      return;
    }
    this.governing = feed;
    this.sourceValue = "stored";
    this.lastSuccessAt = fetchedAt;
    this.settle("updated");
  }

  private settle(outcome: CertificateFeedOutcome): void {
    this.outcomeValue = outcome;
    this.options.publish(this.status);
  }

  private discardStore(): Promise<void> {
    return rm(this.options.storePath, { force: true }).catch(() => undefined);
  }

  private async readStored(trust: CertificateFeedTrust): Promise<StoredRead> {
    let text: string;
    try {
      text = await readFile(this.options.storePath, "utf8");
    } catch {
      return { kind: "absent" };
    }
    let document: unknown;
    try {
      document = JSON.parse(text) as unknown;
    } catch {
      return { kind: "corrupt" };
    }
    const record = storedRecord(document);
    if (record === null) return { kind: "corrupt" };
    try {
      return {
        kind: "loaded",
        feed: verifyFetchedCertificateFeed(
          trust,
          record.document,
          record.signature,
        ),
        fetchedAt: record.fetchedAt,
      };
    } catch {
      return { kind: "corrupt" };
    }
  }

  private async fetchCandidate(): Promise<FetchedCandidate> {
    const trust = await this.trust();
    if (trust === "unreadable") return { ok: false, outcome: "untrusted" };
    // No pinned key, no request. Asking and then refusing the answer would
    // spend a connection to reach a decision already made.
    if (!trust.remote) return { ok: false, outcome: "unpinned" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const document = await this.get(
        CERTIFICATE_FEED_ASSET,
        MAX_CERTIFICATE_FEED_BYTES,
        controller.signal,
      );
      if (!document.ok) return document;
      const signature = await this.get(
        CERTIFICATE_FEED_SIGNATURE_ASSET,
        MAX_SIGNATURE_BYTES,
        controller.signal,
      );
      if (!signature.ok) return signature;
      const detached = canonicalBase64(
        new TextDecoder().decode(signature.body).trim(),
      );
      if (detached === null) return { ok: false, outcome: "untrusted" };
      try {
        return {
          ok: true,
          document: document.body,
          signature: detached,
          feed: verifyFetchedCertificateFeed(trust, document.body, detached),
        };
      } catch (error) {
        return { ok: false, outcome: refusalOutcome(error) };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async get(
    asset: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<
    { ok: true; body: Uint8Array } | { ok: false; outcome: CertificateFeedOutcome }
  > {
    let response: Response;
    try {
      response = await this.fetchImpl(latestReleaseAssetUrl(asset), {
        method: "GET",
        // Everything an installation could be recognised by is off. The ask
        // carries the address and nothing this application added to it.
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        // The published address is a redirect into GitHub's release storage,
        // the same chain the updater's own asset requests already follow.
        redirect: "follow",
        signal,
      });
    } catch {
      return {
        ok: false,
        outcome: signal.aborted ? "timeout" : "offline",
      };
    }
    if (response.status === 404) return { ok: false, outcome: "absent" };
    if (!response.ok) return { ok: false, outcome: "server" };
    try {
      return { ok: true, body: await readBoundedResponse(response, maxBytes) };
    } catch {
      // Over the ceiling, or a body that stopped arriving. Neither is a feed.
      return { ok: false, outcome: signal.aborted ? "timeout" : "offline" };
    }
  }

  /**
   * The pinned key, read once. A file that is neither the placeholder nor a
   * canonical key line stays distinguishable from the deliberate placeholder:
   * a mistyped pin reports `untrusted`, not the silent `unpinned` that a clone
   * is supposed to be in.
   */
  private async trust(): Promise<CertificateFeedTrust | "unreadable"> {
    if (this.trustValue !== null) return this.trustValue;
    let pinned: string;
    try {
      pinned = await readFile(this.options.pinnedKeyPath, "utf8");
    } catch {
      // No key file at all is no pinned key, which is the placeholder's answer.
      this.trustValue = { remote: false };
      return this.trustValue;
    }
    try {
      this.trustValue = certificateFeedTrust(pinned);
    } catch {
      this.trustValue = "unreadable";
    }
    return this.trustValue;
  }
}
