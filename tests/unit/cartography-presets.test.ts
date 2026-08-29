import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CARTOGRAPHY_BUILTIN_PRESETS,
  CARTOGRAPHY_CUSTOM_PRESETS_MAX,
  DEFAULT_CARTOGRAPHY_PRESET_LIBRARY,
  type CartographyPresetLibrary,
} from "../../src/shared/cartography-overlay.js";
import {
  addCartographyPreset,
  deleteCartographyPreset,
  renameCartographyPreset,
  replaceCartographyPresetStyle,
  resolveCartographyPreset,
  selectCartographyPreset,
  uniqueCartographyPresetName,
} from "../../src/shared/cartography-presets.js";

const cartographer = CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style;
const synthwave = CARTOGRAPHY_BUILTIN_PRESETS.synthwave.style;

function add(
  library: CartographyPresetLibrary,
  id: string,
  name: string,
  style = cartographer,
): CartographyPresetLibrary {
  const result = addCartographyPreset(library, { id, name, style });
  assert.ok(result);
  return result;
}

function fullLibrary(): CartographyPresetLibrary {
  let library = DEFAULT_CARTOGRAPHY_PRESET_LIBRARY;
  for (let index = 0; index < CARTOGRAPHY_CUSTOM_PRESETS_MAX; index += 1) {
    library = add(library, `preset-${index}`, `Preset ${index}`);
  }
  return library;
}

describe("Cartography preset domain", () => {
  it("resolves canonical built-in and custom references without a hidden fallback", () => {
    assert.equal(resolveCartographyPreset(DEFAULT_CARTOGRAPHY_PRESET_LIBRARY), cartographer);
    const library = add(DEFAULT_CARTOGRAPHY_PRESET_LIBRARY, "night", "Night", synthwave);
    assert.deepEqual(resolveCartographyPreset(library), synthwave);

    const dangling = {
      activePreset: { kind: "custom", id: "missing" },
      customPresets: [],
    } as unknown as CartographyPresetLibrary;
    assert.equal(resolveCartographyPreset(dangling), null);
  });

  it("selects only existing semantic references", () => {
    const library = add(DEFAULT_CARTOGRAPHY_PRESET_LIBRARY, "night", "Night");
    const builtIn = selectCartographyPreset(library, { kind: "builtin", id: "monochrome" });
    assert.equal(builtIn?.activePreset.kind, "builtin");
    assert.equal(builtIn?.activePreset.id, "monochrome");
    const custom = selectCartographyPreset(library, { kind: "custom", id: "night" });
    assert.deepEqual(custom?.activePreset, { kind: "custom", id: "night" });
    assert.equal(selectCartographyPreset(library, { kind: "custom", id: "missing" }), null);
  });

  it("adds and activates a normalized preset while resolving name collisions", () => {
    const first = add(DEFAULT_CARTOGRAPHY_PRESET_LIBRARY, "night", "Night route");
    const second = addCartographyPreset(first, {
      id: "night-two",
      name: " night ROUTE ",
      style: structuredClone(synthwave),
    });
    assert.ok(second);
    assert.deepEqual(second.activePreset, { kind: "custom", id: "night-two" });
    assert.equal(second.customPresets[1]?.name, "night ROUTE 2");
    assert.equal(second.customPresets[1]?.style.walkability.veilColor, "#080516");
    assert.equal(Object.isFrozen(second), true);
    assert.equal(Object.isFrozen(second.activePreset), true);
    assert.equal(Object.isFrozen(second.customPresets), true);
    assert.equal(Object.isFrozen(second.customPresets[1]), true);
    assert.equal(Object.isFrozen(second.customPresets[1]?.style.grid.unseen), true);
  });

  it("rejects duplicate ids, invalid imported styles, and additions beyond capacity", () => {
    const library = add(DEFAULT_CARTOGRAPHY_PRESET_LIBRARY, "night", "Night");
    assert.equal(addCartographyPreset(library, { id: "night", name: "Other", style: synthwave }), null);
    const invalidStyle = {
      ...synthwave,
      grid: { ...synthwave.grid, lattice: { ...synthwave.grid.lattice, width: 99 } },
    } as typeof synthwave;
    assert.equal(addCartographyPreset(library, {
      id: "invalid", name: "Invalid", style: invalidStyle,
    }), null);
    assert.equal(addCartographyPreset(fullLibrary(), {
      id: "overflow", name: "Overflow", style: synthwave,
    }), null);
  });

  it("renames uniquely and replaces only existing custom preset styles", () => {
    const first = add(DEFAULT_CARTOGRAPHY_PRESET_LIBRARY, "first", "First");
    const library = add(first, "second", "Second");
    const renamed = renameCartographyPreset(library, "second", " first ");
    assert.equal(renamed?.customPresets[1]?.name, "first 2");
    assert.equal(renameCartographyPreset(library, "missing", "Name"), null);
    assert.equal(uniqueCartographyPresetName("Second", library, "second"), "Second");

    const replaced = replaceCartographyPresetStyle(library, "first", synthwave);
    assert.deepEqual(replaced?.customPresets[0]?.style, synthwave);
    assert.equal(replaceCartographyPresetStyle(library, "missing", synthwave), null);
    const invalidStyle = {
      ...synthwave,
      walkability: { ...synthwave.walkability, boundaryColor: "red" },
    } as unknown as typeof synthwave;
    assert.equal(replaceCartographyPresetStyle(library, "first", invalidStyle), null);
  });

  it("deletes atomically and falls back only when the active custom preset is deleted", () => {
    const first = add(DEFAULT_CARTOGRAPHY_PRESET_LIBRARY, "first", "First");
    const library = add(first, "second", "Second");
    const deletedInactive = deleteCartographyPreset(library, "first");
    assert.deepEqual(deletedInactive?.activePreset, { kind: "custom", id: "second" });
    assert.deepEqual(deletedInactive?.customPresets.map(({ id }) => id), ["second"]);

    const deletedActive = deleteCartographyPreset(library, "second");
    assert.deepEqual(deletedActive?.activePreset, { kind: "builtin", id: "cartographer" });
    assert.deepEqual(deletedActive?.customPresets.map(({ id }) => id), ["first"]);
    assert.equal(deleteCartographyPreset(library, "missing"), null);
  });

  it("fails every transition closed when the source library is invalid", () => {
    const invalid = {
      activePreset: { kind: "custom", id: "missing" },
      customPresets: [],
    } as unknown as CartographyPresetLibrary;
    assert.equal(uniqueCartographyPresetName("Name", invalid), null);
    assert.equal(selectCartographyPreset(invalid, { kind: "builtin", id: "cartographer" }), null);
    assert.equal(addCartographyPreset(invalid, { id: "new", name: "New", style: cartographer }), null);
    assert.equal(renameCartographyPreset(invalid, "missing", "New"), null);
    assert.equal(deleteCartographyPreset(invalid, "missing"), null);
    assert.equal(replaceCartographyPresetStyle(invalid, "missing", cartographer), null);
  });
});
