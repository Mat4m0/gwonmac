// This behavior is executed rather than asserted about. The main process sends
// a failure *code* on the progress channel and as a download outcome, so the
// sentence the player reads is chosen here. These run the real map: every
// member of the catalogue must produce prose, the two surfaces must give
// different advice for the same fault, and an unnamed code must land on one
// honest default rather than rendering as blank or as the code itself.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientCrashPresentation,
  describeDownloadFailure as download,
  describeLaunchFailure as launch,
  describeNotice,
  describeSnapshotReadFailure as snapshotRead,
  describeSteamRefusal,
  describeTemplateExportFailure as templateExport,
  failureDetail,
  memoryWarningCopy,
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
        ["templateExport", templateExport],
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
      assert.doesNotMatch(failureDetail(code), /Report a Bug/);
      assert.match(failureDetail(code), new RegExp(`Error code: ${code}`, "u"));
    }
    // Verification and unclassified failures might genuinely be ours.
    for (const code of ["artifact_unverified", "hash_mismatch", "unknown"]) {
      assert.equal(suggestReport(code), true, code);
      assert.match(failureDetail(code), /Report a Bug/);
      assert.match(failureDetail(code), new RegExp(`Error code: ${code}`, "u"));
    }
    // No code keeps the sentence the fail surface has always shown.
    assert.equal(
      failureDetail(),
      "You can retry, or choose Help → Report a Bug.",
    );
  });

  it("tells a locked Keychain apart from a build that may not use one", () => {
    // Unlocking is the player's to do; a missing entitlement is a signing
    // fault in what we shipped, and the two must not share one answer.
    assert.equal(suggestReport("keychain_locked"), false);
    assert.doesNotMatch(failureDetail("keychain_locked"), /Report a Bug/);
    assert.equal(suggestReport("keychain_unentitled"), true);
    assert.match(failureDetail("keychain_unentitled"), /Report a Bug/);
    // Neither reaches a transfer surface, so both take its honest default
    // rather than a sentence invented for a screen that never shows them.
    for (const code of ["keychain_locked", "keychain_unentitled"] as const) {
      assert.equal(launch(code), launch("unknown"));
      assert.equal(download(code), download("unknown"));
    }
  });

  it("stops promising a retry once the client crashes twice in one run", () => {
    const first = clientCrashPresentation(1);
    const repeated = clientCrashPresentation(2);
    for (const crash of [first, repeated]) {
      for (const text of [crash.label, crash.detail, crash.retryButton, crash.reportButton]) {
        assert.ok(text.length > 0, "crash presentation has empty prose");
      }
    }
    // The first crash reads as transient; the repeat leads with the report.
    assert.match(first.detail, /usually temporary/);
    assert.match(repeated.label, /keeps stopping/);
    assert.match(repeated.detail, /^Retrying alone may not fix this/);
    assert.match(repeated.detail, /Report a Bug/);
    // Buttons are identical across counts: escalation changes the words, not
    // the actions.
    assert.equal(first.retryButton, repeated.retryButton);
    assert.equal(first.reportButton, repeated.reportButton);
    // An unreadable count degrades to the first-crash presentation.
    assert.deepEqual(clientCrashPresentation(0), first);
  });

  it("escalates memory wording while keeping one action model", () => {
    const low = memoryWarningCopy("low", 2_147_483_648);
    const critical = memoryWarningCopy("critical", 2_147_483_648);
    for (const notice of [low, critical]) {
      for (const text of [
        notice.label,
        notice.detail,
        notice.reloadButton,
        notice.dismissButton,
        notice.explanation,
      ]) {
        assert.ok(text.length > 0, "memory notice has empty prose");
      }
      assert.doesNotMatch(notice.detail, /town or outpost/);
    }
    assert.match(low.detail, /^Reload when convenient/);
    assert.match(critical.detail, /^Reload soon/);
    assert.match(critical.label, /out of memory/);
    assert.equal(low.reloadButton, critical.reloadButton);
    assert.equal(low.dismissButton, critical.dismissButton);
  });

  it("prints the effective cap but no unreliable countdown", () => {
    for (const level of ["low", "critical"] as const) {
      const notice = memoryWarningCopy(level, 2_147_483_648);
      for (const text of [notice.label, notice.detail]) {
        assert.doesNotMatch(text, /\d/, text);
      }
      assert.match(notice.explanation, /2 GB/);
    }
  });

  it("states measured recovery without overpromising", () => {
    const explanation = memoryWarningCopy("critical", 2_147_483_648).explanation;
    assert.match(explanation, /puts you back where you were/);
    assert.match(explanation, /continued memory growth/);
    assert.doesNotMatch(explanation, /\b(guarantee\w*|never lose|always works?)\b/i);
  });
});
