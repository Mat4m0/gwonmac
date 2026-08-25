// Settings exposes one closed style choice, one semantic custom palette, and
// one bounded visibility control. Geometry knobs must not quietly return.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UI_PANEL_OPACITY_MAX,
  UI_PANEL_OPACITY_MIN,
} from "../../src/shared/contracts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Settings exposes two built-ins and one semantic custom theme", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");
  for (const retired of ["uiDensity", "uiBorderWidth", "uiRadius"]) {
    assert.doesNotMatch(html, new RegExp(`name=["']${retired}["']`, "u"));
  }
  const values = [...html.matchAll(/<input\b[^>]*\bname=["']uiStyle["'][^>]*\bvalue=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]);
  assert.deepEqual(values, ["guild-wars", "obsidian"]);
  for (const key of ["window", "recessed", "selected", "accent"]) {
    assert.match(html, new RegExp(`data-theme-hex=["']${key}["']`, "u"));
  }
  assert.match(html, /name=["']uiThemeWindowGradient["']/u);
  assert.match(html, /id=["']settings-theme-use-custom["']/u);
  assert.doesNotMatch(html, /Surprise me/iu);
});

test("Settings exposes the independent interface fonts", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");
  const select = /<select\b[^>]*\bname=["']uiFont["'][^>]*>([\s\S]*?)<\/select>/iu
    .exec(html)?.[1] ?? "";
  const values = [...select.matchAll(/<option\b[^>]*\bvalue=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]);
  assert.deepEqual(values, ["guild-wars", "inter", "system", "avenir", "georgia", "palatino"]);
});

test("Settings exposes the two controller prompt styles", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");
  const select = /<select\b[^>]*\bname=["']controllerPromptStyle["'][^>]*>([\s\S]*?)<\/select>/iu
    .exec(html)?.[1] ?? "";
  const values = [...select.matchAll(/<option\b[^>]*\bvalue=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]);
  assert.deepEqual(values, ["game-default", "playstation"]);
});

test("panel opacity uses the canonical bounds", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");
  const input = /<input\b[^>]*\bname\s*=\s*["']uiPanelOpacity["'][^>]*>/iu.exec(html);
  assert.ok(input, "index.html has no panel-opacity range");
  const attribute = (name: string) => {
    const found = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "iu").exec(input[0]);
    assert.ok(found, `panel opacity has no ${name}`);
    return found[1]!;
  };
  assert.equal(attribute("type"), "range");
  assert.equal(attribute("min"), String(UI_PANEL_OPACITY_MIN));
  assert.equal(attribute("max"), String(UI_PANEL_OPACITY_MAX));
  assert.equal(attribute("step"), "1");
});
