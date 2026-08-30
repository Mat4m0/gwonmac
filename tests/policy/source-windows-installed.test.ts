/** Static safety and coverage gates for installed Windows qualification. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const script = readFileSync(
  path.join(root, "scripts/windows-installed-qualification.ts"),
  "utf8",
);
const workflow = readFileSync(
  path.join(root, ".github/workflows/portable-native-build.yml"),
  "utf8",
);
const signedWorkflow = readFileSync(
  path.join(root, ".github/workflows/windows-signed-qualification.yml"),
  "utf8",
);

test("installed qualification is restricted to a disposable hosted runner", () => {
  assert.match(script, /process\.platform !== "win32"/u);
  assert.match(script, /process\.arch !== "x64"/u);
  assert.match(script, /GITHUB_ACTIONS !== "true"/u);
  assert.match(script, /RUNNER_ENVIRONMENT !== "github-hosted"/u);
  assert.match(script, /refusing to replace a pre-existing Windows fixture root/u);
  assert.match(script, /useDefaultUserData: true/u);
  assert.match(script, /"--disable-gpu"/u);
  assert.match(script, /"--disable-crash-reporter"/u);
  assert.doesNotMatch(script, /--no-sandbox|--disable-setuid-sandbox/u);
});

test("the installed artifact owns the profile, Tool, and uninstall proof", () => {
  assert.match(script, /profiles\.create/u);
  assert.match(script, /localStorage\.getItem\("profile-proof"\)/u);
  assert.match(script, /tools\.loaded/u);
  assert.match(script, /SystemInfo\.getInfo/u);
  assert.match(script, /uninstall removed player settings/u);
  const make = workflow.indexOf("Build the unsigned Windows Squirrel package");
  const installed = workflow.indexOf("Qualify the installed Windows package");
  assert.ok(make >= 0 && installed > make);
});

test("signed qualification cannot publish and uses only synthetic credentials", () => {
  assert.match(signedWorkflow, /workflow_dispatch:/u);
  assert.match(signedWorkflow, /environment: windows-release/u);
  assert.match(signedWorkflow, /GW_PACKAGE_INTENT: release/u);
  assert.match(signedWorkflow, /GW_WINDOWS_SIGNED_QUALIFICATION: "1"/u);
  assert.doesNotMatch(signedWorkflow, /upload-artifact|gh release|contents: write/u);
  assert.match(script, /main-qualified@example\.invalid/u);
  assert.match(script, /second-qualified@example\.invalid/u);
  assert.match(script, /credentials\.clear\(\)/u);
});
