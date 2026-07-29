import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import releaseTargetsJson from "../../release-targets.json" with { type: "json" };
import {
  assemblePublicArtifacts,
  createArtifactManifest,
  verifyArtifactManifest,
  writeArtifactManifest,
} from "../../scripts/artifact-manifest.ts";
import { writeDistributionChecksums } from "../../scripts/prepare-preview-artifact.ts";
import { parseArtifactManifest } from "../../src/shared/artifact-manifest.ts";
import {
  parseReleaseTargets,
  releaseTargetById,
  releaseTargetFilename,
  type ReleaseTargetsDocument,
} from "../../src/shared/release-targets.ts";

const VERSION = "2026.7.0-beta.1";
const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const CI_RUN_URL = "https://github.com/Mat4m0/gwonmac/actions/runs/123";
const ELECTRON_VERSION = "43.2.0";

const releaseTargets = parseReleaseTargets(releaseTargetsJson);
const macTarget = releaseTargetById(releaseTargets, "macos-arm64");

async function fixtureArtifact(
  directory: string,
  targetId = "macos-arm64",
): Promise<string> {
  const target = releaseTargetById(releaseTargets, targetId);
  const artifact = path.join(
    directory,
    releaseTargetFilename(target, VERSION),
  );
  await writeFile(artifact, `artifact:${targetId}`);
  return artifact;
}

async function completeDistribution(
  distribution: string,
  sourceCommit: string,
): Promise<void> {
  await writeFile(
    path.join(distribution, "SOURCE_COMMIT.txt"),
    `${sourceCommit}\n`,
  );
  await writeFile(path.join(distribution, "release.spdx.json"), "{}\n");
  await writeDistributionChecksums(distribution);
}

test("artifact manifests bind one canonical target to the actual bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gw-artifact-manifest-"));
  const artifact = await fixtureArtifact(root);
  const manifest = await createArtifactManifest({
    appVersion: VERSION,
    artifact,
    ciRunUrl: CI_RUN_URL,
    electronVersion: ELECTRON_VERSION,
    sourceCommit: COMMIT,
    target: macTarget,
  });

  assert.equal(manifest.targetId, "macos-arm64");
  assert.equal(manifest.signing, "adhoc");
  assert.equal(manifest.filename, path.basename(artifact));
  await verifyArtifactManifest(manifest, artifact, macTarget);

  await writeFile(artifact, "tampered");
  await assert.rejects(
    verifyArtifactManifest(manifest, artifact, macTarget),
    /hash mismatch/u,
  );
});

test("artifact manifests reject unknown fields and dishonest CI identities", () => {
  const valid = {
    formatVersion: 1,
    sourceCommit: COMMIT,
    appVersion: VERSION,
    electronVersion: ELECTRON_VERSION,
    targetId: "macos-arm64",
    platform: "darwin",
    arch: "arm64",
    format: "zip",
    filename: `Guild Wars-darwin-arm64-${VERSION}.zip`,
    sha256: "a".repeat(64),
    signing: "adhoc",
    ciRunUrl: CI_RUN_URL,
  };
  assert.doesNotThrow(() => parseArtifactManifest(valid));
  assert.throws(
    () => parseArtifactManifest({ ...valid, unreviewed: true }),
    /fields are invalid/u,
  );
  assert.throws(
    () => parseArtifactManifest({
      ...valid,
      ciRunUrl: "https://example.com/actions/runs/123",
    }),
    /ciRunUrl is invalid/u,
  );
  assert.throws(
    () => parseArtifactManifest({ ...valid, signing: "signed" }),
    /signing is invalid/u,
  );
});

test("the public assembler requires the exact configured set", async () => {
  const distribution = await mkdtemp(path.join(tmpdir(), "gw-public-set-"));
  const artifact = await fixtureArtifact(distribution);
  const manifest = await createArtifactManifest({
    appVersion: VERSION,
    artifact,
    ciRunUrl: CI_RUN_URL,
    electronVersion: ELECTRON_VERSION,
    sourceCommit: COMMIT,
    target: macTarget,
  });
  await writeArtifactManifest(manifest, `${artifact}.manifest.json`);
  await completeDistribution(distribution, COMMIT);

  const assembled = await assemblePublicArtifacts(
    distribution,
    releaseTargets,
    {
      appVersion: VERSION,
      ciRunUrl: CI_RUN_URL,
      sourceCommit: COMMIT,
    },
  );
  assert.deepEqual(assembled.map((candidate) => candidate.targetId), [
    "macos-arm64",
  ]);

  await writeArtifactManifest(
    { ...manifest, targetId: "unexpected" },
    path.join(distribution, "unexpected.manifest.json"),
  );
  await writeDistributionChecksums(distribution);
  await assert.rejects(
    assemblePublicArtifacts(distribution, releaseTargets),
    /target set is incomplete or ambiguous/u,
  );
});

test("the public assembler rejects mixed source commits", async () => {
  const distribution = await mkdtemp(path.join(tmpdir(), "gw-public-commit-"));
  await mkdir(distribution, { recursive: true });
  const windowsTarget = releaseTargetById(releaseTargets, "windows-x64");
  const document: ReleaseTargetsDocument = {
    formatVersion: 1,
    targets: [
      macTarget,
      { ...windowsTarget, availability: "public-preview" },
    ],
  };

  for (const [target, sourceCommit] of [
    [macTarget, COMMIT],
    [windowsTarget, "abcdef1234567890abcdef1234567890abcdef12"],
  ] as const) {
    const artifact = await fixtureArtifact(distribution, target.id);
    const manifest = await createArtifactManifest({
      appVersion: VERSION,
      artifact,
      ciRunUrl: CI_RUN_URL,
      electronVersion: ELECTRON_VERSION,
      sourceCommit,
      target,
    });
    await writeArtifactManifest(manifest, `${artifact}.manifest.json`);
  }
  await completeDistribution(distribution, COMMIT);

  await assert.rejects(
    assemblePublicArtifacts(distribution, document),
    /one version and source commit/u,
  );

  const manifestText = await readFile(
    path.join(
      distribution,
      `${releaseTargetFilename(macTarget, VERSION)}.manifest.json`,
    ),
    "utf8",
  );
  assert.equal(parseArtifactManifest(JSON.parse(manifestText)).sourceCommit, COMMIT);
});
