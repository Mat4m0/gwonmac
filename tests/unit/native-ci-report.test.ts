import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseSteps,
  readClosedSummary,
} from "../../scripts/native-ci-report.js";

async function writeSummary(root: string, value: unknown): Promise<void> {
  const directory = path.join(
    root,
    "test-results",
    "electron-stable",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "summary.json"),
    JSON.stringify(value),
  );
}

describe("native CI evidence", () => {
  it("accepts only closed step names and outcomes", () => {
    assert.deepEqual(parseSteps(["build=success", "electron=failure"]), [
      { name: "build", outcome: "success" },
      { name: "electron", outcome: "failure" },
    ]);
    for (const unsafe of [
      "build=unknown",
      "../build=failure",
      "build=failure\nTOKEN=value",
    ]) {
      assert.throws(() => parseSteps([unsafe]));
    }
  });

  it("rejects secrets and machine-local paths in a test summary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gw-ci-report-"));
    try {
      for (const title of [
        "redirect access_token=secret",
        "profile at /Users/example/private",
        "cookie leaked",
      ]) {
        await writeSummary(root, {
          formatVersion: 1,
          counts: {
            passed: 0,
            failed: 1,
            skipped: 0,
            timedOut: 0,
            interrupted: 0,
          },
          results: [
            {
              title,
              source: "tests/electron/example.spec.ts:1",
              status: "failed",
            },
          ],
        });
        await assert.rejects(() => readClosedSummary(root, "stable"));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts one repository-relative closed failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gw-ci-report-"));
    try {
      await writeSummary(root, {
        formatVersion: 1,
        counts: {
          passed: 3,
          failed: 1,
          skipped: 0,
          timedOut: 0,
          interrupted: 0,
        },
        results: [
          {
            title: "diagnostics › renderer is gone",
            source: "tests/electron/diagnostics.spec.ts:10",
            status: "failed",
          },
        ],
      });
      assert.deepEqual(await readClosedSummary(root, "stable"), {
        suite: "stable",
        counts: {
          passed: 3,
          failed: 1,
          skipped: 0,
          timedOut: 0,
          interrupted: 0,
        },
        earliestFailure: {
          title: "diagnostics › renderer is gone",
          source: "tests/electron/diagnostics.spec.ts:10",
          status: "failed",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
