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
  describeNotice,
  describeSnapshotReadFailure as snapshotRead,
  describeSteamRefusal,
  failureDetail,
  suggestReport,
} from "../../src/renderer/failure-messages.js";
import { NOTICE_CODES } from "../../src/shared/contracts.ts";
import { ERROR_CODES } from "../../src/shared/errors.ts";

describe("renderer failure messages", () => {
  it("answers every code in the catalogue with a sentence, on every surface", () => {
    for (const code of ERROR_CODES) {
      for (const [surface, describe_] of [
        ["launch", launch],
        ["download", download],
        ["snapshot", snapshotRead],
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

  it("carries the disk shortfall into the sentence when the caller knows it", () => {
    assert.match(
      download("disk_full", { shortfall: "2.3 GB" }),
      /At least 2\.3 GB more is needed\.$/u,
    );
    // Context is disk-specific: other codes ignore it rather than growing a
    // second sentence.
    assert.equal(
      download("net_offline", { shortfall: "2.3 GB" }),
      download("net_offline"),
    );
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
    // The snapshot surface accepts arbitrary strings — the code arrives as a
    // header value, not a checked ErrorCode — and lands on its default.
    assert.equal(snapshotRead("no-such-code"), snapshotRead(null));
  });

  it("answers every notice code with a sentence", () => {
    for (const code of NOTICE_CODES) {
      const text = describeNotice(code);
      assert.ok(text.length > 20, `${code} is not a sentence`);
      assert.ok(/[.!]$/.test(text), `${code} is not a sentence`);
      assert.equal(text.includes(code), false, `notice leaks ${code}`);
    }
    // Offline is narrated as the app working, never as a failure.
    assert.doesNotMatch(describeNotice("offline-using-cached-client"), /fail/i);
  });

  it("explains a failed Steam sign-in and stays silent on a plain cancel", () => {
    // The player closed the window themselves; narrating that would be noise.
    assert.equal(describeSteamRefusal("cancelled"), null);
    for (const reason of ["state-mismatch", "no-token", "failed"] as const) {
      const text = describeSteamRefusal(reason);
      assert.ok(text && text.length > 20, `${reason} is not a sentence`);
      assert.match(text, /already linked to a Guild Wars account/);
      assert.equal(text.includes(reason), false, `steam leaks ${reason}`);
    }
  });

  it("tells offline apart from a server fault, on both transfer surfaces", () => {
    assert.notEqual(launch("net_offline"), launch("http_status"));
    assert.notEqual(download("net_offline"), download("http_status"));
    assert.match(launch("net_offline"), /offline/i);
    assert.match(launch("http_status"), /server error/i);
    // Neither collapses into the old catch-all.
    assert.notEqual(launch("net_offline"), launch("unknown"));
    assert.notEqual(download("http_status"), download("unknown"));
  });

  it("suggests a bug report only when the fault may be the app's", () => {
    // Network and disk conditions are the player's to fix.
    for (const code of ["net_offline", "http_status", "disk_full", "not_ready", "dns_timeout"]) {
      assert.equal(suggestReport(code), false, code);
      assert.doesNotMatch(failureDetail(code), /Report a Problem/);
      assert.match(failureDetail(code), new RegExp(`Error code: ${code}`, "u"));
    }
    // Verification and unclassified failures might genuinely be ours.
    for (const code of ["artifact_unverified", "hash_mismatch", "unknown"]) {
      assert.equal(suggestReport(code), true, code);
      assert.match(failureDetail(code), /Report a Problem/);
      assert.match(failureDetail(code), new RegExp(`Error code: ${code}`, "u"));
    }
    // No code keeps the sentence the fail surface has always shown.
    assert.equal(
      failureDetail(),
      "You can retry, or choose Help → Report a Problem.",
    );
  });
});
