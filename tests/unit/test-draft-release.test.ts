import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { stageVerificationRecord } from "../../scripts/release-verification-record.ts";
import {
  assertDraftMetadata,
  compareBundleVersions,
  expectedAssets,
  parseReleaseTestTag,
  runDraftReleaseTest,
  type DraftRelease,
  type ReleaseTestDependencies,
} from "../../scripts/test-draft-release.ts";

const TAG = "v2026.8.8";
const VERSION = "2026.8.8";
const COMMIT = "a".repeat(40);
const CHECKSUM_ROWS = [
  `${"1".repeat(64)}  Guild-Wars-Reforged-${VERSION}-macOS-arm64.zip`,
  `${"2".repeat(64)}  Guild-Wars-Reforged-${VERSION}-macOS-arm64.dmg`,
  `${"3".repeat(64)}  Guild-Wars-Reforged-${VERSION}-macOS-arm64.spdx.json`,
  `${"4".repeat(64)}  RELEASES.json`,
];

interface Fixture {
  dependencies: ReleaseTestDependencies;
  root: string;
  temporaryParent: string;
  calls: string[];
  logs: string[];
  editedBody(): string | undefined;
  setFailure(value: string | undefined): void;
  setRunningAfterLaunch(value: boolean): void;
  close(): void;
}

function fixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-test-unit-"));
  const temporaryParent = path.join(root, "temporary");
  const installedApp = path.join(root, "Applications", "Guild Wars Reforged.app");
  const officialWasm = path.join(root, "profile", "Gw.jspi.wasm");
  mkdirSync(temporaryParent, { recursive: true });
  mkdirSync(installedApp, { recursive: true });
  mkdirSync(path.dirname(officialWasm), { recursive: true });
  writeFileSync(officialWasm, "official ArenaNet module");

  const body = stageVerificationRecord("Generated notes", {
    workflowUrl: "https://github.com/Mat4m0/gwonmac/actions/runs/123",
    targetCommit: COMMIT,
    applicationVersion: VERSION,
    bundleVersion: "2608.8.99",
    checksums: CHECKSUM_ROWS,
  });
  const draft: DraftRelease = {
    body,
    isDraft: true,
    isPrerelease: false,
    targetCommitish: COMMIT,
    assets: expectedAssets(VERSION).map((name) => ({ name })),
  };
  const calls: string[] = [];
  const logs: string[] = [];
  let failure: string | undefined;
  let runningAfterLaunch = false;
  let statusCalls = 0;
  let releaseBody: string | undefined;

  const run = (command: string, args: readonly string[]): string => {
    const call = `${command} ${args.join(" ")}`;
    calls.push(call);
    if (failure === "auth" && call.startsWith("gh auth status")) {
      throw new Error("expired GitHub login");
    }
    if (command === "git") return args[0] === "branch" ? "main" : COMMIT;
    if (command === "/usr/libexec/PlistBuddy") {
      const key = args[1];
      const application = args[2] ?? "";
      if (key === "Print :CFBundleShortVersionString") return VERSION;
      return application === path.join(installedApp, "Contents/Info.plist")
        ? "2608.7.99"
        : "2608.8.99";
    }
    if (command === "gh" && args[0] === "release" && args[1] === "view") {
      return JSON.stringify(draft);
    }
    if (command === "gh" && args[0] === "release" && args[1] === "download") {
      const directory = args[args.indexOf("--dir") + 1]!;
      for (const asset of expectedAssets(VERSION)) writeFileSync(path.join(directory, asset), asset);
      writeFileSync(path.join(directory, "SHA256SUMS.txt"), `${CHECKSUM_ROWS.join("\n")}\n`);
      return "";
    }
    if (command === "shasum" && failure === "checksum") {
      throw new Error("checksum mismatch");
    }
    if (
      command === "gh"
      && args[0] === "attestation"
      && failure === "attestation"
    ) {
      throw new Error("attestation failed");
    }
    if (command === "ditto") {
      mkdirSync(path.join(args[3]!, "Guild Wars Reforged.app"), { recursive: true });
      return "";
    }
    if (command === "open" && failure === "launch") {
      throw new Error("candidate launch refused");
    }
    if (command === "gh" && args[0] === "release" && args[1] === "edit") {
      if (failure === "notes") throw new Error("release-note update failed");
      releaseBody = readFileSync(args[args.indexOf("--notes-file") + 1]!, "utf8");
      return "";
    }
    if (command === "sysctl") {
      return args[1] === "hw.memsize" ? String(16 * 1024 ** 3) : "Mac16,1";
    }
    if (command === "sw_vers") return "15.6";
    return "";
  };

  const dependencies: ReleaseTestDependencies = {
    platform: "darwin",
    arch: "arm64",
    installedApp,
    officialWasm,
    temporaryParent,
    run,
    status: () => {
      statusCalls += 1;
      return statusCalls > 1 && runningAfterLaunch ? 0 : 1;
    },
    verifyCandidate: () => {
      if (failure === "signature") throw new Error("invalid signature");
    },
    prompt: async () => ({
      passed: true,
      dmgResult: "Not required — no packaging-sensitive change",
    }),
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    log: (message) => logs.push(message),
  };

  return {
    dependencies,
    root,
    temporaryParent,
    calls,
    logs,
    editedBody: () => releaseBody,
    setFailure: (value) => { failure = value; },
    setRunningAfterLaunch: (value) => { runningAfterLaunch = value; },
    close: () => rmSync(root, { recursive: true }),
  };
}

describe("temporary exact-draft testing", () => {
  it("compares macOS bundle versions numerically", () => {
    assert.equal(compareBundleVersions("2608.8.99", "2608.7.99"), 1);
    assert.equal(compareBundleVersions("2608.8.31", "2608.8.31"), 0);
    assert.equal(compareBundleVersions("2608.8.1", "2608.8.31"), -1);
    assert.throws(() => compareBundleVersions("bad", "2608.8.31"));
  });

  it("accepts Stable, Beta, and RC but refuses Alpha", () => {
    assert.deepEqual(parseReleaseTestTag("v2026.8.8"), {
      version: "2026.8.8",
      prerelease: false,
    });
    assert.equal(parseReleaseTestTag("v2026.8.8-beta.1").prerelease, true);
    assert.equal(parseReleaseTestTag("v2026.8.8-rc.1").prerelease, true);
    assert.throws(() => parseReleaseTestTag("v2026.8.8-alpha.1"), /Stable, Beta, or RC/u);
  });

  it("requires GitHub prerelease metadata to match the tag", () => {
    const releaseTag = parseReleaseTestTag("v2026.8.8-beta.1");
    assert.throws(
      () => assertDraftMetadata(
        "v2026.8.8-beta.1",
        {
          body: "",
          isDraft: true,
          isPrerelease: false,
          targetCommitish: COMMIT,
          assets: expectedAssets("2026.8.8-beta.1").map((name) => ({ name })),
        },
        COMMIT,
        releaseTag,
      ),
      /inconsistent GitHub prerelease metadata/u,
    );
  });

  it("refuses non-drafts and changed asset inventories", () => {
    const releaseTag = parseReleaseTestTag(TAG);
    const valid: DraftRelease = {
      body: "",
      isDraft: true,
      isPrerelease: false,
      targetCommitish: COMMIT,
      assets: expectedAssets(VERSION).map((name) => ({ name })),
    };
    assert.throws(
      () => assertDraftMetadata(TAG, { ...valid, isDraft: false }, COMMIT, releaseTag),
      /not a draft/u,
    );
    assert.throws(
      () => assertDraftMetadata(TAG, { ...valid, assets: [] }, COMMIT, releaseTag),
      /unexpected release assets/u,
    );
  });

  it("launches, records Passed, and removes the temporary candidate", async () => {
    const test = fixture();
    try {
      await runDraftReleaseTest(TAG, test.dependencies);
      assert.deepEqual(readdirSync(test.temporaryParent), []);
      assert.match(test.editedBody() ?? "", /Status: `Passed`/u);
      assert.ok(test.calls.some((call) => call.startsWith("open -n ")));
    } finally {
      test.close();
    }
  });

  for (const failure of ["checksum", "attestation", "signature", "launch"] as const) {
    it(`removes complete downloads after a pre-launch ${failure} failure`, async () => {
      const test = fixture();
      test.setFailure(failure);
      try {
        await assert.rejects(runDraftReleaseTest(TAG, test.dependencies));
        assert.deepEqual(readdirSync(test.temporaryParent), []);
      } finally {
        test.close();
      }
    });
  }

  it("creates no temporary download when GitHub authentication fails", async () => {
    const test = fixture();
    test.setFailure("auth");
    try {
      await assert.rejects(runDraftReleaseTest(TAG, test.dependencies), /expired GitHub login/u);
      assert.deepEqual(readdirSync(test.temporaryParent), []);
    } finally {
      test.close();
    }
  });

  it("retains a launched candidate when it is still running", async () => {
    const test = fixture();
    test.setRunningAfterLaunch(true);
    try {
      await assert.rejects(runDraftReleaseTest(TAG, test.dependencies), /Close Guild Wars Reforged/u);
      assert.equal(readdirSync(test.temporaryParent).length, 1);
      assert.ok(test.logs.some((line) => line.includes("retained for diagnosis")));
    } finally {
      test.close();
    }
  });

  it("retains a launched candidate when release-note recording fails", async () => {
    const test = fixture();
    test.setFailure("notes");
    try {
      await assert.rejects(runDraftReleaseTest(TAG, test.dependencies), /release-note update failed/u);
      assert.equal(readdirSync(test.temporaryParent).length, 1);
    } finally {
      test.close();
    }
  });
});
