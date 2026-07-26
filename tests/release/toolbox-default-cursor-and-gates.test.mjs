import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

// The Toolbox is neither developer-only nor opt-in any more: `nativeCursor`
// ships on, so every player runs the derived module. Three things still have
// to hold. The player can switch each tool off and the app remembers that.
// Automation — the tier that could send input — stays behind `!app.isPackaged`.
// And an uncertified client build keeps serving the official module.
//
// The default and the switch-off are executed against build/; the gates are
// read as source, because what they assert is the shape of the shipped code.

test("the cursor ships on, and a player who switches it off stays off", async () => {
  const { DEFAULT_SETTINGS } = await import(
    new URL("../../build/shared/contracts.js", import.meta.url)
  );
  const { parseSettings } = await import(
    new URL("../../build/main/core/settings.js", import.meta.url)
  );

  assert.equal(DEFAULT_SETTINGS.nativeCursor, true);
  // A profile from before the flip never wrote the key; it gets the default.
  assert.equal(parseSettings({ renderScale: 1 }).nativeCursor, true);
  // A player who turned it off keeps it off across the same read path. The
  // default must never be re-applied over a recorded "no".
  assert.equal(parseSettings({ nativeCursor: false }).nativeCursor, false);

  // Off is reachable from the UI, not only from the file.
  assert.match(read("src/renderer/index.html"), /name="nativeCursor"/);
});

test("automation is the one tier a shipped build cannot reach", () => {
  const policy = read("src/main/toolbox-policy.ts");
  const main = read("src/main/main.ts");

  // Automation stays non-packaged and environment-gated. This is the gate the
  // public claim rests on: no packaged build can send game input, whatever the
  // environment says.
  assert.match(
    policy,
    /!app\.isPackaged && process\.env\.GW_TOOLBOX_AUTOMATION === "1"/,
  );
  // Everyone else arrives through the setting, and only through the setting.
  assert.match(
    policy,
    /toolboxEnabledFor[\s\S]*TOOLBOX_AUTOMATION_ENABLED \|\| settings\.nativeCursor/,
  );

  // Main must ask the policy, not the bare automation constant.
  assert.match(main, /toolboxEnabled: toolboxEnabledFor\(settings\)/);
  assert.doesNotMatch(main, /toolboxEnabled: TOOLBOX_AUTOMATION_ENABLED/);
});

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

test("the renderer imports the Toolbox only behind a trusted parameter", () => {
  const harness = read("src/renderer/harness.js");
  const window = read("src/main/window.ts");
  const trust = read("src/main/core/renderer-trust.ts");

  // Either door opens it; neither is inferable from the page itself.
  assert.match(harness, /import\('\.\/toolbox\.js'\)/);
  assert.match(harness, /toolbox-automation'\) === '1'/);
  assert.match(harness, /native-cursor'\) === '1'/);

  // Main is the only writer of both parameters, each behind its own gate. The
  // cursor parameter is written from the setting, so switching the setting off
  // is what removes it — the default does not bypass the gate, it satisfies it.
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
  // Default-on must not cost template saving. The template-save client is
  // prepared unconditionally and is what the Toolbox transform consumes, so an
  // unknown build or a failed transform costs the cursor and nothing else. The
  // untouched official module is the last resort of that one path.
  //
  // The rule itself — which of the three certification states may load the
  // Toolbox — is executed in tests/unit/client-certification.test.ts. What is
  // asserted here is that this composition asks it.
  assert.match(
    runtime,
    /if \(this\.options\.toolboxEnabled && toolboxMayLoad\(state\)\)/,
  );
  assert.equal(
    runtime.match(/const templateSaveWasm = await this\.templateSaveWasm\(/g)
      ?.length,
    1,
  );
  assert.match(runtime, /prepareToolboxClient\(\s*templateSaveWasm \?\? officialWasm,/);
  assert.doesNotMatch(runtime, /prepareToolboxClient\(\s*officialWasm,/);
  // The one fallback: no derived module means ArenaNet's own, and it is the
  // only way a launch ends without the template-save client.
  assert.equal(
    runtime.match(/wasmPath: templateSaveWasm \?\? officialWasm/g)?.length,
    1,
  );
});
