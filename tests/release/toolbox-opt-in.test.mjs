import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

// The Toolbox is no longer developer-only: `nativeCursor` opts a real player in.
// What still has to hold is that nothing enables it implicitly, that the two
// enabling parameters are the only doors, and that a client build we have not
// certified keeps serving the official module.

test("the production renderer contains no Toolbox UI or fixture route", () => {
  const html = read("src/renderer/index.html");
  const css = read("src/renderer/harness.css");
  const harness = read("src/renderer/harness.js");
  const trust = read("src/main/core/renderer-trust.ts");
  const window = read("src/main/window.ts");

  assert.doesNotMatch(html, /id="toolbox"|src="toolbox\.js"/);
  assert.doesNotMatch(css, /#toolbox|\.toolbox-/);
  assert.doesNotMatch(`${harness}\n${trust}\n${window}`, /toolbox-fixture/);
});

test("Toolbox instrumentation is opt-in and never implicit", () => {
  const policy = read("src/main/toolbox-policy.ts");
  const contracts = read("src/shared/contracts.ts");
  const main = read("src/main/main.ts");

  // Automation stays non-packaged and environment-gated.
  assert.match(
    policy,
    /!app\.isPackaged && process\.env\.GW_TOOLBOX_AUTOMATION === "1"/,
  );
  // Everyone else arrives through the setting, and only through the setting.
  assert.match(
    policy,
    /toolboxEnabledFor[\s\S]*TOOLBOX_AUTOMATION_ENABLED \|\| settings\.nativeCursor/,
  );
  // Opt-in means the default is off.
  assert.match(contracts, /nativeCursor: false/);

  // Main must ask the policy, not the bare automation constant.
  assert.match(main, /toolboxEnabled: toolboxEnabledFor\(settings\)/);
  assert.doesNotMatch(main, /toolboxEnabled: TOOLBOX_AUTOMATION_ENABLED/);
});

test("the renderer imports the Toolbox only behind a trusted parameter", () => {
  const harness = read("src/renderer/harness.js");
  const window = read("src/main/window.ts");
  const trust = read("src/main/core/renderer-trust.ts");

  // Either door opens it; neither is inferable from the page itself.
  assert.match(harness, /import\('\.\/toolbox\.js'\)/);
  assert.match(harness, /toolbox-automation'\) === '1'/);
  assert.match(harness, /native-cursor'\) === '1'/);

  // Main is the only writer of both parameters, each behind its own gate.
  assert.match(
    window,
    /if \(TOOLBOX_AUTOMATION_ENABLED\) parameters\.set\("toolbox-automation", "1"\)/,
  );
  assert.match(
    window,
    /if \(options\.nativeCursor\) parameters\.set\("native-cursor", "1"\)/,
  );

  // A renderer URL carrying either one has to survive the trust check.
  for (const name of ["toolbox-automation", "native-cursor"]) {
    assert.match(trust, new RegExp(`"${name}"`));
  }
});

test("an uncertified client build still serves the template-save client", () => {
  const runtime = read("src/main/client-runtime.ts");
  // Opting in must not cost template saving. The template-save client is
  // prepared unconditionally and is what the Toolbox transform consumes, so an
  // unknown build or a failed transform costs the cursor and nothing else. The
  // untouched official module is the last resort of that one path.
  assert.match(runtime, /if \(this\.options\.toolboxEnabled\)/);
  assert.equal(
    runtime.match(/const templateSaveWasm = await this\.templateSaveWasm\(/g)
      ?.length,
    1,
  );
  assert.match(runtime, /prepareToolboxClient\(\s*templateSaveWasm,/);
  assert.doesNotMatch(runtime, /prepareToolboxClient\(\s*officialWasm,/);
  assert.equal(
    runtime.match(/return officialWasm;/g)?.length,
    1,
  );
});
