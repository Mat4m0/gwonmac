/**
 * Owns pure state transitions for the player-owned Cartography preset library.
 * Persistence validates the complete library once; typed UI transitions then
 * validate only new input and preserve the canonical frozen structure.
 */
import {
  CARTOGRAPHY_BUILTIN_PRESETS,
  CARTOGRAPHY_CUSTOM_PRESET_ID_MAX,
  CARTOGRAPHY_CUSTOM_PRESET_NAME_MAX,
  CARTOGRAPHY_CUSTOM_PRESETS_MAX,
  normaliseCartographyPresetRef,
  normaliseCartographyPresetStyle,
  type CartographyCustomPreset,
  type CartographyPresetLibrary,
  type CartographyPresetRef,
  type CartographyPresetStyle,
} from "./cartography-overlay.js";

const CARTOGRAPHER: CartographyPresetRef = Object.freeze({
  kind: "builtin",
  id: "cartographer",
});

const CUSTOM_PRESET_ID = /^[a-z0-9][a-z0-9_-]*$/iu;

function sourceIsCanonical(library: CartographyPresetLibrary): boolean {
  return resolveCartographyPreset(library) !== null;
}

function frozenLibrary(
  activePreset: CartographyPresetRef,
  customPresets: readonly CartographyCustomPreset[],
): CartographyPresetLibrary {
  return Object.freeze({
    activePreset: Object.isFrozen(activePreset)
      ? activePreset
      : Object.freeze({ ...activePreset }),
    customPresets: Object.freeze([...customPresets]),
  });
}

export type ResolvedCartographyPreset = Readonly<{
  name: string;
  style: CartographyPresetStyle;
  custom: CartographyCustomPreset | null;
}>;

export function resolveCartographyPresetEntry(
  library: CartographyPresetLibrary,
): ResolvedCartographyPreset | null {
  if (library.activePreset.kind === "builtin") {
    const preset = CARTOGRAPHY_BUILTIN_PRESETS[library.activePreset.id];
    return preset === undefined ? null : { ...preset, custom: null };
  }
  const custom = library.customPresets.find(({ id }) => id === library.activePreset.id) ?? null;
  return custom === null ? null : { name: custom.name, style: custom.style, custom };
}

export function resolveCartographyPreset(
  library: CartographyPresetLibrary,
): CartographyPresetStyle | null {
  if (library.activePreset.kind === "builtin") {
    return CARTOGRAPHY_BUILTIN_PRESETS[library.activePreset.id]?.style ?? null;
  }
  return library.customPresets.find(({ id }) => id === library.activePreset.id)?.style ?? null;
}

export function uniqueCartographyPresetName(
  requested: string,
  library: CartographyPresetLibrary,
  excludingCustomPresetId?: string,
): string | null {
  if (!sourceIsCanonical(library)) return null;
  const base = (requested.trim() || "My preset").slice(0, CARTOGRAPHY_CUSTOM_PRESET_NAME_MAX);
  const used = new Set([
    ...Object.values(CARTOGRAPHY_BUILTIN_PRESETS)
      .map(({ name }) => name.toLocaleLowerCase("en-US")),
    ...library.customPresets
      .filter(({ id }) => id !== excludingCustomPresetId)
      .map(({ name }) => name.toLocaleLowerCase("en-US")),
  ]);
  if (!used.has(base.toLocaleLowerCase("en-US"))) return base;

  // There are at most 67 occupied names (three built-ins plus 64 customs), so
  // this bounded range must contain a free suffix.
  for (let suffix = 2; suffix <= CARTOGRAPHY_CUSTOM_PRESETS_MAX + 4; suffix += 1) {
    const ending = ` ${suffix}`;
    const candidate = `${base.slice(0, CARTOGRAPHY_CUSTOM_PRESET_NAME_MAX - ending.length)}${ending}`;
    if (!used.has(candidate.toLocaleLowerCase("en-US"))) return candidate;
  }
  return null;
}

export function selectCartographyPreset(
  library: CartographyPresetLibrary,
  activePreset: CartographyPresetRef,
): CartographyPresetLibrary | null {
  if (!sourceIsCanonical(library)) return null;
  const active = normaliseCartographyPresetRef(activePreset);
  if (active === null || active.kind === "custom"
    && !library.customPresets.some(({ id }) => id === active.id)) return null;
  return frozenLibrary(active, library.customPresets);
}

export function addCartographyPreset(
  library: CartographyPresetLibrary,
  preset: CartographyCustomPreset,
): CartographyPresetLibrary | null {
  if (!sourceIsCanonical(library)
    || library.customPresets.length >= CARTOGRAPHY_CUSTOM_PRESETS_MAX
    || preset.id.length > CARTOGRAPHY_CUSTOM_PRESET_ID_MAX
    || !CUSTOM_PRESET_ID.test(preset.id)
    || library.customPresets.some(({ id }) => id === preset.id)) return null;
  const name = uniqueCartographyPresetName(preset.name, library);
  const style = normaliseCartographyPresetStyle(preset.style);
  if (name === null || style === null) return null;
  const custom = Object.freeze({ id: preset.id, name, style });
  return frozenLibrary(
    Object.freeze({ kind: "custom", id: preset.id }),
    [...library.customPresets, custom],
  );
}

export function renameCartographyPreset(
  library: CartographyPresetLibrary,
  presetId: string,
  requestedName: string,
): CartographyPresetLibrary | null {
  if (!sourceIsCanonical(library)
    || !library.customPresets.some(({ id }) => id === presetId)) return null;
  const name = uniqueCartographyPresetName(requestedName, library, presetId);
  if (name === null) return null;
  return frozenLibrary(library.activePreset, library.customPresets.map((preset) => preset.id === presetId
    ? Object.freeze({ ...preset, name })
    : preset));
}

export function deleteCartographyPreset(
  library: CartographyPresetLibrary,
  presetId: string,
): CartographyPresetLibrary | null {
  if (!sourceIsCanonical(library)
    || !library.customPresets.some(({ id }) => id === presetId)) return null;
  const deletingActive = library.activePreset.kind === "custom"
    && library.activePreset.id === presetId;
  return frozenLibrary(
    deletingActive ? CARTOGRAPHER : library.activePreset,
    library.customPresets.filter(({ id }) => id !== presetId),
  );
}

export function replaceCartographyPresetStyle(
  library: CartographyPresetLibrary,
  presetId: string,
  style: CartographyPresetStyle,
): CartographyPresetLibrary | null {
  if (!sourceIsCanonical(library)
    || !library.customPresets.some(({ id }) => id === presetId)) return null;
  const canonicalStyle = normaliseCartographyPresetStyle(style);
  if (canonicalStyle === null) return null;
  return frozenLibrary(library.activePreset, library.customPresets.map((preset) => preset.id === presetId
    ? Object.freeze({ ...preset, style: canonicalStyle })
    : preset));
}
