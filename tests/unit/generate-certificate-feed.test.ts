// The producer of both feed documents this repository has: the snapshot the
// build bundles, and the candidate a publication signs. What is asserted here
// is that they are one derivation — same tables, same bytes, one number apart —
// because the publication workflow proves a candidate by deriving it twice on
// two runners and comparing, and that comparison means nothing if the generator
// can answer differently for reasons other than the tables.
//
// Keypairs are generated per run and never leave this process. No private key
// material exists in this repository.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import {
  generate,
  parseArguments,
  publicationSequence,
  OUTPUT,
} from "../../scripts/generate-certificate-feed.ts";
import {
  BUNDLED_CERTIFICATE_FEED_SEQUENCE,
  parseCertificateFeed,
} from "../../src/main/certification/certificate-feed.ts";
import {
  certificateFeedTrust,
  verifyFetchedCertificateFeed,
} from "../../src/main/certification/certificate-feed-trust.ts";

const PUBLICATION_SEQUENCE = BUNDLED_CERTIFICATE_FEED_SEQUENCE + 41;

describe("the certificate feed generator", () => {
  it("writes the bundled snapshot's sequence when it is asked for nothing", () => {
    assert.deepEqual(parseArguments([]), {
      sequence: BUNDLED_CERTIFICATE_FEED_SEQUENCE,
      out: OUTPUT,
    });
    assert.equal(
      parseCertificateFeed(generate()).sequence,
      BUNDLED_CERTIFICATE_FEED_SEQUENCE,
    );
  });

  it("changes nothing but the sequence when it is asked for a publication", () => {
    const bundled = new TextDecoder().decode(generate());
    const candidate = new TextDecoder().decode(generate(PUBLICATION_SEQUENCE));
    assert.equal(
      candidate.replace(
        `"sequence": ${PUBLICATION_SEQUENCE}`,
        `"sequence": ${BUNDLED_CERTIFICATE_FEED_SEQUENCE}`,
      ),
      bundled,
    );
  });

  it("refuses a sequence no installation would ever adopt", () => {
    // At or below the compiled-in snapshot, `governingCertificateFeed` keeps
    // what it already has, so publishing one spends a signature on nothing.
    for (const sequence of ["0", `${BUNDLED_CERTIFICATE_FEED_SEQUENCE}`]) {
      assert.throws(() => publicationSequence(sequence), /does not beat/u);
    }
    for (const sequence of ["", " 2", "2.0", "+2", "-2", "0x2", "02"]) {
      assert.throws(() => publicationSequence(sequence), /decimal integer/u);
    }
  });

  it("reads the two flags a publication passes, and no others", () => {
    assert.deepEqual(
      parseArguments(["--sequence", "7", "--out", "candidate/certificate-feed.json"]),
      { sequence: 7, out: "candidate/certificate-feed.json" },
    );
    assert.throws(() => parseArguments(["--seq", "7"]), /unknown argument/u);
    assert.throws(() => parseArguments(["--sequence"]), /needs a value/u);
  });
});

describe("the two assets a publication uploads", () => {
  it("verify against the pinned line the key ceremony prints", () => {
    // Exactly what the workflow does with `openssl`: the pin is the raw 32
    // bytes of the public half in base64, and the detached signature travels as
    // base64 with a trailing newline. Both spellings are asserted here because
    // the signing job holds no repository code that could assert them.
    const pair = generateKeyPairSync("ed25519");
    const spki = pair.publicKey.export({ format: "der", type: "spki" });
    const pinned = `${spki.subarray(spki.byteLength - 32).toString("base64")}\n`;
    const document = generate(PUBLICATION_SEQUENCE);
    const detached = `${Buffer.from(sign(null, document, pair.privateKey)).toString("base64")}\n`;

    assert.equal(detached.trim().length, 88);
    const trust = certificateFeedTrust(pinned);
    const feed = verifyFetchedCertificateFeed(
      trust,
      document,
      Buffer.from(detached.trim(), "base64"),
    );
    assert.equal(feed.sequence, PUBLICATION_SEQUENCE);
  });
});
