/**
 * Whether a certificate feed that did not ship inside this application may be
 * believed at all: the pinned Ed25519 key, and the detached-signature check
 * over the exact bytes.
 *
 * The key is pinned in `certificates/public-key.txt` and the file's committed
 * content is the sentinel below, so a clone of this repository trusts no remote
 * feed and no key ceremony has to have happened for the application to work.
 * The sentinel is not a fallback to weaker trust — it removes remote trust
 * entirely: `certificateFeedTrust` answers `remote: false`, every fetched feed
 * is refused with a code, and the bundled snapshot governs. Fail closed, and
 * loud enough to diagnose.
 *
 * Only fetched feeds are signed. The bundled snapshot is derived from tables
 * compiled into an application that is already signed and notarised, so there
 * is nothing an attacker could replace independently, and a second signature
 * over it would be a second source of the same truth.
 *
 * This module refuses to own what a feed *means*: it verifies bytes and hands
 * them to the parser. It holds no private key material and no key ceremony —
 * `certificates/README.md` owns that, and nothing here can generate a keypair.
 */
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { parseCertificateFeed, type CertificateFeed } from "./certificate-feed.js";

/**
 * The committed content of `certificates/public-key.txt`. It is a value no
 * base64 key can collide with, so "unset" is never mistaken for "malformed".
 */
export const CERTIFICATE_FEED_KEY_SENTINEL = "PLACEHOLDER-NO-REMOTE-FEED-TRUST";

/**
 * The fixed SPKI wrapper for a raw 32-byte Ed25519 public key (RFC 8410).
 * Pinning the raw key rather than a PEM keeps the committed file one reviewable
 * line and leaves the algorithm to this constant rather than to the file.
 */
const ED25519_SPKI_PREFIX = Uint8Array.of(
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
);
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

export type CertificateFeedTrust =
  | { readonly remote: false }
  | { readonly remote: true; readonly publicKey: KeyObject };

function refuse(what: string): never {
  throw new AppError("certificate_feed_signature", `certificate feed: ${what}`);
}

/**
 * Reads the pinned key file's content. Anything that is not the sentinel must
 * be exactly one canonical base64 line holding 32 bytes: a file that is neither
 * is a mistake somebody made, and answering `remote: false` there would hide it
 * behind the same behaviour as the deliberate placeholder.
 */
export function certificateFeedTrust(pinned: string): CertificateFeedTrust {
  const text = pinned.trim();
  if (text === CERTIFICATE_FEED_KEY_SENTINEL) return { remote: false };
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) {
    refuse("the pinned key file is neither the placeholder nor one base64 line");
  }
  const raw = Buffer.from(text, "base64");
  if (raw.byteLength !== ED25519_PUBLIC_KEY_BYTES || raw.toString("base64") !== text) {
    refuse("the pinned key is not a canonical 32-byte Ed25519 public key");
  }
  return {
    remote: true,
    publicKey: createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    }),
  };
}

/**
 * A fetched feed's bytes become a feed only after the signature over those
 * exact bytes verifies. Verification runs before parsing on purpose: the parser
 * is hardened, but bytes nobody vouched for should not reach it at all.
 */
export function verifyFetchedCertificateFeed(
  trust: CertificateFeedTrust,
  bytes: Uint8Array,
  signature: Uint8Array,
): CertificateFeed {
  if (!trust.remote) refuse("no pinned key, so no remote feed is trusted");
  if (signature.byteLength !== ED25519_SIGNATURE_BYTES) {
    refuse(`signature is ${signature.byteLength} bytes, not ${ED25519_SIGNATURE_BYTES}`);
  }
  if (!verify(null, bytes, trust.publicKey, signature)) {
    refuse("signature does not verify under the pinned key");
  }
  return parseCertificateFeed(bytes);
}
