// The certificate feed's delivery path, run inside the real application: the
// pinned key it actually reads, the scheduler it actually shares, the profile
// it actually writes, and the launch that actually reads it back.
//
// The key is generated per run and its private half never leaves this process.
// The committed pin is real production authority; this spec instead points the
// unpackaged app at a per-run key so the transport test stays isolated.
//
// The feed served here is the application's own bundled snapshot restated at a
// higher `sequence`. That is deliberate: a fixture written to agree would prove
// that the fixture agrees. Restating the shipped tables proves the document the
// build actually produces survives signing, transport, storage and a restart.
//
// What this spec does not do is certify a client. The offline fixture has no
// ArenaNet build to certify, so `certificate-feed-proof.test.ts` owns whether a
// proposal survives the transforms and this owns whether a proposal ever
// reaches them.
import { expect, test } from "@playwright/test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeOffline,
  launchOfflineAt,
  root,
  type OfflineFixture,
} from "./fixtures.mjs";

const FEED_URL =
  "https://github.com/Mat4m0/gwonmac/releases/latest/download/certificate-feed.json";
const SIGNATURE_URL = `${FEED_URL}.sig`;

interface ServedFeed {
  readonly document: string;
  readonly signature: string;
}

/**
 * The bundled snapshot restated at `sequence`, signed by `privateKey`. The
 * canonical document is `JSON.stringify(…, null, 2)` plus a newline, and a JSON
 * round trip preserves the key order the serialiser wrote — which is what a
 * signature covers.
 */
async function serve(
  sequence: number,
  privateKey: KeyObject,
): Promise<ServedFeed> {
  const bundled = JSON.parse(
    await readFile(path.join(root, "build/certificates/feed.json"), "utf8"),
  ) as Record<string, unknown>;
  const document = `${JSON.stringify({ ...bundled, sequence }, null, 2)}\n`;
  return {
    document,
    signature: Buffer.from(
      sign(null, Buffer.from(document, "utf8"), privateKey),
    ).toString("base64"),
  };
}

function keypair(): { pinned: string; privateKey: KeyObject } {
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    pinned: spki.subarray(spki.byteLength - 32).toString("base64"),
    privateKey: pair.privateKey,
  };
}

/**
 * Answers the two feed addresses and GitHub's releases list; nothing else.
 * Runs in the main process, wrapping the real `fetch` the delivery resolves at
 * request time, so what is exercised is the production network boundary.
 */
function serveFeed(
  _electron: unknown,
  served: ServedFeed & { feedUrl: string; signatureUrl: string },
): void {
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (url === served.feedUrl) {
      return Promise.resolve(
        new globalThis.Response(served.document, { status: 200 }),
      );
    }
    if (url === served.signatureUrl) {
      return Promise.resolve(
        new globalThis.Response(served.signature, { status: 200 }),
      );
    }
    if (url.startsWith("https://api.github.com/")) {
      // A real-shaped answer so the release check finishes on its own path.
      // No packet leaves this machine either way.
      return Promise.resolve(
        new globalThis.Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return real(input, init);
  };
}

interface FeedGauges {
  source?: unknown;
  sequence?: unknown;
  outcome?: unknown;
  lastSuccessAt?: unknown;
}

function gauges(fixture: OfflineFixture): Promise<FeedGauges> {
  return fixture.page.evaluate(async () => {
    const latest = (await window.gwNative.diagnostics.current()).latest;
    return {
      source: latest["certificateFeed.source"],
      sequence: latest["certificateFeed.sequence"],
      outcome: latest["certificateFeed.outcome"],
      lastSuccessAt: latest["certificateFeed.lastSuccessAt"],
    };
  });
}

/**
 * A profile with automatic checks off, so a launch reaches the network zero
 * times and every request this spec counts is one it asked for.
 */
async function profile(pinned: string): Promise<{
  userData: string;
  keyFile: string;
  environment: Record<string, string>;
}> {
  const userData = await mkdtemp(path.join(tmpdir(), "gw-certificate-feed-e2e-"));
  const keyFile = path.join(userData, "pinned-key.txt");
  await writeFile(keyFile, `${pinned}\n`, { mode: 0o600 });
  await writeFile(
    path.join(userData, "settings.json"),
    JSON.stringify({ autoCheckUpdates: false }),
    { mode: 0o600 },
  );
  return {
    userData,
    keyFile,
    environment: {
      // Update-capable, which is the one predicate that lets either request
      // happen at all.
      GW_TEST_DISTRIBUTION_CHANNEL: "release",
      GW_TEST_CERTIFICATE_FEED_KEY: keyFile,
    },
  };
}

test.describe("certificate feed delivery", () => {
  test("a feed the pinned key signed governs the next launch", async () => {
    const { pinned, privateKey } = keypair();
    const { userData, environment } = await profile(pinned);
    const served = await serve(2, privateKey);
    const storePath = path.join(userData, "game", "certificate-feed.json");
    let fixture = await launchOfflineAt(userData, environment);
    try {
      // Nothing stored yet, so the snapshot compiled into the app governs and
      // the unrecognised-build behaviour is exactly today's.
      await expect.poll(() => gauges(fixture)).toMatchObject({
        source: "bundled",
        sequence: 1,
        outcome: "bundled",
        lastSuccessAt: null,
      });

      await fixture.app.evaluate(serveFeed, {
        ...served,
        feedUrl: FEED_URL,
        signatureUrl: SIGNATURE_URL,
      });
      // One press of the app's one "what is new?" control. The feed shares that
      // trigger with the release check rather than owning a schedule.
      await fixture.page.locator("#loading-update-check").click();

      await expect.poll(() => gauges(fixture)).toMatchObject({
        source: "stored",
        sequence: 2,
        outcome: "updated",
      });
      expect((await gauges(fixture)).lastSuccessAt).toEqual(expect.any(Number));
      expect((await stat(storePath)).mode & 0o777).toBe(0o600);
      expect(
        (JSON.parse(await readFile(storePath, "utf8")) as { record: unknown }).record,
      ).toBe(1);

      await fixture.app.close();
      fixture = await launchOfflineAt(userData, environment);

      // The launch that matters: no request was made, and the feed the app
      // certifies against is the fetched one.
      await expect.poll(() => gauges(fixture)).toMatchObject({
        source: "stored",
        sequence: 2,
        outcome: "stored",
      });
      expect((await stat(storePath)).mode & 0o777).toBe(0o600);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("a forged feed changes nothing and is never stored", async () => {
    const { pinned } = keypair();
    const { userData, environment } = await profile(pinned);
    // Signed correctly, by somebody who is not the key holder.
    const served = await serve(9, keypair().privateKey);
    const storePath = path.join(userData, "game", "certificate-feed.json");
    const fixture = await launchOfflineAt(userData, environment);
    try {
      await fixture.app.evaluate(serveFeed, {
        ...served,
        feedUrl: FEED_URL,
        signatureUrl: SIGNATURE_URL,
      });
      await fixture.page.locator("#loading-update-check").click();

      await expect.poll(() => gauges(fixture)).toMatchObject({
        source: "bundled",
        sequence: 1,
        outcome: "untrusted",
        lastSuccessAt: null,
      });
      await expect(stat(storePath)).rejects.toThrow();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("a stored feed the pin no longer covers is discarded, not partially read", async () => {
    const { pinned, privateKey } = keypair();
    const { userData, keyFile, environment } = await profile(pinned);
    const served = await serve(7, privateKey);
    const storePath = path.join(userData, "game", "certificate-feed.json");

    let fixture = await launchOfflineAt(userData, environment);
    try {
      await fixture.app.evaluate(serveFeed, {
        ...served,
        feedUrl: FEED_URL,
        signatureUrl: SIGNATURE_URL,
      });
      await fixture.page.locator("#loading-update-check").click();
      await expect.poll(() => gauges(fixture)).toMatchObject({ sequence: 7 });
      await fixture.app.close();

      // The pin rotates, exactly as a key ceremony run after a suspected loss
      // would rotate it. Everything the old key signed stops counting.
      await writeFile(keyFile, `${keypair().pinned}\n`, { mode: 0o600 });
      fixture = await launchOfflineAt(userData, environment);

      await expect.poll(() => gauges(fixture)).toMatchObject({
        source: "bundled",
        sequence: 1,
        outcome: "discarded",
      });
      await expect(stat(storePath)).rejects.toThrow();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("no key pinned means no request and no stored feed", async () => {
    const { userData, environment } = await profile(
      "PLACEHOLDER-NO-REMOTE-FEED-TRUST",
    );
    const fixture = await launchOfflineAt(userData, environment);
    try {
      const counted = await fixture.app.evaluate(() => {
        const holder = globalThis as typeof globalThis & { __feedRequests?: number };
        holder.__feedRequests = 0;
        const real = globalThis.fetch;
        globalThis.fetch = (input, init) => {
          const url =
            typeof input === "string" || input instanceof URL
              ? String(input)
              : input.url;
          if (url.includes("certificate-feed")) {
            holder.__feedRequests = (holder.__feedRequests ?? 0) + 1;
          }
          if (url.startsWith("https://api.github.com/")) {
            return Promise.resolve(
              new globalThis.Response("[]", {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }
          return real(input, init);
        };
        return true;
      });
      expect(counted).toBe(true);
      await fixture.page.locator("#loading-update-check").click();

      await expect.poll(() => gauges(fixture)).toMatchObject({
        source: "bundled",
        sequence: 1,
        outcome: "unpinned",
      });
      expect(
        await fixture.app.evaluate(
          () =>
            (globalThis as typeof globalThis & { __feedRequests?: number })
              .__feedRequests,
        ),
      ).toBe(0);
      await expect(
        stat(path.join(userData, "game", "certificate-feed.json")),
      ).rejects.toThrow();
    } finally {
      await closeOffline(fixture);
    }
  });
});
