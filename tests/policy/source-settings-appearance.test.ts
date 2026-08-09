// The product has one OG Guild Wars interface. This source-level policy keeps
// a retired palette or geometry selector from quietly returning to Settings,
// while pinning the only remaining appearance control to main's exact bounds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Settings does not expose retired theme or geometry variants", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");
  for (const retired of ["uiTheme", "uiDensity", "uiBorderWidth", "uiRadius"]) {
    assert.doesNotMatch(html, new RegExp(`name=["']${retired}["']`, "u"));
  }
});

test("panel opacity is bounded exactly as main requires", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");
  const settings = await readFile(path.join(root, "src/main/core/settings.ts"), "utf8");
  const input = /<input\b[^>]*\bname\s*=\s*["']uiPanelOpacity["'][^>]*>/iu.exec(html);
  assert.ok(input, "index.html has no panel-opacity range");
  const attribute = (name: string) => {
    const found = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "iu").exec(input[0]);
    assert.ok(found, `panel opacity has no ${name}`);
    return found[1]!;
  };
  const bounds = /asBoundedInteger\(\s*src\.uiPanelOpacity,\s*"uiPanelOpacity",\s*(\d+),\s*(\d+),?\s*\)/u.exec(settings);
  assert.ok(bounds, "main does not bound uiPanelOpacity");
  assert.equal(attribute("type"), "range");
  assert.equal(attribute("min"), bounds[1]);
  assert.equal(attribute("max"), bounds[2]);
  assert.equal(attribute("step"), "1");
});
