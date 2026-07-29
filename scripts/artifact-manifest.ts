import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import releaseTargetsJson from "../release-targets.json" with { type: "json" };
import {
  parseArtifactManifest,
  signingPostureForPreview,
  type ArtifactManifestV1,
} from "../src/shared/artifact-manifest.js";
import {
  parseReleaseTargets,
  releaseTargetFilename,
  type ReleaseTarget,
  type ReleaseTargetsDocument,
} from "../src/shared/release-targets.js";

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function createArtifactManifest({
  appVersion,
  artifact,
  ciRunUrl,
  electronVersion,
  sourceCommit,
  target,
}: {
  readonly appVersion: string;
  readonly artifact: string;
  readonly ciRunUrl: string;
  readonly electronVersion: string;
  readonly sourceCommit: string;
  readonly target: ReleaseTarget;
}): Promise<ArtifactManifestV1> {
  return parseArtifactManifest({
    formatVersion: 1,
    sourceCommit,
    appVersion,
    electronVersion,
    targetId: target.id,
    platform: target.platform,
    arch: target.arch,
    format: target.format,
    filename: path.basename(artifact),
    sha256: await sha256File(artifact),
    signing: signingPostureForPreview(target),
    ciRunUrl,
  });
}

export async function verifyArtifactManifest(
  manifest: ArtifactManifestV1,
  artifact: string,
  target: ReleaseTarget,
): Promise<void> {
  if (
    manifest.targetId !== target.id
    || manifest.platform !== target.platform
    || manifest.arch !== target.arch
    || manifest.format !== target.format
    || manifest.filename !== releaseTargetFilename(target, manifest.appVersion)
    || path.basename(artifact) !== manifest.filename
  ) {
    throw new Error(`artifact manifest target mismatch: ${target.id}`);
  }
  if (await sha256File(artifact) !== manifest.sha256) {
    throw new Error(`artifact manifest hash mismatch: ${target.id}`);
  }
}

export async function writeArtifactManifest(
  manifest: ArtifactManifestV1,
  destination: string,
): Promise<void> {
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function assemblePublicArtifacts(
  distribution: string,
  document: ReleaseTargetsDocument,
  expected: {
    readonly appVersion: string | undefined;
    readonly ciRunUrl: string | undefined;
    readonly sourceCommit: string | undefined;
  } = {
    appVersion: undefined,
    ciRunUrl: undefined,
    sourceCommit: undefined,
  },
): Promise<readonly ArtifactManifestV1[]> {
  const publicTargets = document.targets.filter(
    (target) => target.availability === "public-preview",
  );
  const manifestFiles = (await readdir(distribution))
    .filter((file) => file.endsWith(".manifest.json"))
    .sort();
  const manifests = await Promise.all(manifestFiles.map(async (file) =>
    parseArtifactManifest(
      JSON.parse(await readFile(path.join(distribution, file), "utf8")),
    )
  ));
  if (manifests.length === 0) {
    throw new Error("public artifact target set is empty");
  }
  const targetIds = manifests.map((manifest) => manifest.targetId).sort();
  assertExactMembers(
    targetIds,
    publicTargets.map((target) => target.id).sort(),
    "public artifact target set",
  );
  if (
    new Set(manifests.map((manifest) => manifest.sourceCommit)).size !== 1
    || new Set(manifests.map((manifest) => manifest.appVersion)).size !== 1
  ) {
    throw new Error("public artifacts do not share one version and source commit");
  }
  const [identity] = manifests;
  if (
    (expected.appVersion !== undefined
      && identity!.appVersion !== expected.appVersion)
    || (expected.ciRunUrl !== undefined
      && identity!.ciRunUrl !== expected.ciRunUrl)
    || (expected.sourceCommit !== undefined
      && identity!.sourceCommit !== expected.sourceCommit)
  ) {
    throw new Error("public artifact identity does not match this release run");
  }
  const sourceCommit = (
    await readFile(path.join(distribution, "SOURCE_COMMIT.txt"), "utf8")
  ).trimEnd();
  if (sourceCommit !== identity!.sourceCommit) {
    throw new Error("public artifact source marker does not match its manifest");
  }
  for (const target of publicTargets) {
    const manifest = manifests.find((candidate) =>
      candidate.targetId === target.id
    )!;
    await verifyArtifactManifest(
      manifest,
      path.join(distribution, manifest.filename),
      target,
    );
  }
  await verifyDistributionChecksums(distribution);
  return Object.freeze(manifests);
}

export async function verifyDistributionChecksums(
  distribution: string,
): Promise<void> {
  const checksumFile = "SHA256SUMS.txt";
  const files = (await readdir(distribution))
    .filter((file) => file !== checksumFile)
    .sort();
  const text = await readFile(path.join(distribution, checksumFile), "utf8");
  const lines = text.trimEnd().split("\n");
  const entries = lines.map((line) => {
    const match = /^([0-9a-f]{64}) {2}([^/\\\r\n]+)$/u.exec(line);
    if (!match) throw new Error("distribution checksum file is invalid");
    return { hash: match[1]!, file: match[2]! };
  });
  assertExactMembers(
    entries.map((entry) => entry.file),
    files,
    "distribution checksum set",
  );
  for (const entry of entries) {
    if (await sha256File(path.join(distribution, entry.file)) !== entry.hash) {
      throw new Error(`distribution checksum mismatch: ${entry.file}`);
    }
  }
}

function assertExactMembers(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  if (actual.join("\0") !== expected.join("\0")) {
    throw new Error(`${label} is incomplete or ambiguous`);
  }
}

if (
  process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const distribution = path.resolve(
    process.argv[2] ?? path.join(import.meta.dirname, "..", "distribution"),
  );
  const manifests = await assemblePublicArtifacts(
    distribution,
    parseReleaseTargets(releaseTargetsJson),
    {
      appVersion: process.env.EXPECTED_APP_VERSION,
      ciRunUrl: process.env.EXPECTED_CI_RUN_URL,
      sourceCommit: process.env.EXPECTED_SOURCE_COMMIT,
    },
  );
  process.stdout.write(
    `verified ${manifests.length} public artifact manifest(s)\n`,
  );
}
