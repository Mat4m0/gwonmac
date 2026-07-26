// The catalogue is what makes diagnostics safe by construction: a producer can
// publish a code but never a message. These execute the extraction every
// producer will use, including the case that matters most — an error this
// process did not raise, whose `code` property is an open set we do not own.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AllowlistError,
  AppError,
  ERROR_CODES,
  GwError,
  HttpStatusError,
  NotReadyError,
  SecureStorageError,
  ValidationError,
  errorCode,
  isErrorCode,
} from "../../src/shared/errors.ts";

describe("error catalogue", () => {
  it("has no duplicate codes", () => {
    assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
  });

  it("recognises its own members and nothing else", () => {
    for (const code of ERROR_CODES) assert.ok(isErrorCode(code));
    // Node errno values look exactly like our codes and are not ours.
    assert.equal(isErrorCode("ENOENT"), false);
    assert.equal(isErrorCode("ECONNRESET"), false);
    assert.equal(isErrorCode(""), false);
    assert.equal(isErrorCode(undefined), false);
    assert.equal(isErrorCode(42), false);
    // Not inherited from Object.prototype.
    assert.equal(isErrorCode("toString"), false);
    assert.equal(isErrorCode("constructor"), false);
  });
});

describe("errorCode", () => {
  it("returns the code of an AppError", () => {
    assert.equal(errorCode(new AppError("chunk_offline", "no cached copy")), "chunk_offline");
  });

  it("returns the code of every AppError subclass", () => {
    assert.equal(errorCode(new GwError("disk_full", "no space")), "disk_full");
    assert.equal(errorCode(new ValidationError("bad input")), "validation");
    assert.equal(errorCode(new AllowlistError("blocked")), "allowlist");
    assert.equal(errorCode(new NotReadyError("not yet")), "not_ready");
    assert.equal(errorCode(new SecureStorageError("locked")), "secure_storage");
    assert.equal(errorCode(new HttpStatusError(503)), "http_status");
  });

  it("does not republish the code of a foreign error", () => {
    // `error.code` on a Node error is an unbounded identifier we do not
    // control. Passing it through would reopen exactly the hole the catalogue
    // closes, so it collapses to one declared value.
    const errno = Object.assign(new Error("ENOENT: no such file or directory, open '/Users/x/secret.txt'"), {
      code: "ENOENT",
      path: "/Users/x/secret.txt",
    });
    assert.equal(errorCode(errno), "unknown");
  });

  it("survives anything that is not an Error at all", () => {
    assert.equal(errorCode("/Users/x/secret.txt"), "unknown");
    assert.equal(errorCode(undefined), "unknown");
    assert.equal(errorCode(null), "unknown");
    assert.equal(errorCode({ code: "credentials_corrupt" }), "unknown");
  });

  it("keeps the message on the error and out of the code", () => {
    const error = new AppError("hash_mismatch", "hash mismatch on chunk /Users/x/a.dat");
    assert.equal(errorCode(error), "hash_mismatch");
    assert.ok(isErrorCode(errorCode(error)));
    assert.notEqual(error.message, errorCode(error));
  });

  it("preserves the cause chain, which never reaches a code", () => {
    const cause = new Error("connect ECONNREFUSED 10.0.0.1:443");
    const error = new AppError("fetch_failed", "fetch failed", { cause });
    assert.equal(errorCode(error), "fetch_failed");
    assert.equal(error.cause, cause);
  });
});
