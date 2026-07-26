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
