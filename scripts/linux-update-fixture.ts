/** Build one older Linux package without leaving source changes behind. */
import { spawn } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { qualificationBaselineVersion } from "./qualification-baseline-version.js";

function runPackage(root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["package"], {
      cwd: root,
      env: { ...process.env, GW_PACKAGE_INTENT: "release" },
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`baseline package build failed: ${code ?? signal}`));
    });
  });
}

export async function buildLinuxUpdateFixture(
  root: string,
  destination: string,
): Promise<string> {
  if (
    process.platform !== "linux"
    || process.arch !== "x64"
    || process.env.GITHUB_ACTIONS !== "true"
    || process.env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    throw new Error("Linux update fixtures run only on a fresh hosted Linux x64 runner");
  }
  const manifestPath = path.join(root, "package.json");
  const original = await readFile(manifestPath);
  const manifest = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
  if (typeof manifest.version !== "string") throw new Error("package.json has no version");
  const baseline = qualificationBaselineVersion(manifest.version);
  try {
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...manifest, version: baseline }, null, 2)}\n`,
    );
    await runPackage(root);
    await rm(destination, { recursive: true, force: true });
    await cp(
      path.join(root, "out", "Guild Wars Reforged-linux-x64"),
      destination,
      { recursive: true },
    );
  } finally {
    await writeFile(manifestPath, original);
  }
  return baseline;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [destination, ...extra] = process.argv.slice(2);
  if (!destination || extra.length > 0) {
    throw new Error("usage: linux-update-fixture <destination>");
  }
  globalThis.console.log(await buildLinuxUpdateFixture(
    path.resolve(import.meta.dirname, ".."),
    path.resolve(destination),
  ));
}
