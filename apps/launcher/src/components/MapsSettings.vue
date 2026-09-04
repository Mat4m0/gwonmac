<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { LauncherNativeApi, LauncherSettings, LauncherSettingsPatch, LauncherSnapshot } from "@shared/launcher-contracts";
import ShortcutSetting from "./ShortcutSetting.vue";
import ColorControl from "./ColorControl.vue";
import RangeControl from "./RangeControl.vue";
import MapStylePreview from "./MapStylePreview.vue";
import BaseModal from "./BaseModal.vue";
import {
  COMPASS_RANGE_INDICATORS,
  COMPASS_RANGE_THEMES,
  type CompassRange,
  type CompassRangeTheme,
} from "@shared/compass-ranges";
import {
  CARTOGRAPHY_BUILTIN_PRESETS,
  isCartographyBuiltinPresetId,
  type CartographyColor,
  type CartographyLinePattern,
  type CartographyUnseenMarker,
  CARTOGRAPHY_LINE_PATTERNS,
  CARTOGRAPHY_UNSEEN_MARKERS,
  decodeCartographyPreset,
  encodeCartographyPreset,
  type CartographyLineStyle,
  type CartographyPresetStyle,
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
  shortcuts?: LauncherSnapshot["shortcuts"];
  api?: LauncherNativeApi["tools"] | undefined;
  save: (patch: LauncherSettingsPatch) => Promise<void>;
  tools?: LauncherSnapshot["tools"];
  performSave?: ((action: () => Promise<unknown>) => Promise<void>) | undefined;
}>();
const emit = defineEmits<{ tools: [] }>();

const status = ref("");
const importValue = ref("");
const editing = ref(false);
const styleEditor = ref<HTMLElement | null>(null);
const customizeButton = ref<HTMLButtonElement | null>(null);
async function revealEditor() {
  await nextTick();
  styleEditor.value?.scrollIntoView({ block: "start" });
  styleEditor.value?.focus({ preventScroll: true });
}
async function closeEditor() {
  editing.value = false;
  await nextTick();
  customizeButton.value?.scrollIntoView({ block: "nearest" });
  customizeButton.value?.focus({ preventScroll: true });
}
const confirmDelete = ref(false);
const active = computed(() => resolveCartographyPresetEntry(props.settings.cartographyPresetLibrary));
const exportValue = computed(() => active.value ? encodeCartographyPreset({ name: active.value.name, style: active.value.style }) : "");
const lineLabels = {
  lattice: "Grid lines",
  current: "Current cell",
  hover: "Hovered cell",
  normalRange: "3×3 range",
  birdsEyeRange: "7×7 range",
} as const;

async function persist(patch: LauncherSettingsPatch) {
  status.value = "";
  try {
    await props.save(patch);
    return true;
  } catch { status.value = "The map setting could not be saved. Try again."; return false; }
}

async function setRangeEnabled(range: CompassRange, enabled: boolean) {
  await persist({ [range.enabledSetting]: enabled });
}

async function setRangeOpacity(range: CompassRange, opacity: number) {
  await persist({ [range.opacitySetting]: opacity });
}

async function selectPreset(value: string) {
  const [kind, id] = value.split(":");
  if (kind !== "builtin" && kind !== "custom") return;
  if (kind === "builtin" && !isCartographyBuiltinPresetId(id)) return;
  const next = selectCartographyPreset(
    props.settings.cartographyPresetLibrary,
    kind === "builtin" && isCartographyBuiltinPresetId(id) ? { kind, id } : { kind: "custom", id: id ?? "" },
  );
  if (next) await persist({ cartographyPresetLibrary: next });
}

async function customize() {
  const source = active.value;
  if (!source) return;
  if (source.custom) {
    editing.value = true;
    await revealEditor();
    return;
  }
  const next = addCartographyPreset(props.settings.cartographyPresetLibrary, {
    id: `preset-${crypto.randomUUID()}`,
    name: `${source.name} custom`,
    style: source.style,
  });
  if (!next) { status.value = "The custom style limit has been reached. Delete an unused style first."; return; }
  if (await persist({ cartographyPresetLibrary: next })) {
    editing.value = true;
    await revealEditor();
  }
}

async function rename(value: string) {
  const current = active.value?.custom;
  if (!current) return;
  const next = renameCartographyPreset(props.settings.cartographyPresetLibrary, current.id, value);
  if (next) await persist({ cartographyPresetLibrary: next });
  else status.value = "Enter a style name from 1 to 40 characters.";
}

async function remove() {
  const current = active.value?.custom;
  if (!current) return;
  const next = deleteCartographyPreset(props.settings.cartographyPresetLibrary, current.id);
  if (!next) return;
  editing.value = false;
  await persist({ cartographyPresetLibrary: next });
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
  if (await persist({ cartographyPresetLibrary: next })) importValue.value = "";
}

async function saveStyle(style: CartographyPresetStyle) {
  const source = active.value;
  if (!source) return;
  const next = source.custom
    ? replaceCartographyPresetStyle(props.settings.cartographyPresetLibrary, source.custom.id, style)
    : addCartographyPreset(props.settings.cartographyPresetLibrary, {
      id: `preset-${crypto.randomUUID()}`,
      name: `${source.name} custom`,
      style,
    });
  if (next) await persist({ cartographyPresetLibrary: next });
  else status.value = "The style could not be changed. Delete an unused custom style and try again.";
}

async function updateLine(key: keyof typeof lineLabels, patch: Partial<CartographyLineStyle>) {
  const source = active.value?.style;
  if (!source) return;
  await saveStyle({ ...source, grid: { ...source.grid, [key]: { ...source.grid[key], ...patch } } });
}

async function updateWalkability(patch: Partial<CartographyPresetStyle["walkability"]>) {
  const source = active.value?.style;
  if (source) await saveStyle({ ...source, walkability: { ...source.walkability, ...patch } });
}

async function updateGrid(value: CartographyColor) {
  const source = active.value?.style;
  if (source) await saveStyle({ ...source, grid: { ...source.grid, casingColor: value } });
}

async function updateUnseen(patch: Partial<CartographyPresetStyle["grid"]["unseen"]>) {
  const source = active.value?.style;
  if (source) await saveStyle({ ...source, grid: { ...source.grid, unseen: { ...source.grid.unseen, ...patch } } });
}
</script>

<template>
  <h1>Maps</h1>
  <p class="section-intro">Layers and styles for every account. Changes save automatically.</p>
  <div v-if="tools" class="feature-availability" role="status">
    <template v-if="!tools.configured || !tools.features.maps.enabled"><span><strong>{{ !tools.configured ? 'Tools are off' : 'Maps are off' }}</strong> · You can edit your preferences here. Enable {{ !tools.configured ? 'Tools and Maps' : 'Maps' }} to see them in game.</span><button class="secondary" @click="emit('tools')">Open Tools settings</button></template>
    <template v-else-if="!tools.loaded"><span><strong>Restart the launcher to enable Maps</strong> · Your settings are saved. Quit the entire app (⌘Q), including the launcher, then reopen it. Restarting only a game window does not load Tools.</span><button class="secondary" @click="emit('tools')">Open restart options</button></template>
    <span v-else><strong>Maps enabled</strong> · Changes update open game windows. Layers appear in supported PvE areas.</span>
  </div>
  <div class="setting-group map-layers">
    <div class="feature-heading">
      <label for="map-grid"><strong>Exploration grid</strong><small id="map-grid-help">Mission Map and World Map; marks unexplored cells reachable in this instance.</small></label>
      <ShortcutSetting v-if="shortcuts" action="cartography.grid.toggle" :shortcuts="shortcuts" :api="api" :perform-save="performSave" />
      <input id="map-grid" type="checkbox" aria-label="Exploration grid" aria-describedby="map-grid-help" :checked="settings.cartographyGridEnabled" @change="persist({ cartographyGridEnabled: ($event.currentTarget as HTMLInputElement).checked })" />
    </div>
    <label><span><strong>Grid on Compass</strong><small>Also show exploration cells on the Compass. Off by default.</small></span><input type="checkbox" :checked="settings.cartographyCompassGridEnabled" :disabled="!settings.cartographyGridEnabled" @change="persist({ cartographyCompassGridEnabled: ($event.currentTarget as HTMLInputElement).checked })" /></label>
    <label><span><strong>Compass ranges</strong><small>Show Shout, Cast, Spirit, and Ext. Spirit range rings.</small></span><input type="checkbox" aria-label="Compass ranges" :checked="settings.compassRangeIndicatorsEnabled" @change="persist({ compassRangeIndicatorsEnabled: ($event.currentTarget as HTMLInputElement).checked })" /></label>
    <details class="compass-range-settings">
      <summary>Configure Compass ranges</summary>
      <p>Choose each ring and its opacity. These choices remain saved while Compass ranges are off.</p>
      <label class="compass-range-theme"><span><strong>Appearance</strong></span><select aria-label="Compass range appearance" :value="settings.compassRangeTheme" @change="persist({ compassRangeTheme: ($event.currentTarget as HTMLSelectElement).value as CompassRangeTheme })"><option v-for="theme in COMPASS_RANGE_THEMES" :key="theme" :value="theme">{{ theme === 'color' ? 'Color' : 'Monochrome' }}</option></select></label>
      <div v-for="range in COMPASS_RANGE_INDICATORS" :key="range.id" class="setting-row compass-range-setting">
        <label><input type="checkbox" :aria-label="`Show ${range.label} range`" :checked="settings[range.enabledSetting]" @change="setRangeEnabled(range, ($event.currentTarget as HTMLInputElement).checked)" /><strong>{{ range.label }}</strong></label>
        <RangeControl :label="`${range.label} opacity`" :value="settings[range.opacitySetting]" :min="0" :max="100" unit="%" @change="setRangeOpacity(range, $event)" />
      </div>
    </details>
    <div class="feature-heading">
      <label for="map-terrain"><strong>Walkable terrain</strong><small id="map-terrain-help">Shade areas you cannot walk on.</small></label>
      <ShortcutSetting v-if="shortcuts" action="cartography.walkability.toggle" :shortcuts="shortcuts" :api="api" :perform-save="performSave" />
      <input id="map-terrain" type="checkbox" aria-label="Walkable terrain" aria-describedby="map-terrain-help" :checked="settings.cartographyOverlayEnabled" @change="persist({ cartographyOverlayEnabled: ($event.currentTarget as HTMLInputElement).checked })" />
    </div>
  </div>
  <h2 class="settings-subheading">Map appearance</h2>
  <div class="setting-group map-appearance">
    <div class="map-style-choice map-style-actions"><label><span><strong>Style</strong><small>Used by both map layers.</small></span><select :value="`${settings.cartographyPresetLibrary.activePreset.kind}:${settings.cartographyPresetLibrary.activePreset.id}`" @change="selectPreset(($event.currentTarget as HTMLSelectElement).value)"><optgroup label="Built in"><option v-for="(preset, id) in CARTOGRAPHY_BUILTIN_PRESETS" :key="id" :value="`builtin:${id}`">{{ preset.name }}</option></optgroup><optgroup v-if="settings.cartographyPresetLibrary.customPresets.length" label="My styles"><option v-for="preset in settings.cartographyPresetLibrary.customPresets" :key="preset.id" :value="`custom:${preset.id}`">{{ preset.name }}</option></optgroup></select></label><button ref="customizeButton" class="secondary" @click="customize">{{ active?.custom ? 'Edit style' : 'Customize style' }}</button></div>
    <div class="map-appearance-controls">
    <div v-if="active" class="setting-row"><span><strong>Terrain border thickness</strong><small>0 hides the border. Changing a built-in style saves a custom copy.</small></span><RangeControl label="Terrain border thickness" :value="active.style.walkability.boundaryWidth" :min="0" :max="4" unit="px" @change="updateWalkability({ boundaryWidth: $event })" /></div>
    <div class="setting-row"><span><strong>Grid opacity</strong></span><RangeControl label="Grid opacity" :value="settings.cartographyGridOpacity" :min="0" :max="100" unit="%" @change="persist({ cartographyGridOpacity: $event })" /></div>
    <div class="setting-row"><span><strong>Walkable terrain opacity</strong></span><RangeControl label="Walkable terrain opacity" :value="settings.cartographyWalkabilityOpacity" :min="0" :max="100" unit="%" @change="persist({ cartographyWalkabilityOpacity: $event })" /></div>
    </div>
    <MapStylePreview v-if="active" :style="active.style" :grid-opacity="settings.cartographyGridOpacity" :terrain-opacity="settings.cartographyWalkabilityOpacity" />
  </div>
  <div v-if="editing && active?.custom" ref="styleEditor" class="setting-group map-style-editor" tabindex="-1" role="region" :aria-label="`Edit ${active.name}`">
    <div class="setting-row"><span><strong>Edit {{ active.name }}</strong><small>Changes save automatically.</small></span><button class="secondary" @click="closeEditor">Done</button></div>
    <h2>Walkable terrain</h2>
    <div class="setting-row"><span>Shaded area color</span><ColorControl label="Shaded area color" :value="active.style.walkability.veilColor" @change="updateWalkability({ veilColor: $event })" /></div>
    <div class="setting-row"><span>Terrain border color</span><ColorControl label="Terrain border color" :value="active.style.walkability.boundaryColor" @change="updateWalkability({ boundaryColor: $event })" /></div>
    <div class="setting-row"><span>Border outline color</span><ColorControl label="Border outline color" :value="active.style.walkability.boundaryCasingColor" @change="updateWalkability({ boundaryCasingColor: $event })" /></div>
    <h2>Grid</h2>
    <div class="setting-row"><span>Grid outline color</span><ColorControl label="Grid outline color" :value="active.style.grid.casingColor" @change="updateGrid" /></div>
    <div class="setting-row"><span>Unseen cell color</span><ColorControl label="Unseen cell color" :value="active.style.grid.unseen.color" @change="updateUnseen({ color: $event })" /></div>
    <label><span>Unseen cell marker</span><select :value="active.style.grid.unseen.marker" @change="updateUnseen({ marker: ($event.currentTarget as HTMLSelectElement).value as CartographyUnseenMarker })"><option v-for="marker in CARTOGRAPHY_UNSEEN_MARKERS" :key="marker" :value="marker">{{ marker }}</option></select></label>
    <details class="advanced-map-lines"><summary>Advanced grid lines</summary>
    <fieldset v-for="(label, key) in lineLabels" :key="key" class="map-line-editor">
      <legend>{{ label }}</legend>
      <div class="setting-row"><span>Color</span><ColorControl :label="`${label} color`" :value="active.style.grid[key].color" @change="updateLine(key, { color: $event })" /></div>
      <div class="setting-row"><span>Width</span><RangeControl :label="`${label} width`" :value="active.style.grid[key].width" :min="0" :max="4" unit="px" @change="updateLine(key, { width: $event })" /></div>
      <label class="setting-row"><span>Pattern</span><select :aria-label="`${label} pattern`" :value="active.style.grid[key].pattern" @change="updateLine(key, { pattern: ($event.currentTarget as HTMLSelectElement).value as CartographyLinePattern })"><option v-for="pattern in CARTOGRAPHY_LINE_PATTERNS" :key="pattern" :value="pattern">{{ pattern }}</option></select></label>
    </fieldset>
    </details>
  </div>
  <details class="setting-group compass-options"><summary>Compass controls and inspection</summary>
    <div class="setting-row"><span><strong>Compass control visibility</strong><small>Visibility while the control is idle.</small></span><RangeControl label="Compass control visibility" :value="settings.cartographyControlIdleOpacity" :min="15" :max="100" unit="%" @change="persist({ cartographyControlIdleOpacity: $event })" /></div>
    <label><span><strong>Compass inspection range</strong><small>Mission Map inspection still uses Shift.</small></span><select :value="settings.cartographyRevealMode" @change="persist({ cartographyRevealMode: ($event.currentTarget as HTMLSelectElement).value as LauncherSettings['cartographyRevealMode'] })"><option value="off">Off</option><option value="normal">Normal · 3×3</option><option value="birds-eye">Bird’s Eye · 7×7</option></select></label>
  </details>

  <div class="setting-group map-library">
    <template v-if="active?.custom">
      <label><span><strong>Style name</strong></span><input :value="active.name" maxlength="40" @change="rename(($event.currentTarget as HTMLInputElement).value)" /></label>
      <button class="text-link" @click="confirmDelete = true">Delete custom style</button>
    </template>
    <details><summary>Import or share a style</summary><label>Current style<textarea rows="4" :value="exportValue" readonly /></label><p>Select the text and press Command-C to share the current style.</p><label>Import style<textarea v-model="importValue" rows="4" placeholder="Paste style text" /></label><button class="secondary" :disabled="!importValue.trim()" @click="importPreset">Import as new style</button></details>
    <button class="secondary" @click="selectPreset('builtin:cartographer')">Use Cartographer defaults</button>
  </div>

  <p v-if="status" class="inline-message" role="status" aria-live="polite">{{ status }}</p>
  <BaseModal v-if="confirmDelete && active?.custom" labelledby="delete-style-title" @close="confirmDelete = false"><h2 id="delete-style-title">Delete {{ active.name }}?</h2><p>This removes this custom style permanently. Your other styles are kept.</p><div class="form-actions"><button class="secondary" @click="confirmDelete = false">Cancel</button><button class="danger-button" @click="confirmDelete = false; remove()">Delete style</button></div></BaseModal>
</template>

<style scoped>
.setting-group { margin-bottom: 16px; }
.setting-group > label > span { min-width: 140px; flex: 1; }
.compass-options > summary { padding: 12px 0; }
.compass-options > label { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; }
.compass-range-settings > p { margin: 8px 0; color: var(--muted); font-size: 13px; }
.compass-range-theme { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 0 12px; }
.compass-range-setting > label { display: flex; align-items: center; gap: 10px; min-width: 140px; }
</style>
