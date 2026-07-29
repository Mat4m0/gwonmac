import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import releaseTargetsJson from "../release-targets.json" with { type: "json" };
import {
  createArtifactManifest,
  sha256File,
  writeArtifactManifest,
} from "./artifact-manifest.js";
import { packagedElectronLayout } from "./electron-layout.js";
import {
  parseReleaseTargets,
  releaseTargetById,
  releaseTargetFilename,
} from "../src/shared/release-targets.js";

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function outputLine(key: string, value: string): string {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`CI output ${key} contains a line break`);
  }
  return `${key}=${value}\n`;
}

export async function preparePreviewArtifact(
  root: string,
  targetId: string,
  sourceCommit: string,
): Promise<{
  readonly application: string;
  readonly artifact: string;
  readonly checksum: string;
  readonly manifest: string;
  readonly sbom: string;
}> {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error("source commit is not a full Git SHA");
  }
  const document = parseReleaseTargets(releaseTargetsJson);
  const target = releaseTargetById(document, targetId);
  if (process.platform !== target.platform || process.arch !== target.arch) {
    throw new Error("preview artifact target does not match this runner");
  }
  const { version } = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ) as { version: string };
  const filename = releaseTargetFilename(target, version);
  const matches = (await filesBelow(path.join(root, "out", "make"))).filter(
    (file) => path.basename(file) === filename,
  );
  if (matches.length !== 1) {
    throw new Error(`expected one canonical preview artifact named ${filename}`);
  }

  const distribution = path.join(root, "distribution");
  await rm(distribution, { recursive: true, force: true });
  await mkdir(distribution, { recursive: true });
  const artifact = path.join(distribution, filename);
  await copyFile(matches[0]!, artifact);
  await writeFile(
    path.join(distribution, "SOURCE_COMMIT.txt"),
    `${sourceCommit}\n`,
  );
  const stem = filename.replace(/\.(?:zip|exe|deb)$/u, "");
  const manifest = `${artifact}.manifest.json`;
  const electronPackage = JSON.parse(
    await readFile(path.join(root, "node_modules", "electron", "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof electronPackage.version !== "string") {
    throw new Error("installed Electron version is unavailable");
  }
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (
    repository === undefined
    || !/^[^/\s]+\/[^/\s]+$/u.test(repository)
    || runId === undefined
    || !/^[1-9][0-9]*$/u.test(runId)
  ) {
    throw new Error("GitHub Actions run identity is unavailable");
  }
  await writeArtifactManifest(
    await createArtifactManifest({
      appVersion: version,
      artifact,
      ciRunUrl: `https://github.com/${repository}/actions/runs/${runId}`,
      electronVersion: electronPackage.version,
      sourceCommit,
      target,
    }),
    manifest,
  );
  return {
    application: packagedElectronLayout(
      root,
      target.platform,
      target.arch,
    ).application,
    artifact,
    checksum: path.join(distribution, "SHA256SUMS.txt"),
    manifest,
    sbom: path.join(distribution, `${stem}.spdx.json`),
  };
}

export async function writeDistributionChecksums(
  distribution: string,
): Promise<void> {
  const files = (await readdir(distribution))
    .filter((file) => file !== "SHA256SUMS.txt")
    .sort();
  if (files.length === 0) throw new Error("distribution is empty");
  const lines: string[] = [];
  for (const file of files) {
    lines.push(
      `${await sha256File(path.join(distribution, file))}  ${file}`,
    );
  }
  await writeFile(
    path.join(distribution, "SHA256SUMS.txt"),
    `${lines.join("\n")}\n`,
  );
}

const targetId = process.argv[2];
if (
  targetId !== undefined
  && process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const root = path.resolve(import.meta.dirname, "..");
  const prepared = await preparePreviewArtifact(
    root,
    targetId,
    process.env.GITHUB_SHA ?? "",
  );
  const output = process.env.GITHUB_OUTPUT;
  if (output === undefined) throw new Error("GITHUB_OUTPUT is unavailable");
  await appendFile(
    output,
    Object.entries(prepared)
      .map(([key, value]) => outputLine(key, value))
      .join(""),
  );
}
