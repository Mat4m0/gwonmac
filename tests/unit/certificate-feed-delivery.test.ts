// Delivery, which is the half of the feed that touches a network and a disk.
// What a feed *means* is proved next door in certificate-feed-proof.test.ts;
// what is proved here is that a candidate has to earn its way in and a stored
// one has to earn its way back.
//
// Every signature is made by a keypair generated in this process and destroyed
// with it. No private key material exists in this repository, and
// tests/policy/forbidden-artifacts.test.ts is what keeps that true.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  CERTIFICATE_FEED_ASSET,
  CERTIFICATE_FEED_SIGNATURE_ASSET,
  CertificateFeedDelivery,
  STORED_CERTIFICATE_FEED_RECORD,
  type CertificateFeedStatus,
} from "../../src/main/certification/certificate-feed-delivery.ts";
import {
  bundledCertificateFeed,
  serializeCertificateFeed,
} from "../../src/main/certification/certificate-feed.ts";
import { CERTIFICATE_FEED_KEY_SENTINEL } from "../../src/main/certification/certificate-feed-trust.ts";
import { latestReleaseAssetUrl } from "../../src/shared/project-identity.ts";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gw-feed-delivery-"));
  roots.push(root);
  return root;
}

/** One throwaway signer, whose private half exists only for this process. */
function signer(): { pinned: string; privateKey: KeyObject } {
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    pinned: spki.subarray(spki.byteLength - 32).toString("base64"),
    privateKey: pair.privateKey,
  };
}

/** The shipped tables as a feed, restated at `sequence`. */
function feedBytes(sequence: number): Uint8Array {
  return serializeCertificateFeed({ ...bundledCertificateFeed(), sequence });
}

const BUNDLED_SEQUENCE = bundledCertificateFeed().sequence;

/** A `Response` body detached from the view it was copied out of. */
function body(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

interface Served {
  readonly document?: Uint8Array;
  readonly signature?: Uint8Array;
  readonly status?: number;
  readonly throws?: boolean;
}

interface Harness {
  readonly storePath: string;
  readonly pinnedKeyPath: string;
  readonly requests: { url: string; init: RequestInit | undefined }[];
  readonly published: CertificateFeedStatus[];
  delivery(): CertificateFeedDelivery;
}

async function harness(options: {
  pinned: string;
  serve?: Served;
  enabled?: boolean;
  storePath?: string;
}): Promise<Harness> {
  const root = await workspace();
  const pinnedKeyPath = path.join(root, "public-key.txt");
  await writeFile(pinnedKeyPath, `${options.pinned}\n`);
  const storePath = options.storePath ?? path.join(root, "certificate-feed.json");
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const published: CertificateFeedStatus[] = [];
  const served = options.serve;
  return {
    storePath,
    pinnedKeyPath,
    requests,
    published,
    delivery: () =>
      new CertificateFeedDelivery({
        storePath,
        pinnedKeyPath,
        enabled: options.enabled ?? true,
        now: () => 1_700_000_000_000,
        publish: (status) => published.push(status),
        fetch: async (input, init) => {
          const url = String(input);
          requests.push({ url, init });
          if (served?.throws) throw new Error("no route to host");
          const status = served?.status ?? 200;
          const bytes = url.endsWith(CERTIFICATE_FEED_SIGNATURE_ASSET)
            ? served?.signature
            : served?.document;
          return new Response(
            status === 200 && bytes ? body(bytes) : null,
            { status },
          );
        },
      }),
  };
}

function signed(
  privateKey: KeyObject,
  document: Uint8Array,
): { document: Uint8Array; signature: Uint8Array } {
  return {
    document,
    signature: new TextEncoder().encode(
      `${Buffer.from(sign(null, document, privateKey)).toString("base64")}\n`,
    ),
  };
}

describe("a fetched certificate feed has to earn its way in", () => {
  it("adopts and stores a feed the pinned key signed and whose sequence is newer", async () => {
    const { pinned, privateKey } = signer();
    const document = feedBytes(BUNDLED_SEQUENCE + 1);
    const test = await harness({ pinned, serve: signed(privateKey, document) });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();

    assert.deepEqual(delivery.status, {
      source: "stored",
      sequence: BUNDLED_SEQUENCE + 1,
      outcome: "updated",
      lastSuccessAt: 1_700_000_000_000,
    });
    assert.equal(delivery.feed.sequence, BUNDLED_SEQUENCE + 1);
    assert.equal((await stat(test.storePath)).mode & 0o777, 0o600);
    assert.deepEqual(
      JSON.parse(await readFile(test.storePath, "utf8")) as unknown,
      {
        record: STORED_CERTIFICATE_FEED_RECORD,
        document: Buffer.from(document).toString("base64"),
        signature: Buffer.from(
          sign(null, document, privateKey),
        ).toString("base64"),
        fetchedAt: 1_700_000_000_000,
      },
    );
  });

  it("refuses a feed another key signed and stores nothing", async () => {
    const { pinned } = signer();
    const forger = signer();
    const document = feedBytes(BUNDLED_SEQUENCE + 9);
    const test = await harness({
      pinned,
      serve: signed(forger.privateKey, document),
    });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();

    assert.equal(delivery.status.outcome, "untrusted");
    assert.equal(delivery.feed.sequence, BUNDLED_SEQUENCE);
    await assert.rejects(stat(test.storePath));
  });

  it("refuses a correctly signed feed that is not newer, and keeps the one in hand", async () => {
    const { pinned, privateKey } = signer();
    const test = await harness({
      pinned,
      serve: signed(privateKey, feedBytes(BUNDLED_SEQUENCE)),
    });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();

    assert.equal(delivery.status.outcome, "unchanged");
    assert.equal(delivery.status.source, "bundled");
    await assert.rejects(stat(test.storePath));
  });

  it("refuses bytes the key holder signed that are not a feed", async () => {
    const { pinned, privateKey } = signer();
    const test = await harness({
      pinned,
      serve: signed(privateKey, new TextEncoder().encode("{\"nope\":1}")),
    });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();

    assert.equal(delivery.status.outcome, "malformed");
  });

  it("names the transport fault that stopped a check", async () => {
    const cases = [
      [{ throws: true }, "offline"],
      [{ status: 404 }, "absent"],
      [{ status: 503 }, "server"],
    ] as const;
    for (const [serve, outcome] of cases) {
      const { pinned } = signer();
      const test = await harness({ pinned, serve });
      const delivery = test.delivery();
      await delivery.load();
      await delivery.refresh();
      assert.equal(delivery.status.outcome, outcome, JSON.stringify(serve));
    }
  });

  it("does not adopt a feed it could not persist", async () => {
    const { pinned, privateKey } = signer();
    const root = await workspace();
    const test = await harness({
      pinned,
      serve: signed(privateKey, feedBytes(BUNDLED_SEQUENCE + 1)),
      // A directory in the store's place: the atomic write cannot land, and a
      // feed that governs this launch and not the next one is worse than one
      // that arrives a check later.
      storePath: root,
    });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();

    assert.equal(delivery.status.outcome, "unstored");
    assert.equal(delivery.feed.sequence, BUNDLED_SEQUENCE);
  });
});

describe("a stored certificate feed has to earn its way back", () => {
  async function store(
    pinned: string,
    privateKey: KeyObject,
    sequence: number,
  ): Promise<Harness> {
    const document = feedBytes(sequence);
    const test = await harness({ pinned, serve: signed(privateKey, document) });
    const first = test.delivery();
    await first.load();
    await first.refresh();
    assert.equal(first.status.outcome, "updated");
    return test;
  }

  it("governs the next launch, verified by the same path as a fresh fetch", async () => {
    const { pinned, privateKey } = signer();
    const test = await store(pinned, privateKey, BUNDLED_SEQUENCE + 4);

    const next = test.delivery();
    await next.load();

    assert.deepEqual(next.status, {
      source: "stored",
      sequence: BUNDLED_SEQUENCE + 4,
      outcome: "stored",
      lastSuccessAt: 1_700_000_000_000,
    });
    // Loading made no request: a stored feed is believed on its signature, not
    // on having been fetched again.
    assert.deepEqual(test.requests.map(({ url }) => url).slice(2), []);
  });

  it("discards a record whose bytes were edited on this machine", async () => {
    const { pinned, privateKey } = signer();
    const test = await store(pinned, privateKey, BUNDLED_SEQUENCE + 4);
    const record = JSON.parse(
      await readFile(test.storePath, "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      test.storePath,
      JSON.stringify({
        ...record,
        document: Buffer.from(feedBytes(BUNDLED_SEQUENCE + 5)).toString("base64"),
      }),
    );

    const next = test.delivery();
    await next.load();

    assert.equal(next.status.outcome, "discarded");
    assert.equal(next.feed.sequence, BUNDLED_SEQUENCE);
    await assert.rejects(stat(test.storePath), "the refused record was kept");
  });

  it("discards a record it does not fully understand rather than reading part of it", async () => {
    const { pinned, privateKey } = signer();
    const base = await store(pinned, privateKey, BUNDLED_SEQUENCE + 4);
    const good = JSON.parse(
      await readFile(base.storePath, "utf8"),
    ) as Record<string, unknown>;

    const mangled: Record<string, unknown>[] = [
      { ...good, record: STORED_CERTIFICATE_FEED_RECORD + 1 },
      { ...good, sequence: 9 },
      { ...good, fetchedAt: -1 },
      { ...good, fetchedAt: 1.5 },
      { ...good, document: `${String(good["document"])}=` },
      Object.fromEntries(
        Object.entries(good).filter(([key]) => key !== "signature"),
      ),
    ];
    for (const value of mangled) {
      const test = await harness({ pinned });
      await writeFile(test.storePath, JSON.stringify(value));
      const delivery = test.delivery();
      await delivery.load();
      assert.equal(
        delivery.status.outcome,
        "discarded",
        JSON.stringify(value).slice(0, 80),
      );
      assert.equal(delivery.feed.sequence, BUNDLED_SEQUENCE);
    }
  });

  it("is refused wholesale once the pin rotates, and the file is removed", async () => {
    const { pinned, privateKey } = signer();
    const test = await store(pinned, privateKey, BUNDLED_SEQUENCE + 4);
    await writeFile(test.pinnedKeyPath, `${signer().pinned}\n`);

    const next = test.delivery();
    await next.load();

    assert.equal(next.status.outcome, "discarded");
    assert.equal(next.feed.sequence, BUNDLED_SEQUENCE);
    await assert.rejects(stat(test.storePath));
  });
});

describe("the pin decides whether a request happens at all", () => {
  it("makes no request while the committed placeholder is the pin", async () => {
    const test = await harness({ pinned: CERTIFICATE_FEED_KEY_SENTINEL });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();

    assert.deepEqual(test.requests, []);
    assert.deepEqual(delivery.status, {
      source: "bundled",
      sequence: BUNDLED_SEQUENCE,
      outcome: "unpinned",
      lastSuccessAt: null,
    });
  });

  it("deletes a stored feed the placeholder can never believe again", async () => {
    const { pinned, privateKey } = signer();
    const document = feedBytes(BUNDLED_SEQUENCE + 2);
    const test = await harness({ pinned, serve: signed(privateKey, document) });
    const first = test.delivery();
    await first.load();
    await first.refresh();
    await writeFile(test.pinnedKeyPath, `${CERTIFICATE_FEED_KEY_SENTINEL}\n`);

    const next = test.delivery();
    await next.load();

    assert.equal(next.status.outcome, "unpinned");
    await assert.rejects(stat(test.storePath));
  });

  it("reports a mistyped pin as untrusted rather than as the deliberate placeholder", async () => {
    const test = await harness({ pinned: "not-a-key" });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();

    assert.equal(delivery.status.outcome, "untrusted");
    assert.deepEqual(test.requests, []);
  });

  it("makes no request when automatic checks are not this build's to make", async () => {
    const { pinned, privateKey } = signer();
    const test = await harness({
      pinned,
      serve: signed(privateKey, feedBytes(BUNDLED_SEQUENCE + 1)),
      enabled: false,
    });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();

    assert.deepEqual(test.requests, []);
    assert.equal(delivery.feed.sequence, BUNDLED_SEQUENCE);
  });
});

describe("what a check publishes", () => {
  it("publishes one status per resolution, and the sequence only moves forward", async () => {
    const { pinned, privateKey } = signer();
    const document = feedBytes(BUNDLED_SEQUENCE + 3);
    const test = await harness({ pinned, serve: signed(privateKey, document) });
    const delivery = test.delivery();

    await delivery.load();
    await delivery.refresh();
    await delivery.refresh();

    assert.deepEqual(
      test.published.map(({ outcome, sequence }) => [outcome, sequence]),
      [
        ["bundled", BUNDLED_SEQUENCE],
        ["updated", BUNDLED_SEQUENCE + 3],
        ["unchanged", BUNDLED_SEQUENCE + 3],
      ],
    );
  });

  it("coalesces concurrent checks into one pair of requests", async () => {
    const { pinned, privateKey } = signer();
    const test = await harness({
      pinned,
      serve: signed(privateKey, feedBytes(BUNDLED_SEQUENCE + 1)),
    });
    const delivery = test.delivery();
    await delivery.load();

    await Promise.all([delivery.refresh(), delivery.refresh()]);

    assert.deepEqual(test.requests.map(({ url }) => url), [
      latestReleaseAssetUrl(CERTIFICATE_FEED_ASSET),
      latestReleaseAssetUrl(CERTIFICATE_FEED_SIGNATURE_ASSET),
    ]);
  });
});
