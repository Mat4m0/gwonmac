import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSensitiveKey,
  redactDiagnosticText,
} from "../../src/main/diagnostics/text-scan.ts";

/**
 * One invariant, one owner. App-authored events are now closed by schema and
 * never pass through this vocabulary. `text-scan.ts` owns these stems for the
 * OS/Chromium documents and trace that still require pattern scanning.
 */
describe("the sensitive-key vocabulary", () => {
  // The complete intentionally broad scanner vocabulary.
  const dropped = [
    "pass",
    "auth",
    "cookie",
    "token",
    "secret",
    "credential",
    "username",
    "email",
    "account",
    // The word the two spellings disagreed about.
    "login",
  ];

  for (const word of dropped) {
    it(`treats a field named ${word} as sensitive`, () => {
      assert.equal(isSensitiveKey(word), true);
      assert.equal(isSensitiveKey(`${word}Name`), true);
      assert.equal(isSensitiveKey(`renderer${word[0]!.toUpperCase()}${word.slice(1)}`), true);
    });
  }

  it("leaves the field names the schema already declares alone", () => {
    for (const key of ["status", "route", "method", "priority", "phase", "code", "bytes"]) {
      assert.equal(isSensitiveKey(key), false, key);
    }
  });

  it("scans text for every sensitive key stem", () => {
    for (const word of dropped) {
      const output = redactDiagnosticText(`${word}=alice.smith`);
      assert.equal(
        output.includes("alice.smith"),
        false,
        `${word} is recognized by key but not scanned in text: ${output}`,
      );
    }
  });
});
