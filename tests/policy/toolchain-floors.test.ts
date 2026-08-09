// Three floors decide what this repository compiles against: the Rust channel,
// the components installed with it, and the Node the build scripts require.
// Each is declared in exactly one file, and a declaration nothing reads is one
// that disappears in the next edit — a workflow that builds on the runner
// image's own toolchain, or a Node below the floor, both produce output before
// anything says so. This is what fails when one of them goes missing.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// Only the fields these assertions read. `JSON.parse` returns `any`, which
// would erase the checking of every one of them.
type Manifest = { engines?: { node?: string }; scripts?: Record<string, string> };
const scripts: Record<string, string> =
  (JSON.parse(read("package.json")) as Manifest).scripts ?? {};

const workflowDirectory = path.join(root, ".github/workflows");
const workflows = readdirSync(workflowDirectory).filter((file) =>
  /\.ya?ml$/u.test(file),
);

test("rust-toolchain.toml pins the channel, its components, and the wasm target", () => {
  const toolchain = read("rust-toolchain.toml");
  assert.match(toolchain, /^channel = "\d+\.\d+\.\d+"$/mu);
  assert.match(toolchain, /^targets = \["wasm32-unknown-unknown"\]$/mu);

  const components = /^components = \[([^\]]*)\]$/mu.exec(toolchain)?.[1];
  assert.ok(components !== undefined, "rust-toolchain.toml lists no components");
  // The compiler carries the lints the kernel denies; `rust-std` is what
  // `targets` above installs `core` from.
  for (const component of ["rustc", "rust-std"]) {
    assert.match(components, new RegExp(`"${component}"`, "u"));
  }
});

// Derived from the manifest rather than listed, because a script added tomorrow
// that reaches the kernel compiler is exactly the one a written list misses.
const kernelBuilders = new Set(
  Object.entries(scripts)
    .filter(([, command]) => command.includes("node scripts/build.mjs"))
    .map(([name]) => name),
);
for (let added = true; added; ) {
  added = false;
  for (const [name, command] of Object.entries(scripts)) {
    if (kernelBuilders.has(name)) continue;
    if ([...kernelBuilders].some((called) => callsScript(command, called))) {
      kernelBuilders.add(name);
      added = true;
    }
  }
}

/** Script names are word characters, colons and dashes, so none is a pattern. */
function callsScript(command: string, name: string): boolean {
  return new RegExp(`\\bpnpm (?:run )?${name}(?![\\w:-])`, "u").test(command);
}

/**
 * Every line of a workflow that compiles the kernel, and the subset of them
 * that runs before the pinned toolchain is installed.
 */
function kernelBuilds(text: string): { builds: string[]; unpinned: string[] } {
  // Blanked rather than dropped, so a reported line number is the one an editor
  // shows. A comment that names a script is prose, not a step that runs it.
  const lines = text.split("\n").map((line) => (/^\s*#/u.test(line) ? "" : line));
  const builds: string[] = [];
  const unpinned: string[] = [];
  // Each job gets its own runner, so an install in one pins nothing in the
  // next; entering a job forgets what the job above it installed.
  let inJobs = false;
  let installed = false;
  for (const [index, line] of lines.entries()) {
    if (/^\S/u.test(line)) inJobs = /^jobs:\s*$/u.test(line);
    else if (inJobs && /^ {2}[\w-]+:\s*$/u.test(line)) installed = false;
    if (/^\s*(?:-\s+)?run:\s*rustup toolchain install\b/u.test(line)) installed = true;
    if (![...kernelBuilders].some((name) => callsScript(line, name))) continue;
    builds.push(`${index + 1}: ${line.trim()}`);
    if (!installed) unpinned.push(`${index + 1}: ${line.trim()}`);
  }
  return { builds, unpinned };
}

test("every script name is a literal the build scan can match", () => {
  assert.ok(kernelBuilders.has("build"), "no script runs scripts/build.mjs");
  for (const name of Object.keys(scripts)) assert.match(name, /^[\w:-]+$/u);
});

test("every workflow that compiles the kernel installs the pinned toolchain first", () => {
  const unpinned: string[] = [];
  let building = 0;
  for (const file of workflows) {
    const { builds, unpinned: violations } = kernelBuilds(read(`.github/workflows/${file}`));
    if (builds.length > 0) building += 1;
    unpinned.push(...violations.map((line) => `${file}:${line}`));
  }

  assert.ok(building > 0, "no workflow was found to build; the scan is broken");
  assert.deepEqual(unpinned, []);
});

test("the toolchain scan rejects a build on the runner's own toolchain", () => {
  const job = (name: string, ...runs: string[]) =>
    `  ${name}:\n    steps:\n${runs.map((run) => `      - run: ${run}\n`).join("")}`;
  const workflow = (...jobs: string[]) => `jobs:\n${jobs.join("")}`;
  const steps = (...runs: string[]) => workflow(job("a", ...runs));

  assert.equal(kernelBuilds(steps("pnpm build")).unpinned.length, 1);
  assert.equal(
    kernelBuilds(steps("pnpm build", "rustup toolchain install")).unpinned.length,
    1,
    "installing after the build must not read as pinned",
  );
  assert.deepEqual(
    kernelBuilds(steps("rustup toolchain install", "pnpm build")).unpinned,
    [],
  );
  assert.equal(
    kernelBuilds(
      workflow(job("a", "rustup toolchain install", "pnpm build"), job("b", "pnpm build")),
    ).unpinned.length,
    1,
    "an install in the job above runs on another runner and pins nothing here",
  );
});

const nodeFloor = /^>=(\d+)\.(\d+)$/u.exec(
  (JSON.parse(read("package.json")) as Manifest).engines?.node ?? "",
);

test("the Node floor is declared once and enforced before anything is built", () => {
  assert.ok(nodeFloor, "package.json declares no >=<major>.<minor> Node engine floor");
  assert.equal(
    (JSON.parse(read("apps/tools/package.json")) as Manifest).engines?.node,
    (JSON.parse(read("package.json")) as Manifest).engines?.node,
    "the root build invokes Tools, so both packages must accept the same Node floor",
  );

  // scripts/build.mjs is the one file every entry point runs before the
  // compiler, and it reads the floor rather than restating it.
  const build = read("scripts/build.mjs");
  assert.match(build, /readFileSync\("package\.json", "utf8"\)/u);
  assert.match(build, /manifest\.engines\?\.node/u);
  assert.match(build, /process\.versions\.node/u);
});

test("every workflow pins a Node version the floor accepts", () => {
  assert.ok(nodeFloor);
  const [, major = "0", minor = "0"] = nodeFloor;

  const below: string[] = [];
  let pinned = 0;
  for (const file of workflows) {
    for (const [index, line] of read(`.github/workflows/${file}`).split("\n").entries()) {
      const version = /^\s*node-version:\s*"?(\d+(?:\.\d+)?)"?\s*$/u.exec(line)?.[1];
      if (version === undefined) continue;
      pinned += 1;
      const [pinnedMajor = 0, pinnedMinor = 0] = version.split(".").map(Number);
      const accepted = pinnedMajor === Number(major)
        ? pinnedMinor >= Number(minor)
        : pinnedMajor > Number(major);
      if (!accepted) below.push(`${file}:${index + 1} pins ${version}`);
    }
  }

  assert.ok(pinned > 0, "no workflow pins a Node version; the scan is broken");
  assert.deepEqual(below, []);
});
