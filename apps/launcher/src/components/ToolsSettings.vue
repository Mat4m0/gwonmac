<script setup lang="ts">
import { DEFAULT_ALCOHOL_TIMER_POSITION } from "@shared/alcohol-timer";
import { computed, ref } from "vue";
import { GLOBAL_TOOLS, type GlobalTool, type LauncherNativeApi, type LauncherSettingsPatch, type LauncherSnapshot } from "@shared/launcher-contracts";
import { TOOL_PRESENTATION as features } from "@shared/tool-presentation";
import { SKILL_COOLDOWN_PRESETS, isSkillCooldownCustomHex, skillCooldownCssColor } from "@shared/skill-cooldowns";
import ColorControl from "./ColorControl.vue";
import ShortcutSetting from "./ShortcutSetting.vue";
import SkillLabelsSettings from "./SkillLabelsSettings.vue";

const props = defineProps<{ snapshot: LauncherSnapshot; api?: LauncherNativeApi | undefined; save: (patch: LauncherSettingsPatch) => Promise<void>; performSave?: (action: () => Promise<unknown>) => Promise<void> }>();
const emit = defineEmits<{ maps: [] }>();
const message = ref("");
const hasActiveGames = computed(() => props.snapshot.profiles.some(profile => profile.state !== "ready" && profile.state !== "failed"));
const characterDetails = [
  { key: "characterSwitchProfession", label: "Show profession" },
  { key: "characterSwitchLevel", label: "Show level" },
  { key: "characterSwitchLocation", label: "Show location" },
] as const;
const chatFilterDetails = [
  { key: "chatFilterAllyDrops", label: "Other party members' item drops" },
  { key: "chatFilterHallOfHeroes", label: "Hall of Heroes winner announcements" },
  { key: "chatFilterTitleAchievements", label: "Player title achievements" },
] as const;
const enabled = (tool: GlobalTool) => props.snapshot.tools.features[tool].enabled
  && (tool === "character-switch" || props.snapshot.tools.configured);
async function perform(action: () => Promise<unknown> | undefined, nativeSave = false) {
  message.value = "";
  try {
    if (nativeSave && props.performSave) await props.performSave(async () => action());
    else await action();
  }
  catch { message.value = "This setting could not be saved. Try again."; }
}
function customColor(value: string) {
  if (isSkillCooldownCustomHex(value)) void perform(() => props.save({ skillCooldownColor: { kind: "custom", value } }));
}
</script>

<template>
  <h1>Tools</h1>
  <p>Choose the features you use. Settings and shortcuts apply to every account.</p>
    <div class="setting-group tools-master">
      <label><span><strong>Enable Tools</strong><small>Optional game features. Character Switch works independently.</small></span><input type="checkbox" :checked="snapshot.tools.configured" @change="perform(() => api?.tools.setMasterEnabled(($event.target as HTMLInputElement).checked), true)" /></label>
      <div v-if="snapshot.tools.restartRequired" class="restart-row"><span><strong>Restart the launcher</strong><small>{{ snapshot.tools.configured ? 'Your selection is saved. Restart the launcher to load Tools. Restarting only a game window will not enable them.' : 'Tools are off in every game window. Restart the launcher to finish unloading them.' }}</small><small v-if="hasActiveGames">Close every game window before restarting the launcher.</small></span><button class="primary" :disabled="hasActiveGames" @click="perform(() => api?.tools.restartToApply())">Restart launcher</button></div>
      <p v-else class="tools-state">{{ snapshot.tools.configured ? 'Tools are loaded. Feature switches apply immediately in supported game areas.' : 'Tools are off. Your feature preferences are kept.' }}</p>
    </div>
  <template v-for="tool in GLOBAL_TOOLS" :key="tool">
    <div class="setting-group feature-setting">
      <div class="feature-heading">
        <label :for="`tool-${tool}`"><strong>{{ features[tool].label }}</strong><small :id="`tool-${tool}-help`">{{ features[tool].description }}</small></label>
        <ShortcutSetting v-if="features[tool].action" :action="features[tool].action!" :shortcuts="snapshot.shortcuts" :api="api?.tools" :perform-save="performSave" :disabled="!enabled(tool)" />
        <input :id="`tool-${tool}`" type="checkbox" :aria-label="features[tool].label" :aria-describedby="`tool-${tool}-help`" :checked="snapshot.tools.features[tool].enabled" :disabled="tool !== 'character-switch' && !snapshot.tools.configured" @change="perform(() => api?.tools.setFeature({ tool, enabled: ($event.target as HTMLInputElement).checked }), true)" />
      </div>
      <template v-if="enabled(tool)">
        <details v-if="tool === 'character-switch'" class="character-details">
          <summary>Character details</summary>
          <label v-for="detail in characterDetails" :key="detail.key"><span>{{ detail.label }}</span><input type="checkbox" :checked="snapshot.settings[detail.key]" @change="perform(() => save({ [detail.key]: ($event.target as HTMLInputElement).checked }))" /></label>
        </details>
        <div v-if="tool === 'maps'" class="feature-details"><button class="secondary" @click="emit('maps')">Customize Maps</button><p>Choose layers, styles, and shortcuts. Map shortcuts are unassigned by default.</p></div>
        <div v-if="tool === 'alcohol-timer'" class="feature-details"><button class="secondary" @click="perform(() => save({ alcoholTimerPosition: { ...snapshot.settings.alcoholTimerPosition, locked: false } }))">Adjust position</button><button class="secondary" @click="perform(() => save({ alcoholTimerPosition: DEFAULT_ALCOHOL_TIMER_POSITION }))">Reset position</button><p>Drag the timer in a game window, then select its lock. Position stays fixed to the nearest game-window corner.</p></div>
        <SkillLabelsSettings v-if="tool === 'skill-key-labels'" :bindings="snapshot.settings.skillKeyBindings" :save="save" />
        <div v-if="tool === 'chat-filters'" class="chat-filter-details">
          <label v-for="filter in chatFilterDetails" :key="filter.key"><span>{{ filter.label }}</span><input type="checkbox" :checked="snapshot.settings[filter.key]" @change="perform(() => save({ [filter.key]: ($event.target as HTMLInputElement).checked }))" /></label>
        </div>
        <template v-if="tool === 'skill-cooldowns'">
          <label><span>Timer color</span><select :value="snapshot.settings.skillCooldownColor.kind === 'preset' ? snapshot.settings.skillCooldownColor.preset : 'custom'" @change="perform(() => save({ skillCooldownColor: ($event.target as HTMLSelectElement).value === 'custom' ? { kind: 'custom', value: '#e35a4f' } : { kind: 'preset', preset: ($event.target as HTMLSelectElement).value as typeof SKILL_COOLDOWN_PRESETS[number] } }))"><option v-for="preset in SKILL_COOLDOWN_PRESETS" :key="preset" :value="preset">{{ preset }}</option><option value="custom">Custom</option></select></label>
          <div v-if="snapshot.settings.skillCooldownColor.kind === 'custom'" class="setting-row"><span>Custom timer color</span><ColorControl label="Custom timer color" :value="skillCooldownCssColor(snapshot.settings.skillCooldownColor)" @change="customColor" /></div>
        </template>
      </template>
    </div>
  </template>
  <p v-if="message" role="alert" class="inline-message">{{ message }}</p>
</template>

<style scoped>
.feature-setting { margin-bottom: 0; }
.tools-state { margin: 0 0 16px; font-size: 14px; }
.character-details label,
.chat-filter-details label { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; }
.feature-details { padding: 0 0 16px; }
.feature-details button + button { margin-left: 8px; }
.feature-details p { margin-bottom: 0; }
</style>
