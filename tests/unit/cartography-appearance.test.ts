import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CARTOGRAPHY_BUILTIN_PRESET_IDS,
  CARTOGRAPHY_BUILTIN_PRESETS,
  CARTOGRAPHY_CUSTOM_PRESETS_MAX,
  CARTOGRAPHY_LINE_PATTERNS,
  CARTOGRAPHY_PRESET_SHARE_MAX_BYTES,
  CARTOGRAPHY_UNSEEN_MARKERS,
  DEFAULT_CARTOGRAPHY_PRESET_LIBRARY,
  decodeCartographyPreset,
  encodeCartographyPreset,
  normaliseCartographyPresetLibrary,
  normaliseCartographyPresetRef,
  normaliseCartographyPresetStyle,
} from "../../src/shared/cartography-overlay.js";
import { resolveCartographyPreset } from "../../src/shared/cartography-presets.js";

describe("cartography appearance", () => {
  it("owns exactly three deeply immutable built-in presets", () => {
    assert.deepEqual(CARTOGRAPHY_BUILTIN_PRESET_IDS, [
      "cartographer", "synthwave", "monochrome",
    ]);
    assert.equal(Object.isFrozen(CARTOGRAPHY_BUILTIN_PRESETS), true);
    for (const id of CARTOGRAPHY_BUILTIN_PRESET_IDS) {
      const { style } = CARTOGRAPHY_BUILTIN_PRESETS[id];
      assert.equal(Object.isFrozen(style), true);
      assert.equal(Object.isFrozen(style.walkability), true);
      assert.equal(Object.isFrozen(style.grid), true);
      assert.equal(Object.isFrozen(style.grid.lattice), true);
      assert.equal(Object.isFrozen(style.grid.unseen), true);
    }
    assert.equal(CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style.grid.lattice.color, "#E8E1D0");
  });

  it("ships a readable Cartographer hierarchy without requiring customization", () => {
    const { grid, walkability } = CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style;
    assert.deepEqual(grid.unseen, { color: "#FF7A1A", marker: "diamond" });
    assert.equal(grid.noWalkableColor, "#8F99A3");
    assert.deepEqual(grid.lattice, { color: "#E8E1D0", width: 2, pattern: "solid" });
    assert.deepEqual(grid.normalRange, { color: "#00D9FF", width: 4, pattern: "solid" });
    assert.deepEqual(grid.birdsEyeRange, {
      color: "#FF4FD8", width: 4, pattern: "dash-dot",
    });
    assert.equal(walkability.boundaryWidth, 3);
  });

  it("exposes every supported line pattern and unseen-cell marker", () => {
    assert.deepEqual(CARTOGRAPHY_LINE_PATTERNS, ["solid", "dashed", "dotted", "dash-dot"]);
    assert.deepEqual(CARTOGRAPHY_UNSEEN_MARKERS, [
      "corners", "cross", "diamond", "stipple", "hatch",
    ]);
    for (const pattern of CARTOGRAPHY_LINE_PATTERNS) {
      const source = CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style;
      const style = {
        ...source,
        grid: { ...source.grid, lattice: { ...source.grid.lattice, pattern } },
      };
      assert.equal(normaliseCartographyPresetStyle(style)?.grid.lattice.pattern, pattern);
    }
    for (const marker of CARTOGRAPHY_UNSEEN_MARKERS) {
      const source = CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style;
      const style = {
        ...source,
        grid: { ...source.grid, unseen: { ...source.grid.unseen, marker } },
      };
      assert.equal(normaliseCartographyPresetStyle(style)?.grid.unseen.marker, marker);
    }
  });

  it("normalises colors and strictly rejects malformed preset styles", () => {
    const source = CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style;
    const style = {
      ...source,
      walkability: { ...source.walkability, veilColor: "#abcdef" },
    };
    assert.equal(normaliseCartographyPresetStyle(style)?.walkability.veilColor, "#ABCDEF");
    assert.equal(normaliseCartographyPresetStyle({ ...style, extra: true }), null);
    assert.equal(normaliseCartographyPresetStyle({
      ...style,
      grid: { ...style.grid, lattice: { ...style.grid.lattice, width: 1.5 } },
    }), null);
    assert.equal(normaliseCartographyPresetStyle({
      ...style,
      grid: { ...style.grid, unseen: { ...style.grid.unseen, marker: "circle" } },
    }), null);
  });

  it("upgrades local presets across revealability guidance previews", () => {
    const source = structuredClone(CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style);
    const legacyGrid = {
      ...source.grid,
      exploredNoWalkableColor: "#FF4FD8",
    } as Record<string, unknown>;
    delete legacyGrid.noWalkableColor;
    const upgraded = normaliseCartographyPresetStyle({ ...source, grid: legacyGrid });
    assert.equal(upgraded?.grid.noWalkableColor, "#8F99A3");
    assert.equal(Object.hasOwn(upgraded?.grid ?? {}, "exploredNoWalkableColor"), false);
  });

  it("normalises one atomic library and resolves built-in and custom refs", () => {
    assert.equal(
      resolveCartographyPreset(DEFAULT_CARTOGRAPHY_PRESET_LIBRARY),
      CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style,
    );
    const customStyle = structuredClone(CARTOGRAPHY_BUILTIN_PRESETS.synthwave.style);
    const library = normaliseCartographyPresetLibrary({
      activePreset: { kind: "custom", id: "night-run" },
      customPresets: [{ id: "night-run", name: "  Night Run  ", style: customStyle }],
    });
    assert.ok(library);
    assert.equal(library.customPresets[0]?.name, "Night Run");
    assert.deepEqual(resolveCartographyPreset(library), customStyle);
  });

  it("rejects duplicate identity, ambiguous names, invalid ids, and dangling refs", () => {
    const style = CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style;
    const preset = { id: "first", name: "First", style };
    const library = (customPresets: unknown[], activePreset: unknown = {
      kind: "builtin", id: "cartographer",
    }) => normaliseCartographyPresetLibrary({ activePreset, customPresets });
    assert.equal(library([preset, { ...preset, name: "Second" }]), null);
    assert.equal(library([preset, { ...preset, id: "second", name: " first " }]), null);
    assert.equal(library([{ ...preset, name: "CARTOGRAPHER" }]), null);
    assert.equal(library([{ ...preset, id: "has spaces" }]), null);
    assert.equal(library([preset], { kind: "custom", id: "missing" }), null);
    assert.equal(library(Array.from(
      { length: CARTOGRAPHY_CUSTOM_PRESETS_MAX + 1 },
      (_, index) => ({ id: `p-${index}`, name: `Preset ${index}`, style }),
    )), null);
  });

  it("normalises semantic preset references without accepting extra or malformed fields", () => {
    const custom = normaliseCartographyPresetRef({ kind: "custom", id: "night-route" });
    assert.deepEqual(custom, { kind: "custom", id: "night-route" });
    assert.equal(Object.isFrozen(custom), true);
    assert.deepEqual(
      normaliseCartographyPresetRef({ kind: "builtin", id: "synthwave" }),
      { kind: "builtin", id: "synthwave" },
    );
    assert.equal(normaliseCartographyPresetRef({ kind: "builtin", id: "missing" }), null);
    assert.equal(normaliseCartographyPresetRef({ kind: "custom", id: "has spaces" }), null);
    assert.equal(normaliseCartographyPresetRef({ kind: "custom", id: "night", extra: true }), null);
  });

  it("round-trips strict versioned clipboard JSON without a local id", () => {
    const shared = {
      name: "Night Run",
      style: CARTOGRAPHY_BUILTIN_PRESETS.synthwave.style,
    };
    const encoded = encodeCartographyPreset(shared);
    const payload = JSON.parse(encoded) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ["format", "name", "style", "version"]);
    assert.equal("id" in payload, false);
    assert.deepEqual(decodeCartographyPreset(encoded), shared);
    assert.equal(decodeCartographyPreset(JSON.stringify({ ...payload, id: "foreign" })), null);
    assert.equal(decodeCartographyPreset(JSON.stringify({ ...payload, version: 2 })), null);
    assert.equal(decodeCartographyPreset("not json"), null);
    assert.equal(
      decodeCartographyPreset("x".repeat(CARTOGRAPHY_PRESET_SHARE_MAX_BYTES + 1)),
      null,
    );
    assert.equal(
      decodeCartographyPreset(`${" ".repeat(CARTOGRAPHY_PRESET_SHARE_MAX_BYTES)}${encoded}`),
      null,
    );
  });
});
