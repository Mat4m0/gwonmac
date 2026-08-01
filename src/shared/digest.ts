/**
 * A SHA-256 digest as a type the compiler can keep apart from any other string.
 *
 * The brand is the point. Digests identify bytes and are safe to record; prose
 * quotes paths, hostnames and manifest entries and is not. Making them
 * different types means the diagnostics schema can accept one and reject the
 * other at compile time, instead of relying on every producer to remember which
 * of its strings was which.
 *
 * A `Digest` is created only by `asDigest`, and only from a lower-case 64-hex
 * string. There is no cast that skips the check.
 */
import { AppError } from "./errors.js";

/** A lower-case SHA-256 digest. It can identify bytes; it can never be prose. */
export type Digest = string & { readonly __digest: unique symbol };

const SHA256 = /^[a-f0-9]{64}$/;

export function isDigest(value: unknown): value is Digest {
  return typeof value === "string" && SHA256.test(value);
}

export function asDigest(value: string): Digest {
  if (!isDigest(value)) {
    throw new AppError("bad_digest", "expected a 64-character hex digest");
  }
  return value;
}
