import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CARTOGRAPHY_BUILTIN_PRESETS,
  type CartographyPresetLibrary,
} from "../../src/shared/cartography-overlay.js";
import {
  encodeCartographyPresetRef,
  parseCartographyPresetRef,
} from "../../src/renderer/cartography-preset-select.js";
import { uniqueCartographyPresetName } from "../../src/shared/cartography-presets.js";
import { createCartographyLibraryWriteGate } from "../../src/renderer/settings-cartography.js";

const library: CartographyPresetLibrary = {
  activePreset: { kind: "builtin", id: "cartographer" },
  customPresets: [{
    id: "mine",
    name: "Night route",
    style: CARTOGRAPHY_BUILTIN_PRESETS.monochrome.style,
  }],
};

test("Cartography preset names avoid built-in and custom collisions", () => {
  assert.equal(uniqueCartographyPresetName("Cartographer", library), "Cartographer 2");
  assert.equal(uniqueCartographyPresetName("night route", library), "night route 2");
  assert.equal(uniqueCartographyPresetName("My route", library), "My route");
});

test("Cartography preset names stay within the persisted limit", () => {
  const result = uniqueCartographyPresetName("Night route".padEnd(80, "x"), library);
  assert.ok(result);
  assert.ok(result.length <= 40);
});

test("Cartography preset select references round-trip only known presets", () => {
  assert.deepEqual(parseCartographyPresetRef("builtin:cartographer", library), {
    kind: "builtin", id: "cartographer",
  });
  assert.deepEqual(parseCartographyPresetRef("custom:mine", library), {
    kind: "custom", id: "mine",
  });
  assert.equal(
    encodeCartographyPresetRef({ kind: "builtin", id: "monochrome" }),
    "builtin:monochrome",
  );
});

test("Cartography preset select references reject stale and malformed values", () => {
  for (const value of [
    "", "cartographer", "builtin:", "builtin:unknown", "custom:", "custom:missing",
    "other:mine", "custom:mine:extra",
  ]) {
    assert.equal(parseCartographyPresetRef(value, library), null, value);
  }
});

test("intermediate Settings renders cannot replace a newer optimistic preset draft", () => {
  const writes = createCartographyLibraryWriteGate();
  const first = writes.begin();
  const second = writes.begin();
  assert.equal(writes.acceptsCanonicalRender(), false);

  writes.finish(first);
  assert.equal(writes.isLatest(first), false);
  assert.equal(writes.acceptsCanonicalRender(), false);

  // A third edit made while the second save is queued must remain newer than
  // both canonical results that the global Settings writer renders in between.
  const third = writes.begin();
  writes.finish(second);
  assert.equal(writes.isLatest(second), false);
  assert.equal(writes.acceptsCanonicalRender(), false);

  assert.equal(writes.isLatest(third), true);
  writes.finish(third);
  assert.equal(writes.acceptsCanonicalRender(), true);
});

test("compact Cartography controls avoid frame-loop layout reads and static inline paint", () => {
  const controls = readFileSync(
    "src/renderer/cartography-spike/overlay-controls.ts",
    "utf8",
  );
  assert.doesNotMatch(controls, /offsetHeight|style\.cssText/u);
  assert.match(controls, /canonical !== settings/u);
  assert.match(controls, /boxChanged \|\| becameVisible/u);
});

test("Cartography settings disclose customization instead of showing a disabled editor", () => {
  const html = readFileSync("src/renderer/settings-cartography.html", "utf8");
  assert.match(html, /data-cartography-preset-action="customize"/u);
  assert.match(html, /data-cartography-customizer hidden/u);
  assert.match(html, /<summary>Manage styles<\/summary>/u);
  assert.match(html, /<summary>Inspection highlights<\/summary>/u);
  assert.doesNotMatch(html, /\sdisabled(?:=|\s|>)/u);
  assert.doesNotMatch(html, /cartographyEditorLayer|settings-cartography-preview/u);
});

test("Cartography customization uses one direct editable path", () => {
  const controller = readFileSync("src/renderer/settings-cartography.ts", "utf8");
  const editor = readFileSync("src/renderer/settings-cartography-editor.ts", "utf8");
  assert.match(controller, /uniqueCartographyPresetName\(`\$\{source\.name\} custom`/u);
  assert.match(controller, /customizer\.hidden = !editable \|\| !editorOpen/u);
  assert.match(controller, /actions\.customize\.focus\(\)/u);
  assert.doesNotMatch(editor, /control\.disabled|data-preset-readonly|showLayer/u);
});
