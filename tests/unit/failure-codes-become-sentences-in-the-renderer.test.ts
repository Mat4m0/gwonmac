// P5.13, executed rather than asserted about. The main process now sends a
// failure *code* on the progress channel and as a download outcome, so the
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
  failureDetail,
  memoryExplanation,
  memoryPressureChip,
  memoryPressurePresentation,
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

  it("tells a locked Keychain apart from a build that may not use one", () => {
    // Unlocking is the player's to do; a missing entitlement is a signing
    // fault in what we shipped, and the two must not share one answer.
    assert.equal(suggestReport("keychain_locked"), false);
    assert.doesNotMatch(failureDetail("keychain_locked"), /Report a Problem/);
    assert.equal(suggestReport("keychain_unentitled"), true);
    assert.match(failureDetail("keychain_unentitled"), /Report a Problem/);
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
    // The privacy half-sentence the player needs before agreeing to export.
    assert.match(repeated.detail, /not your account or chat/);
    // Buttons are identical across counts: escalation changes the words, not
    // the actions.
    assert.equal(first.retryButton, repeated.retryButton);
    assert.equal(first.reportButton, repeated.reportButton);
    // An unreadable count degrades to the first-crash presentation.
    assert.deepEqual(clientCrashPresentation(0), first);
  });

  it("escalates the memory watermark words, not its actions", () => {
    const low = memoryPressurePresentation("low", 20);
    const critical = memoryPressurePresentation("critical", 5);
    for (const notice of [low, critical]) {
      for (const text of [
        notice.label,
        notice.detail,
        notice.reloadButton,
        notice.dismissButton,
        notice.whyLink,
      ]) {
        assert.ok(text.length > 0, "memory notice has empty prose");
      }
      // The safe place is named, so a player who wants certainty has it.
      assert.match(notice.detail, /town or outpost/);
      // The detail opens with the action. Derived from the button so it
      // survives a rename, and it pins the ordering the redesign is about:
      // what to do first, why it is happening behind a link.
      assert.ok(
        notice.detail.startsWith(notice.reloadButton.split(" ")[0]!),
        `detail does not open with the action: ${notice.detail}`,
      );
    }
    // Escalation lives in the urgency of the instruction, not in a fear
    // sentence: the deadline shrinks and "when it suits you" becomes "soon".
    assert.match(low.detail, /^Reload when it suits you/);
    assert.match(critical.detail, /^Reload soon/);
    assert.match(critical.label, /out of memory/);
    // Buttons are identical across levels: escalation changes the words,
    // not the actions.
    assert.equal(low.reloadButton, critical.reloadButton);
    assert.equal(low.dismissButton, critical.dismissButton);
  });

  it("claims a number only when one was measured, and never in the detail", () => {
    const measured = memoryPressurePresentation("low", 20);
    assert.match(measured.label, /About 20 minutes/);

    // No rate, no figure. An estimate we did not measure is worse than none,
    // so the label falls back to the sentence that states only the condition.
    const blind = memoryPressurePresentation("low", null);
    assert.doesNotMatch(blind.label, /\d/);
    assert.match(blind.label, /running low/);
    assert.doesNotMatch(memoryPressurePresentation("critical", null).label, /\d/);

    // The number is injected, not baked in, and it agrees with itself.
    assert.match(memoryPressurePresentation("critical", 3).label, /About 3 minutes/);
    assert.match(memoryPressurePresentation("critical", 1).label, /About 1 minute\b/);

    // Never in the detail: the banner's number is frozen when shown, and a
    // stale figure in a sentence that outlives it would be a lie.
    for (const minutes of [null, 1, 5, 20] as const) {
      for (const level of ["low", "critical"] as const) {
        assert.doesNotMatch(
          memoryPressurePresentation(level, minutes).detail,
          /\d/,
        );
      }
    }
  });

  it("hedges the reconnect until somebody has actually tested it", () => {
    // Guild Wars offers an instance back after a dropped connection, but
    // whether our reload triggers that offer is unverified. This test is what
    // stops the wording being firmed up before the experiment is run.
    const strings = [
      memoryPressurePresentation("low", 20),
      memoryPressurePresentation("critical", 5),
    ].flatMap((notice) => [notice.label, notice.detail]);
    const explanation = memoryExplanation();
    strings.push(...explanation.blocks.map((block) => block.body));

    assert.ok(
      strings.some((text) => /should be able to rejoin/.test(text)),
      "the hedge disappeared",
    );
    for (const text of strings) {
      assert.doesNotMatch(text, /\b(will|can) (put|place|return) you back\b/i, text);
    }
  });

  it("explains the memory limit without claiming ArenaNet has been contacted", () => {
    const explanation = memoryExplanation();
    assert.equal(explanation.blocks.length, 4);
    for (const block of explanation.blocks) {
      assert.ok(block.title.length > 0, "block has no title");
      assert.ok(block.body.length > 40, `${block.title} is not an explanation`);
    }
    const stands = explanation.blocks[2]!;
    for (const claim of [/measured/, /documented/, /published/]) {
      assert.match(stands.body, claim);
    }
    // What is true today is that the findings are published. Saying more than
    // that in the app would be a claim nobody could back.
    const joined = explanation.blocks.map((block) => block.body).join(" ");
    assert.doesNotMatch(joined, /in contact with|reported to ArenaNet/i);
  });

  it("keeps counting on the chip a dismissal leaves behind", () => {
    assert.match(memoryPressureChip("critical", 4).text, /4/);
    assert.ok(memoryPressureChip("critical", 4).label.length > 20);
    // Below a minute it must not round up to "1 min" and read as reassurance.
    assert.match(memoryPressureChip("critical", 0).text, /Under a minute/);
    // And with no measurement it states the condition rather than a figure.
    assert.doesNotMatch(memoryPressureChip("low", null).text, /\d/);
  });
});
