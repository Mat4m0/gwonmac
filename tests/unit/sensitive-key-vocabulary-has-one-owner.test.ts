import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSensitiveKey,
  redactDiagnosticText,
} from "../../src/main/diagnostics/text-scan.ts";

/**
 * One invariant, one owner. The sensitive-key vocabulary was written out
 * twice — once in `src/main/diagnostic-recorder.ts` to drop a field by name,
 * once in `text-scan.ts` to scan text — and the two had drifted: `login` was
 * in the scanner and not in the recorder, so a field named `login` was written
 * to `events.jsonl` verbatim while `account` beside it was dropped. The
 * recorder now calls `isSensitiveKey`, and these are the words it must cover.
 */
describe("the sensitive-key vocabulary", () => {
  // Every stem the recorder used to carry, so unifying cannot narrow it.
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

  it("scans text for the same words it drops by name", () => {
    for (const word of dropped) {
      const output = redactDiagnosticText(`${word}=alice.smith`);
      assert.equal(
        output.includes("alice.smith"),
        false,
        `${word} is dropped by name but not scanned in text: ${output}`,
      );
    }
  });
});
