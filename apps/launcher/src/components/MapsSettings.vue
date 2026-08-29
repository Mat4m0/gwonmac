<script setup lang="ts">
import { computed, ref } from "vue";
import type { LauncherSettings, LauncherSettingsPatch } from "@shared/launcher-contracts";
import {
  CARTOGRAPHY_BUILTIN_PRESETS,
  CARTOGRAPHY_LINE_PATTERNS,
  CARTOGRAPHY_UNSEEN_MARKERS,
  decodeCartographyPreset,
  encodeCartographyPreset,
  type CartographyGridStyle,
  type CartographyLineStyle,
  type CartographyPresetStyle,
  type CartographyWalkabilityStyle,
} from "@shared/cartography-overlay";
import {
  addCartographyPreset,
  deleteCartographyPreset,
  renameCartographyPreset,
  replaceCartographyPresetStyle,
  resolveCartographyPresetEntry,
  selectCartographyPreset,
} from "@shared/cartography-presets";

const props = defineProps<{
  settings: LauncherSettings;
  save: (patch: LauncherSettingsPatch) => Promise<void>;
}>();

const status = ref("");
const importValue = ref("");
const editing = ref(false);
const active = computed(() => resolveCartographyPresetEntry(props.settings.cartographyPresetLibrary));
const exportValue = computed(() => active.value ? encodeCartographyPreset({ name: active.value.name, style: active.value.style }) : "");
const lineLabels = {
  lattice: "Grid lines",
  current: "Current cell",
  hover: "Hovered cell",
  normalRange: "3×3 range",
  birdsEyeRange: "7×7 range",
} as const;

async function persist(patch: LauncherSettingsPatch, message = "Saved.") {
  status.value = "Saving…";
  await props.save(patch);
  status.value = message;
}

async function selectPreset(value: string) {
  const [kind, id] = value.split(":");
  const next = selectCartographyPreset(
    props.settings.cartographyPresetLibrary,
    kind === "builtin" ? { kind, id: id as keyof typeof CARTOGRAPHY_BUILTIN_PRESETS } : { kind: "custom", id: id ?? "" },
  );
  if (next) await persist({ cartographyPresetLibrary: next }, "Style selected.");
}

async function customize() {
  const source = active.value;
  if (!source) return;
  if (source.custom) {
    editing.value = true;
    return;
  }
  const next = addCartographyPreset(props.settings.cartographyPresetLibrary, {
    id: `preset-${crypto.randomUUID()}`,
    name: `${source.name} custom`,
    style: source.style,
  });
  if (!next) return;
  editing.value = true;
  await persist({ cartographyPresetLibrary: next }, "Custom style created.");
}

async function rename(value: string) {
  const current = active.value?.custom;
  if (!current) return;
  const next = renameCartographyPreset(props.settings.cartographyPresetLibrary, current.id, value);
  if (next) await persist({ cartographyPresetLibrary: next }, "Style renamed.");
}

async function remove() {
  const current = active.value?.custom;
  if (!current) return;
  const next = deleteCartographyPreset(props.settings.cartographyPresetLibrary, current.id);
  if (!next) return;
  editing.value = false;
  await persist({ cartographyPresetLibrary: next }, "Custom style deleted.");
}

async function importPreset() {
  const imported = decodeCartographyPreset(importValue.value);
  if (!imported) {
    status.value = "That style text is not valid.";
    return;
  }
  const next = addCartographyPreset(props.settings.cartographyPresetLibrary, {
    id: `preset-${crypto.randomUUID()}`,
    ...imported,
  });
  if (!next) {
    status.value = "The style could not be added.";
    return;
  }
  importValue.value = "";
  await persist({ cartographyPresetLibrary: next }, "Style imported.");
}

async function saveStyle(style: CartographyPresetStyle) {
  const current = active.value?.custom;
  if (!current) return;
  const next = replaceCartographyPresetStyle(props.settings.cartographyPresetLibrary, current.id, style);
  if (next) await persist({ cartographyPresetLibrary: next });
}

function lineValue(key: keyof typeof lineLabels): CartographyLineStyle | undefined {
  return active.value?.style.grid[key];
}

async function updateLine(
  key: keyof typeof lineLabels,
  field: keyof CartographyLineStyle,
  value: string,
) {
  const source = active.value?.style;
  const line = source?.grid[key];
  if (!source || !line) return;
  const nextLine = {
    ...line,
    [field]: field === "width" ? Number(value) : value,
  } as CartographyLineStyle;
  await saveStyle({ ...source, grid: { ...source.grid, [key]: nextLine } });
}

async function updateWalkability(field: keyof CartographyWalkabilityStyle, value: string) {
  const source = active.value?.style;
  if (!source) return;
  await saveStyle({
    ...source,
    walkability: {
      ...source.walkability,
      [field]: field === "boundaryWidth" ? Number(value) : value,
    } as CartographyWalkabilityStyle,
  });
}

async function updateGrid(field: "casingColor", value: string) {
  const source = active.value?.style;
  if (source) await saveStyle({ ...source, grid: { ...source.grid, [field]: value } as CartographyGridStyle });
}

async function updateUnseen(field: "color" | "marker", value: string) {
  const source = active.value?.style;
  if (!source) return;
  await saveStyle({ ...source, grid: { ...source.grid, unseen: { ...source.grid.unseen, [field]: value } } as CartographyGridStyle });
}
</script>

<template>
  <h1>Maps</h1>
  <p>Optional guidance on the native Compass and Mission Map. These settings apply to every account.</p>
  <div class="setting-group">
    <label><span><strong>Exploration grid</strong><small>Show the game’s fixed exploration cells.</small></span><input type="checkbox" :checked="settings.cartographyGridEnabled" @change="persist({ cartographyGridEnabled: ($event.currentTarget as HTMLInputElement).checked })" /></label>
    <label><span><strong>Walkable terrain</strong><small>Shade terrain outside certified pathing geometry.</small></span><input type="checkbox" :checked="settings.cartographyOverlayEnabled" @change="persist({ cartographyOverlayEnabled: ($event.currentTarget as HTMLInputElement).checked })" /></label>
    <label><span><strong>Style</strong><small>Used by both map layers.</small></span><select :value="`${settings.cartographyPresetLibrary.activePreset.kind}:${settings.cartographyPresetLibrary.activePreset.id}`" @change="selectPreset(($event.currentTarget as HTMLSelectElement).value)"><optgroup label="Built in"><option v-for="(preset, id) in CARTOGRAPHY_BUILTIN_PRESETS" :key="id" :value="`builtin:${id}`">{{ preset.name }}</option></optgroup><optgroup v-if="settings.cartographyPresetLibrary.customPresets.length" label="My styles"><option v-for="preset in settings.cartographyPresetLibrary.customPresets" :key="preset.id" :value="`custom:${preset.id}`">{{ preset.name }}</option></optgroup></select></label>
    <label><span><strong>Grid opacity</strong><small>{{ settings.cartographyGridOpacity }}%</small></span><input type="range" min="0" max="100" :value="settings.cartographyGridOpacity" @change="persist({ cartographyGridOpacity: Number(($event.currentTarget as HTMLInputElement).value) })" /></label>
    <label><span><strong>Walkable terrain opacity</strong><small>{{ settings.cartographyWalkabilityOpacity }}%</small></span><input type="range" min="0" max="100" :value="settings.cartographyWalkabilityOpacity" @change="persist({ cartographyWalkabilityOpacity: Number(($event.currentTarget as HTMLInputElement).value) })" /></label>
    <label><span><strong>Compass control visibility</strong><small>{{ settings.cartographyControlIdleOpacity }}%</small></span><input type="range" min="15" max="100" :value="settings.cartographyControlIdleOpacity" @change="persist({ cartographyControlIdleOpacity: Number(($event.currentTarget as HTMLInputElement).value) })" /></label>
    <label><span><strong>Compass inspection range</strong><small>Mission Map inspection still uses Shift.</small></span><select :value="settings.cartographyRevealMode" @change="persist({ cartographyRevealMode: ($event.currentTarget as HTMLSelectElement).value as LauncherSettings['cartographyRevealMode'] })"><option value="off">Off</option><option value="normal">Normal · 3×3</option><option value="birds-eye">Bird’s Eye · 7×7</option></select></label>
  </div>

  <div class="setting-group map-style-actions">
    <div class="setting-row"><span><strong>{{ active?.name ?? 'Map style' }}</strong><small>{{ active?.custom ? 'Custom style' : 'Built-in style' }}</small></span><button class="secondary" @click="customize">{{ active?.custom ? 'Edit style' : 'Customize style' }}</button></div>
    <template v-if="active?.custom">
      <label><span><strong>Style name</strong></span><input :value="active.name" maxlength="40" @change="rename(($event.currentTarget as HTMLInputElement).value)" /></label>
      <button class="text-link" @click="remove">Delete custom style</button>
    </template>
    <details><summary>Import or share a style</summary><label>Style text<textarea rows="4" :value="importValue || exportValue" @input="importValue = ($event.currentTarget as HTMLTextAreaElement).value" /></label><button class="secondary" :disabled="!importValue" @click="importPreset">Import as new style</button><p>Select the text and press Command-C to share the current style. Paste another style here to import it.</p></details>
  </div>

  <div v-if="editing && active?.custom" class="setting-group map-style-editor">
    <div class="setting-row"><span><strong>Edit {{ active.name }}</strong><small>Changes save automatically.</small></span><button class="secondary" @click="editing = false">Done</button></div>
    <h2>Walkable terrain</h2>
    <label><span>Veil color</span><input type="color" :value="active.style.walkability.veilColor" @change="updateWalkability('veilColor', ($event.currentTarget as HTMLInputElement).value)" /></label>
    <label><span>Boundary color</span><input type="color" :value="active.style.walkability.boundaryColor" @change="updateWalkability('boundaryColor', ($event.currentTarget as HTMLInputElement).value)" /></label>
    <label><span>Boundary casing</span><input type="color" :value="active.style.walkability.boundaryCasingColor" @change="updateWalkability('boundaryCasingColor', ($event.currentTarget as HTMLInputElement).value)" /></label>
    <label><span>Boundary width</span><input type="range" min="0" max="4" :value="active.style.walkability.boundaryWidth" @change="updateWalkability('boundaryWidth', ($event.currentTarget as HTMLInputElement).value)" /></label>
    <h2>Grid</h2>
    <label><span>Grid casing</span><input type="color" :value="active.style.grid.casingColor" @change="updateGrid('casingColor', ($event.currentTarget as HTMLInputElement).value)" /></label>
    <label><span>Unseen cells</span><input type="color" :value="active.style.grid.unseen.color" @change="updateUnseen('color', ($event.currentTarget as HTMLInputElement).value)" /><select :value="active.style.grid.unseen.marker" @change="updateUnseen('marker', ($event.currentTarget as HTMLSelectElement).value)"><option v-for="marker in CARTOGRAPHY_UNSEEN_MARKERS" :key="marker" :value="marker">{{ marker }}</option></select></label>
    <fieldset v-for="(label, key) in lineLabels" :key="key" class="map-line-editor"><legend>{{ label }}</legend><input type="color" :aria-label="`${label} color`" :value="lineValue(key)?.color" @change="updateLine(key, 'color', ($event.currentTarget as HTMLInputElement).value)" /><label>Width<input type="range" min="0" max="4" :value="lineValue(key)?.width" @change="updateLine(key, 'width', ($event.currentTarget as HTMLInputElement).value)" /></label><select :aria-label="`${label} pattern`" :value="lineValue(key)?.pattern" @change="updateLine(key, 'pattern', ($event.currentTarget as HTMLSelectElement).value)"><option v-for="pattern in CARTOGRAPHY_LINE_PATTERNS" :key="pattern" :value="pattern">{{ pattern }}</option></select></fieldset>
  </div>
  <p v-if="status" class="inline-message" role="status" aria-live="polite">{{ status }}</p>
</template>
