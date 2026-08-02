// Keypairs are generated per run and never leave this process. No private key
// material exists in this repository — not in a fixture, not in a constant, not
// in a committed file — and `tests/policy/forbidden-artifacts.test.ts` is what
// keeps that true rather than this comment.
//
// The committed pinned-key file is read here rather than restated, so the
// canonical-key rule and the file the application ships cannot drift apart.
// The placeholder state every fresh clone starts in stays covered through the
// exported sentinel constant, because the committed file has left that state.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bundledCertificateFeed,
  serializeCertificateFeed,
} from "../../src/main/certification/certificate-feed.ts";
import {
  CERTIFICATE_FEED_KEY_SENTINEL,
  certificateFeedTrust,
  verifyFetchedCertificateFeed,
} from "../../src/main/certification/certificate-feed-trust.ts";
import { AppError } from "../../src/shared/errors.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PINNED_KEY_FILE = path.join(root, "certificates/public-key.txt");

const FEED = serializeCertificateFeed(bundledCertificateFeed());

/** One throwaway signer. Its private half exists only for this process. */
function signer(): { pinned: string; signature: Uint8Array } {
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    pinned: spki.subarray(spki.byteLength - 32).toString("base64"),
    signature: sign(null, FEED, pair.privateKey),
  };
}

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "certificate_feed_signature");
    return error;
  }
  return assert.fail("a feed was trusted that must not be");
}

describe("the pinned key that ships in this repository", () => {
  it("is one canonical Ed25519 key line, so remote feeds are trusted", () => {
    const committed = readFileSync(PINNED_KEY_FILE, "utf8");
    const line = committed.trim();
    // Canonical spelling: exactly the base64 of 32 raw key bytes, no second
    // spelling of the same key, nothing else in the file.
    assert.equal(Buffer.from(line, "base64").toString("base64"), line);
    assert.equal(Buffer.from(line, "base64").byteLength, 32);
    assert.equal(certificateFeedTrust(committed).remote, true);
  });

  it("refuses a feed signed by anyone but the pinned key's holder", () => {
    const trust = certificateFeedTrust(readFileSync(PINNED_KEY_FILE, "utf8"));
    const { signature } = signer();
    assert.match(
      refusal(() => verifyFetchedCertificateFeed(trust, FEED, signature)).message,
      /does not verify under the pinned key/,
    );
  });

  it("trusts no remote feed while the placeholder sentinel is the pin", () => {
    assert.deepEqual(certificateFeedTrust(CERTIFICATE_FEED_KEY_SENTINEL), {
      remote: false,
    });
    const trust = certificateFeedTrust(`${CERTIFICATE_FEED_KEY_SENTINEL}\n`);
    const { signature } = signer();
    assert.match(
      refusal(() => verifyFetchedCertificateFeed(trust, FEED, signature)).message,
      /no pinned key/,
    );
  });

  it("is not a fall back for a key file somebody mistyped", () => {
    for (const pinned of ["", "not-base64!!", "AAAA", `${CERTIFICATE_FEED_KEY_SENTINEL}x`]) {
      refusal(() => certificateFeedTrust(pinned));
    }
    // Canonical base64 only: the trailing bits of the last character are
    // checked, so two spellings of one key are not two valid pins.
    const { pinned } = signer();
    refusal(() => certificateFeedTrust(`${pinned.slice(0, 43)}=extra`));
  });
});

describe("a pinned key that is really a key", () => {
  it("accepts a feed the key holder signed", () => {
    const { pinned, signature } = signer();
    const trust = certificateFeedTrust(pinned);
    assert.equal(trust.remote, true);
    assert.deepEqual(
      verifyFetchedCertificateFeed(trust, FEED, signature).entries.size,
      bundledCertificateFeed().entries.size,
    );
  });

  it("refuses a signature made by anybody else", () => {
    const trust = certificateFeedTrust(signer().pinned);
    assert.match(
      refusal(() => verifyFetchedCertificateFeed(trust, FEED, signer().signature)).message,
      /does not verify under the pinned key/,
    );
  });

  it("refuses bytes that changed after they were signed", () => {
    const { pinned, signature } = signer();
    const trust = certificateFeedTrust(pinned);
    // A change the parser would happily accept: one certified build claiming to
    // be a different one. Only the signature can object to it.
    const text = new TextDecoder().decode(FEED);
    const edited = text.replace('"buildId": 38797', '"buildId": 38798');
    assert.notEqual(edited, text);
    const tampered = new TextEncoder().encode(edited);
    assert.match(
      refusal(() => verifyFetchedCertificateFeed(trust, tampered, signature)).message,
      /does not verify under the pinned key/,
    );
  });

  it("refuses a signature that is not an Ed25519 signature at all", () => {
    const { pinned } = signer();
    const trust = certificateFeedTrust(pinned);
    for (const length of [0, 63, 65]) {
      assert.match(
        refusal(() =>
          verifyFetchedCertificateFeed(trust, FEED, new Uint8Array(length))).message,
        /signature is \d+ bytes, not 64/,
      );
    }
  });

  it("verifies before it parses, so unvouched bytes never reach the parser", () => {
    const pair = generateKeyPairSync("ed25519");
    const spki = pair.publicKey.export({ format: "der", type: "spki" });
    const trust = certificateFeedTrust(spki.subarray(spki.byteLength - 32).toString("base64"));
    const garbage = new TextEncoder().encode("{}");
    // Unsigned garbage is refused as a signature failure, not as a schema one.
    assert.match(
      refusal(() => verifyFetchedCertificateFeed(trust, garbage, new Uint8Array(64))).message,
      /does not verify under the pinned key/,
    );
    // Signed garbage gets exactly as far as the parser, and no further.
    try {
      verifyFetchedCertificateFeed(trust, garbage, sign(null, garbage, pair.privateKey));
      assert.fail("signed garbage parsed");
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "certificate_feed_format");
    }
  });
});
