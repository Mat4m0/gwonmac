<script setup lang="ts">
import { computed } from "vue";
import { CONTROLLER_SYMBOL_OPTIONS, GAME_SETTINGS, RENDER_SCALE_OPTIONS, settingDetail } from "@shared/setting-copy";
import { extendedMemoryView } from "@shared/extended-memory-view";
import type { LauncherSettingsPatch, LauncherSnapshot } from "@shared/launcher-contracts";

const props = defineProps<{ snapshot: LauncherSnapshot; save: (patch: LauncherSettingsPatch) => Promise<void> }>();
// The state line appears only while a game runs and its limit differs from the saved choice or is notable.
const memory = computed(() => props.snapshot.extendedMemory ? extendedMemoryView(props.snapshot.settings.extendedMemoryEnabled, props.snapshot.extendedMemory) : null);
const checked = (event: Event) => (event.currentTarget as HTMLInputElement).checked;
const value = (event: Event) => (event.currentTarget as HTMLSelectElement).value;
</script>

<template>
  <h1>Game</h1>
  <p class="section-intro">Applies to every account. Graphics, audio and key bindings inside Guild Wars are changed in the game.</p>
  <div class="setting-group">
    <label data-setting="renderScale"><span><strong>{{ GAME_SETTINGS.renderScale.label }}</strong><small>{{ settingDetail(GAME_SETTINGS.renderScale) }}</small></span><select :value="snapshot.settings.renderScale" @change="save({ renderScale: Number(value($event)) as 1 | 1.5 | 2 })"><option v-for="option in RENDER_SCALE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
    <label data-setting="extendedMemoryEnabled"><span><strong>{{ GAME_SETTINGS.extendedMemoryEnabled.label }}</strong><small>{{ settingDetail(GAME_SETTINGS.extendedMemoryEnabled) }}</small><small v-if="memory && memory.level !== 'neutral'" class="setting-state" :class="memory.level">{{ memory.label }}. {{ memory.detail }}</small></span><input type="checkbox" :checked="snapshot.settings.extendedMemoryEnabled" @change="save({ extendedMemoryEnabled: checked($event) })" /></label>
    <label data-setting="autoRelogAfterReload"><span><strong>{{ GAME_SETTINGS.autoRelogAfterReload.label }}</strong><small>{{ settingDetail(GAME_SETTINGS.autoRelogAfterReload) }}</small></span><input type="checkbox" :checked="snapshot.settings.autoRelogAfterReload" @change="save({ autoRelogAfterReload: checked($event) })" /></label>
    <label data-setting="controllerPromptStyle"><span><strong>{{ GAME_SETTINGS.controllerPromptStyle.label }}</strong><small>{{ settingDetail(GAME_SETTINGS.controllerPromptStyle) }}</small></span><select :value="snapshot.settings.controllerPromptStyle" @change="save({ controllerPromptStyle: value($event) as 'game-default' | 'playstation' })"><option v-for="option in CONTROLLER_SYMBOL_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
    <label data-setting="showDiagnostics"><span><strong>{{ GAME_SETTINGS.showDiagnostics.label }}</strong><small>{{ settingDetail(GAME_SETTINGS.showDiagnostics) }}</small></span><input type="checkbox" :checked="snapshot.settings.showDiagnostics" @change="save({ showDiagnostics: checked($event) })" /></label>
  </div>
</template>
