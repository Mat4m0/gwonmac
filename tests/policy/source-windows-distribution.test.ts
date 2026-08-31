/** Static release boundaries for the first Windows x64 Squirrel package. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const forge = readFileSync(path.join(root, "forge.config.ts"), "utf8");
const main = readFileSync(path.join(root, "src/main/main.ts"), "utf8");

test("Windows uses one per-user Squirrel package with explicit signed inputs", () => {
  assert.match(forge, /new MakerSquirrel\(/u);
  assert.match(forge, /name: channelConfig\.windowsPackageId/u);
  assert.match(forge, /exe: `\$\{channelConfig\.productName\}\.exe`/u);
  assert.match(forge, /noMsi: true/u);
  assert.match(forge, /noDelta: true/u);
  assert.match(forge, /WINDOWS_CERTIFICATE_FILE/u);
  assert.match(forge, /WINDOWS_CERTIFICATE_PASSWORD/u);
  assert.match(forge, /https:\/\/timestamp\.digicert\.com/u);
  assert.match(forge, /setupIcon: path\.resolve\("assets\/AppIcon\.ico"\)/u);
});

test("Squirrel lifecycle handling precedes the single-instance product path", () => {
  const lifecycle = main.indexOf("handleWindowsSquirrelStartup");
  const lock = main.indexOf("requestSingleInstanceLock");
  assert.ok(lifecycle >= 0 && lock > lifecycle);
  assert.match(main, /!windowsSquirrelStartupHandled\s*&& app\.requestSingleInstanceLock/u);
});
