import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublishableVerification,
  parseVerificationRecord,
  replaceVerificationRecord,
  stageVerificationRecord,
  type MachineVerification,
} from "../../scripts/release-verification-record.ts";

const machine: MachineVerification = {
  workflowUrl: "https://github.com/Mat4m0/gwonmac/actions/runs/123",
  targetCommit: "a".repeat(40),
  applicationVersion: "2026.8.8",
  bundleVersion: "2608.8.99",
  checksums: [
    `${"1".repeat(64)}  Guild-Wars-Reforged-2026.8.8-macOS-arm64.zip`,
    `${"2".repeat(64)}  RELEASES.json`,
  ],
};

describe("the one marked release Verification record", () => {
  it("stages Pending evidence without changing generated notes", () => {
    const body = "Intro\n\n## What's Changed\n\n- Fixed things\n";
    const staged = stageVerificationRecord(body, machine);
    assert.match(staged, /^Intro[\s\S]*## What's Changed/u);
    assert.match(staged, /Status: `Pending`/u);
    assert.deepEqual(parseVerificationRecord(staged)?.machine, machine);
  });

  it("replaces only the marked block", () => {
    const body = stageVerificationRecord("Before\n\nAfter", machine);
    const parsed = parseVerificationRecord(body);
    assert.ok(parsed);
    const passed = replaceVerificationRecord(body, {
      machine: parsed.machine,
      manual: {
        status: "Passed",
        testedAt: "2026-08-14T12:00:00.000Z",
        macModel: "Mac16,1",
        memory: "16 GB",
        macOSVersion: "15.6",
        arenaNetSha256: "f".repeat(64),
        dmgResult: "Not required — no packaging-sensitive change",
      },
    });
    assert.match(passed, /^Before\n\nAfter\n\n<!-- gwonmac-verification:start -->/u);
    assert.doesNotThrow(() => assertPublishableVerification(passed, machine));
  });

  it("preserves a passed result only for the same immutable evidence", () => {
    const pending = stageVerificationRecord("Notes", machine);
    const parsed = parseVerificationRecord(pending);
    assert.ok(parsed);
    const passed = replaceVerificationRecord(pending, {
      machine: parsed.machine,
      manual: {
        status: "Passed",
        testedAt: "2026-08-14T12:00:00.000Z",
        macModel: "Mac16,1",
        memory: "16 GB",
        macOSVersion: "15.6",
        arenaNetSha256: "f".repeat(64),
        dmgResult: "Passed",
      },
    });
    assert.equal(stageVerificationRecord(passed, machine), passed);
    assert.throws(
      () => stageVerificationRecord(passed, {
        ...machine,
        workflowUrl: "https://github.com/Mat4m0/gwonmac/actions/runs/456",
      }),
      /refusing to overwrite passed verification/u,
    );
    assert.throws(
      () => assertPublishableVerification(passed, {
        ...machine,
        workflowUrl: "https://github.com/Mat4m0/gwonmac/actions/runs/456",
      }),
      /exact release assets/u,
    );
    assert.throws(
      () => stageVerificationRecord(passed, { ...machine, targetCommit: "b".repeat(40) }),
      /refusing to overwrite passed verification/u,
    );
  });

  it("refuses duplicate markers, changed checksum rows, and Pending results", () => {
    const staged = stageVerificationRecord("Notes", machine);
    assert.throws(() => parseVerificationRecord(`${staged}\n${staged}`), /at most one/u);
    assert.throws(() => assertPublishableVerification(staged, machine), /Pending/u);
    assert.throws(
      () => assertPublishableVerification(staged, { ...machine, checksums: ["different"] }),
      /exact release assets/u,
    );
  });
});
