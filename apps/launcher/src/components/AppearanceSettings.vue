<script setup lang="ts">
import { computed, ref } from "vue";
import { UI_FONTS, UI_PANEL_OPACITY_MIN, UI_PANEL_OPACITY_MAX, type UiFont, type UiStyle } from "@shared/contracts";
import type { LauncherSettings, LauncherSettingsPatch } from "@shared/launcher-contracts";
import { UI_THEME_COLOR_FIELDS, decodeCustomUiTheme, encodeCustomUiTheme, defaultCustomUiTheme, type CustomUiTheme, type UiThemeColorField } from "@shared/ui-theme";
import ColorControl from "./ColorControl.vue";
import RangeControl from "./RangeControl.vue";
import PanelStylePreview from "./PanelStylePreview.vue";

const props = defineProps<{ settings: LauncherSettings; save: (patch: LauncherSettingsPatch) => Promise<void> }>();
const message = ref("");
const imported = ref("");
const shared = computed(() => encodeCustomUiTheme(props.settings.uiCustomTheme));
const fonts: Record<UiFont, string> = { "guild-wars": "Guild Wars", inter: "Inter", system: "System", avenir: "Avenir", georgia: "Georgia", palatino: "Palatino" };
const colors: Record<UiThemeColorField, string> = {
  window: "Window background", titlebar: "Title bar", surface: "Panel surface",
  recessed: "Input background", selected: "Selection", accent: "Accent",
  text: "Text", mutedText: "Secondary text", border: "Border",
};
async function persist(patch: LauncherSettingsPatch) {
  try { await props.save(patch); message.value = ""; return true; }
  catch { message.value = "Appearance could not be saved. Try again."; return false; }
}
function updateTheme(patch: Partial<CustomUiTheme>) {
  return persist({ uiCustomTheme: { ...props.settings.uiCustomTheme, ...patch } });
}
async function importTheme() {
  const theme = decodeCustomUiTheme(imported.value);
  if (!theme) { message.value = "That theme text is not valid."; return; }
  if (await persist({ uiStyle: "custom", uiCustomTheme: theme })) imported.value = "";
}
</script>

<template>
  <h2 class="appearance-heading">In-game panels</h2>
  <p>Style, font, and opacity update gwonmac panels in every open game window. Guild Wars menus keep their own appearance.</p>
  <div class="setting-group">
    <label><span><strong>Panel style</strong></span><select :value="settings.uiStyle" @change="persist({ uiStyle: ($event.currentTarget as HTMLSelectElement).value as UiStyle })"><option value="guild-wars">Guild Wars</option><option value="obsidian">Obsidian</option><option value="custom">Custom</option></select></label>
    <label><span><strong>Panel font</strong></span><select :value="settings.uiFont" @change="persist({ uiFont: ($event.currentTarget as HTMLSelectElement).value as UiFont })"><option v-for="font in UI_FONTS" :key="font" :value="font">{{ fonts[font] }}</option></select></label>
    <div class="setting-row"><span><strong>Panel opacity</strong></span><RangeControl label="Panel opacity" :value="settings.uiPanelOpacity" :min="UI_PANEL_OPACITY_MIN" :max="UI_PANEL_OPACITY_MAX" unit="%" @change="persist({ uiPanelOpacity: $event })" /></div>
    <PanelStylePreview :settings="settings" />
    <template v-if="settings.uiStyle === 'custom'">
      <label><span><strong>Panel finish</strong></span><select :value="settings.uiCustomTheme.material" @change="updateTheme({ material: ($event.currentTarget as HTMLSelectElement).value as CustomUiTheme['material'] })"><option value="classic">Classic</option><option value="modern">Modern flat</option></select></label>
      <label><span><strong>Window gradient</strong></span><input type="checkbox" :checked="settings.uiCustomTheme.windowGradient" @change="updateTheme({ windowGradient: ($event.currentTarget as HTMLInputElement).checked })" /></label>
      <div class="setting-row"><span><strong>Custom colors</strong><small>Restore this palette without changing other settings.</small></span><button class="secondary" @click="persist({ uiCustomTheme: defaultCustomUiTheme(settings.uiCustomTheme.material) })">Restore default colors</button></div>
      <div v-for="field in UI_THEME_COLOR_FIELDS" :key="field" class="setting-row"><span>{{ colors[field] }}</span><ColorControl :label="colors[field]" :value="settings.uiCustomTheme[field]" @change="updateTheme({ [field]: $event })" /></div>
      <details class="theme-sharing">
        <summary>Import or share a theme</summary>
        <label>Current theme<textarea :value="shared" readonly rows="3" /></label>
        <p>Select the text and press Command-C to copy it.</p>
        <label>Import theme<textarea v-model="imported" rows="3" placeholder="Paste theme text" /></label>
        <button class="secondary" :disabled="!imported.trim()" @click="importTheme">Import theme</button>
      </details>
    </template>
  </div>
  <p v-if="message" role="status" class="inline-message">{{ message }}</p>
</template>

<style scoped>
.appearance-heading { margin: 28px 0 8px; font: inherit; font-size: 20px; font-weight: 600; }
.theme-sharing label { display: grid; gap: 8px; margin-block: 16px; }
.theme-sharing textarea { min-width: 0; resize: vertical; }
.theme-sharing button { margin: 0 12px 12px 0; }
</style>
