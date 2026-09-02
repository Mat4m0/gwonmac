<script setup lang="ts">
import { ref } from "vue";
import { GLOBAL_TOOLS, type GlobalTool, type LauncherNativeApi, type LauncherSettingsPatch, type LauncherSnapshot } from "@shared/launcher-contracts";
import type { ShortcutAction } from "@shared/keyboard-shortcuts";
import { SKILL_COOLDOWN_PRESETS, isSkillCooldownCustomHex, skillCooldownCssColor } from "@shared/skill-cooldowns";
import ShortcutSetting from "./ShortcutSetting.vue";
import SkillLabelsSettings from "./SkillLabelsSettings.vue";

const props = defineProps<{ snapshot: LauncherSnapshot; api?: LauncherNativeApi | undefined; save: (patch: LauncherSettingsPatch) => Promise<void> }>();
const emit = defineEmits<{ maps: [] }>();
const message = ref("");
const features: Record<GlobalTool, { label: string; description: string; action?: ShortcutAction }> = {
  "character-switch": { label: "Character Switch", description: "Search and browse every character. Available without optional Tools.", action: "character.switch" },
  "build-management": { label: "Build Management", description: "Save and load skill builds.", action: "tools.toggle" },
  "quick-travel": { label: "Quick Travel", description: "Search destinations and travel between outposts.", action: "travel.open" },
  "xunlai-storage": { label: "Xunlai Storage", description: "Open storage in supported outposts.", action: "storage.open" },
  "trade-chat": { label: "Trade Chat", description: "Browse the trade feed.", action: "trade.toggle" },
  maps: { label: "Maps", description: "Exploration grid and walkable terrain on supported PvE maps." },
  "target-readout": { label: "Target Distance", description: "Show distance to the selected target in PvE." },
  "skill-key-labels": { label: "Skill Key Labels", description: "Show your own control labels on the eight skill slots." },
  "skill-cooldowns": { label: "Skill Cooldowns", description: "Show numeric recharge timers on the skill bar." },
};
const characterDetails = [
  { key: "characterSwitchProfession", label: "Show profession" },
  { key: "characterSwitchLevel", label: "Show level" },
  { key: "characterSwitchLocation", label: "Show location" },
] as const;
const enabled = (tool: GlobalTool) => props.snapshot.tools.features[tool].enabled
  && (tool === "character-switch" || props.snapshot.tools.configured);
async function perform(action: () => Promise<unknown> | undefined) {
  message.value = "";
  try { await action(); }
  catch { message.value = "This setting could not be saved. Try again."; }
}
function customColor(value: string) {
  if (isSkillCooldownCustomHex(value)) void perform(() => props.save({ skillCooldownColor: { kind: "custom", value } }));
}
</script>

<template>
  <h1>Tools</h1>
  <p>Choose the features you use. Settings and shortcuts apply to every account.</p>
  <template v-for="tool in GLOBAL_TOOLS" :key="tool">
    <div v-if="tool === 'build-management'" class="setting-group">
      <label><span><strong>Enable Tools</strong><small>Enable optional features below. Character Switch is independent.</small></span><input type="checkbox" :checked="snapshot.tools.configured" @change="perform(() => api?.tools.setMasterEnabled(($event.target as HTMLInputElement).checked))" /></label>
      <div v-if="snapshot.tools.restartRequired" class="restart-row"><span><strong>Restart needed</strong><small>Your selection is saved. Optional Tools need an application restart to load or unload.</small></span><button v-if="!snapshot.profiles.some(profile => profile.state === 'running')" class="primary" @click="perform(() => api?.tools.restartToApply())">Restart application</button><span v-else>Applies after your next normal restart.</span></div>
    </div>
    <div class="setting-group feature-setting">
      <label><span><strong>{{ features[tool].label }}</strong><small>{{ features[tool].description }}</small></span><input type="checkbox" :checked="snapshot.tools.features[tool].enabled" :disabled="tool !== 'character-switch' && !snapshot.tools.configured" @change="perform(() => api?.tools.setFeature({ tool, enabled: ($event.target as HTMLInputElement).checked }))" /></label>
      <ShortcutSetting v-if="features[tool].action" :action="features[tool].action!" :shortcuts="snapshot.shortcuts" :api="api?.tools" :disabled="!enabled(tool)" />
      <template v-if="enabled(tool)">
        <details v-if="tool === 'character-switch'" class="character-details">
          <summary>Character details</summary>
          <label v-for="detail in characterDetails" :key="detail.key"><span>{{ detail.label }}</span><input type="checkbox" :checked="snapshot.settings[detail.key]" @change="perform(() => save({ [detail.key]: ($event.target as HTMLInputElement).checked }))" /></label>
        </details>
        <div v-if="tool === 'maps'" class="feature-details"><button class="secondary" @click="emit('maps')">Customize Maps</button><p>Choose layers, styles, and shortcuts. Map shortcuts are unassigned by default.</p></div>
        <SkillLabelsSettings v-if="tool === 'skill-key-labels'" :bindings="snapshot.settings.skillKeyBindings" :save="save" />
        <template v-if="tool === 'skill-cooldowns'">
          <label><span>Timer color</span><select :value="snapshot.settings.skillCooldownColor.kind === 'preset' ? snapshot.settings.skillCooldownColor.preset : 'custom'" @change="perform(() => save({ skillCooldownColor: ($event.target as HTMLSelectElement).value === 'custom' ? { kind: 'custom', value: '#e35a4f' } : { kind: 'preset', preset: ($event.target as HTMLSelectElement).value as typeof SKILL_COOLDOWN_PRESETS[number] } }))"><option v-for="preset in SKILL_COOLDOWN_PRESETS" :key="preset" :value="preset">{{ preset }}</option><option value="custom">Custom</option></select></label>
          <label v-if="snapshot.settings.skillCooldownColor.kind === 'custom'"><span>Custom timer color</span><input type="color" :value="skillCooldownCssColor(snapshot.settings.skillCooldownColor)" @change="customColor(($event.target as HTMLInputElement).value)" /></label>
        </template>
      </template>
    </div>
  </template>
  <p v-if="message" role="alert" class="inline-message">{{ message }}</p>
</template>

<style scoped>
.setting-group { margin-bottom: 20px; }
.character-details label { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; }
.feature-details { padding: 0 24px 20px; }
.feature-details p { margin-bottom: 0; }
</style>
