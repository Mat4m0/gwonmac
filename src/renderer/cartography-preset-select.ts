/**
 * Owns the renderer's one encoding and option builder for Cartography preset selects.
 * Library-aware parsing refuses stale custom choices before they reach persistence.
 */
import {
  CARTOGRAPHY_BUILTIN_PRESET_IDS,
  CARTOGRAPHY_BUILTIN_PRESETS,
  isCartographyBuiltinPresetId,
  type CartographyPresetLibrary,
  type CartographyPresetRef,
} from "../shared/cartography-overlay.js";

export function encodeCartographyPresetRef(ref: CartographyPresetRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseCartographyPresetRef(
  value: string,
  library: CartographyPresetLibrary,
): CartographyPresetRef | null {
  if (value.startsWith("builtin:")) {
    const id = value.slice("builtin:".length);
    return isCartographyBuiltinPresetId(id) ? { kind: "builtin", id } : null;
  }
  if (value.startsWith("custom:")) {
    const id = value.slice("custom:".length);
    return library.customPresets.some((preset) => preset.id === id)
      ? { kind: "custom", id }
      : null;
  }
  return null;
}

export function renderCartographyPresetOptions(
  select: HTMLSelectElement,
  library: CartographyPresetLibrary,
): void {
  const document = select.ownerDocument;
  const builtins = document.createElement("optgroup");
  builtins.label = "Built-in";
  for (const id of CARTOGRAPHY_BUILTIN_PRESET_IDS) {
    const option = document.createElement("option");
    option.value = encodeCartographyPresetRef({ kind: "builtin", id });
    option.textContent = CARTOGRAPHY_BUILTIN_PRESETS[id].name;
    builtins.append(option);
  }

  const groups: HTMLOptGroupElement[] = [builtins];
  if (library.customPresets.length > 0) {
    const custom = document.createElement("optgroup");
    custom.label = "My presets";
    for (const preset of library.customPresets) {
      const option = document.createElement("option");
      option.value = encodeCartographyPresetRef({ kind: "custom", id: preset.id });
      option.textContent = preset.name;
      custom.append(option);
    }
    groups.push(custom);
  }
  select.replaceChildren(...groups);
  select.value = encodeCartographyPresetRef(library.activePreset);
}
