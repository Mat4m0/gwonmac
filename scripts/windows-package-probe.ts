/** Inspect the exact unsigned Squirrel.Windows package produced by target CI. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DISTRIBUTION_CHANNEL_CONFIG } from "../src/shared/distribution-channel.js";
import { releaseUpdateArtifactName } from "../src/shared/project-identity.js";

async function peFile(file: string): Promise<void> {
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "MZ", `${file} is not a PE file`);
}

export async function probeWindowsPackage(root: string): Promise<Readonly<{
  platform: "win32";
  architecture: "x64";
  setup: string;
  package: string;
  signed: false;
  installedRuntime: "unproven";
}>> {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    version: string;
  };
  const product = DISTRIBUTION_CHANNEL_CONFIG.release.productName;
  const packageRoot = path.join(root, "out", `${product}-win32-x64`);
  const resources = path.join(packageRoot, "resources");
  assert.equal(
    existsSync(path.join(resources, "distribution-channel.json")),
    false,
    "an unsigned package must not claim distribution capabilities",
  );
  await peFile(path.join(packageRoot, `${product}.exe`));
  await peFile(path.join(resources, "app.asar.unpacked", "build", "native", "windows-host.node"));
  await peFile(path.join(resources, "app.asar.unpacked", "build", "native", "gw-dat-decode.exe"));

  const makeRoot = path.join(root, "out", "make", "squirrel.windows", "x64");
  const artifacts = (await readdir(makeRoot)).sort();
  const setup = releaseUpdateArtifactName(manifest.version, "win32-x64");
  assert.ok(artifacts.includes(setup), "the versioned Setup executable is missing");
  assert.ok(artifacts.includes("RELEASES"), "the Squirrel RELEASES file is missing");
  assert.equal(artifacts.some((file) => file.endsWith(".msi")), false);
  assert.equal(artifacts.some((file) => file.includes("-delta.nupkg")), false);
  const packages = artifacts.filter((file) => file.endsWith("-full.nupkg"));
  assert.equal(packages.length, 1, "one full Squirrel package is required");
  const releases = (await readFile(path.join(makeRoot, "RELEASES"), "utf8"))
    .trim()
    .split(/\r?\n/u);
  assert.equal(releases.length, 1, "the first package cannot name previous releases");
  assert.match(
    releases[0]!,
    new RegExp(`^[0-9A-Fa-f]{40} ${packages[0]!.replaceAll(".", "\\.")} [1-9][0-9]*$`, "u"),
  );
  await peFile(path.join(makeRoot, setup));
  return {
    platform: "win32",
    architecture: "x64",
    setup,
    package: packages[0]!,
    signed: false,
    installedRuntime: "unproven",
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  globalThis.console.log(JSON.stringify(
    await probeWindowsPackage(path.resolve(import.meta.dirname, "..")),
    null,
    2,
  ));
}
