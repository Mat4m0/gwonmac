import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("0.0.2 production renderer contains no Toolbox UI or fixture route", () => {
  const html = read("src/renderer/index.html");
  const css = read("src/renderer/harness.css");
  const harness = read("src/renderer/harness.js");
  const trust = read("src/main/core/renderer-trust.ts");
  const window = read("src/main/window.ts");

  assert.doesNotMatch(html, /id="toolbox"|src="toolbox\.js"/);
  assert.doesNotMatch(css, /#toolbox|\.toolbox-/);
  assert.doesNotMatch(`${harness}\n${trust}\n${window}`, /toolbox-fixture/);
  assert.match(harness, /import\('\.\/toolbox\.js'\)/);
  assert.match(harness, /toolbox-automation'\) === '1'/);
  assert.match(window, /TOOLBOX_AUTOMATION_ENABLED/);
});

test("Toolbox automation is disabled in packaged sessions", () => {
  const policy = read("src/main/toolbox-policy.ts");
  const runtime = read("src/main/client-runtime.ts");
  assert.match(
    policy,
    /!app\.isPackaged && process\.env\.GW_TOOLBOX_AUTOMATION === "1"/,
  );
  assert.match(runtime, /if \(!this\.options\.toolboxEnabled\)/);
  assert.match(runtime, /prepareTemplateSaveClient/);
  assert.match(runtime, /return \{ wasmPath: prepared\.wasmPath, build: null \}/);
});
