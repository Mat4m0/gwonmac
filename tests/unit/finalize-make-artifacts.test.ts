import assert from "node:assert/strict";
import type { ForgeMakeResult } from "@electron-forge/shared-types";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { finalizeMakeArtifacts } from "../../scripts/finalize-make-artifacts.ts";
import { parseReleaseTargets } from "../../src/shared/release-targets.ts";

const targets = parseReleaseTargets({
  formatVersion: 1,
  targets: [
    {
      id: "linux-x64",
      platform: "linux",
      arch: "x64",
      format: "deb",
      filenameTemplate: "Guild-Wars-{version}-Linux-x64.deb",
      availability: "ci-preview",
    },
  ],
});

function result(artifacts: string[]): ForgeMakeResult {
  return {
    artifacts,
    packageJSON: {},
    platform: "linux",
    arch: "x64",
  };
}

test("make artifacts are hard-cut over to the canonical release filename", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gw-make-artifacts-"));
  const source = path.join(directory, "guild-wars_2026.7.0~beta.1_amd64.deb");
  await writeFile(source, "deb");
  const results = await finalizeMakeArtifacts(
    [result([source])],
    targets,
    "2026.7.0-beta.1",
  );
  const destination = path.join(
    directory,
    "Guild-Wars-2026.7.0-beta.1-Linux-x64.deb",
  );
  assert.deepEqual(results[0]?.artifacts, [destination]);
  assert.equal(await readFile(destination, "utf8"), "deb");
});

test("make finalization refuses ambiguous or unknown primary artifacts", async () => {
  await assert.rejects(
    finalizeMakeArtifacts(
      [result(["one.deb", "two.deb"])],
      targets,
      "2026.7.0-beta.1",
    ),
    /produced 2 primary/u,
  );
  await assert.rejects(
    finalizeMakeArtifacts(
      [{ ...result(["one.deb"]), arch: "arm64" }],
      targets,
      "2026.7.0-beta.1",
    ),
    /no canonical target/u,
  );
});
