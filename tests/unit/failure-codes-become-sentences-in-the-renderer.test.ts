// P5.13, executed rather than asserted about. The main process now sends a
// failure *code* on the progress channel and as a download outcome, so the
// sentence the player reads is chosen here. These run the real map: every
// member of the catalogue must produce prose, the two surfaces must give
// different advice for the same fault, and an unnamed code must land on one
// honest default rather than rendering as blank or as the code itself.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeDownloadFailure as download,
  describeLaunchFailure as launch,
} from "../../src/renderer/failure-messages.js";
import { ERROR_CODES } from "../../src/shared/errors.ts";

describe("renderer failure messages", () => {
  it("answers every code in the catalogue with a sentence, on both surfaces", () => {
    for (const code of ERROR_CODES) {
      for (const [surface, describe_] of [
        ["launch", launch],
        ["download", download],
      ] as const) {
        const text = describe_(code);
        assert.equal(typeof text, "string", `${surface} ${code}`);
        assert.ok(text.length > 20, `${surface} ${code} is not a sentence`);
        assert.ok(text.endsWith("."), `${surface} ${code} is not a sentence`);
        // The code is an identifier for us, not for the player.
        assert.equal(text.includes(code), false, `${surface} leaks ${code}`);
      }
    }
  });

  it("gives the same fault a different action on each surface", () => {
    // Disk space is the one failure with a concrete user action, and the
    // action differs: the launcher retries, the dock resumes.
    assert.match(launch("disk_full"), /free disk space/i);
    assert.match(launch("disk_full"), /Retry/);
    assert.match(download("disk_full"), /free disk space/i);
    assert.match(download("disk_full"), /Resume Download/);
    assert.notEqual(launch("disk_full"), download("disk_full"));
  });

  it("keeps the sentences the two probe and recovery paths used to send", () => {
    assert.equal(
      launch("wrong_profile"),
      "The live probe selected an unexpected profile. No update was started.",
    );
    assert.match(launch("not_ready"), /No game client has been downloaded/);
    assert.match(launch("artifact_unverified"), /failed verification/);
    assert.equal(
      download("not_ready"),
      "The game files are not ready yet. Try again in a moment.",
    );
  });

  it("falls back to one default rather than inventing a sentence per code", () => {
    // `unknown` is what any error this process did not raise collapses to, so
    // it is the code the default exists for.
    assert.equal(
      launch("unknown"),
      "ArenaNet is unavailable and no previous game client could be restored.",
    );
    assert.equal(
      download("unknown"),
      "The download could not continue. Check your connection, then choose Resume Download.",
    );
    // Codes that name a fault the player cannot act on share that default.
    assert.equal(launch("manifest_cycle"), launch("unknown"));
    assert.equal(download("hash_mismatch"), download("unknown"));
  });
});
