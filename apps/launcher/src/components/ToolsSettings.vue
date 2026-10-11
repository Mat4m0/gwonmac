<script setup lang="ts">
import type { InGameNative, InGamePatch, InGameSnapshot } from "../settings-host";
import { CHARACTER_DETAILS, CHAT_FILTERS, REMINDER_GROUPS, REMINDER_SOUND, REMINDER_TIMING } from "@shared/setting-copy";
import { DEFAULT_ALCOHOL_TIMER_POSITION } from "@shared/alcohol-timer";
import { computed, ref } from "vue";
import { GLOBAL_TOOLS, type GlobalTool, type LauncherSnapshot } from "@shared/launcher-contracts";
import { HUB_SHORTCUT, shortcutKeycaps } from "@shared/keyboard-shortcuts";
import { TOOL_PRESENTATION as features } from "@shared/tool-presentation";
import { SKILL_COOLDOWN_PRESETS, isSkillCooldownCustomHex, skillCooldownCssColor } from "@shared/skill-cooldowns";
import ColorControl from "./ColorControl.vue";
import ShortcutSetting from "./ShortcutSetting.vue";
import SkillLabelsSettings from "./SkillLabelsSettings.vue";

const props = defineProps<{ snapshot: InGameSnapshot; api?: InGameNative | undefined; profiles?: LauncherSnapshot["profiles"] | undefined; save: (patch: InGamePatch) => Promise<void>; performSave?: (action: () => Promise<unknown>) => Promise<void> }>();
const emit = defineEmits<{ maps: [] }>();
const message = ref("");
// In a game window (no profiles) a game is running by definition.
const hasActiveGames = computed(() => !props.profiles || props.profiles.some(profile => profile.state !== "ready" && profile.state !== "failed"));
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
/** Tools whose options open under their row; closed by default so the list stays short. */
const OPTION_TOOLS: readonly GlobalTool[] = ["character-switch", "alcohol-timer", "skill-key-labels", "chat-filters", "reminders", "skill-cooldowns"];
const hasOptions = (tool: GlobalTool) => OPTION_TOOLS.includes(tool);
const openOptions = ref(new Set<GlobalTool>());
function toggleOptions(tool: GlobalTool, event: Event) {
  const next = new Set(openOptions.value);
  if ((event.currentTarget as HTMLDetailsElement).open) next.add(tool); else next.delete(tool);
  openOptions.value = next;
}
// With no group or no timing chosen, Reminders stays on but prints nothing.
const remindersSilent = computed(() => !REMINDER_GROUPS.some(group => props.snapshot.settings[group.key])
  || !REMINDER_TIMING.some(timing => props.snapshot.settings[timing.key]));
function customColor(value: string) {
  if (isSkillCooldownCustomHex(value)) void perform(() => props.save({ skillCooldownColor: { kind: "custom", value } }));
}
</script>

<template>
  <h1>Tools</h1>
  <p>Choose the features you use. Each shortcut sits next to its tool. Everything applies to every account.</p>
    <div class="setting-group hub-setting">
      <div class="feature-heading" data-setting="hub">
        <span><strong>Hub</strong><small>Search everything in game. Always on, even with Tools off.</small></span>
        <span class="shortcut-keycaps" aria-label="Command R"><kbd v-for="cap in shortcutKeycaps(HUB_SHORTCUT)" :key="cap.name" :title="cap.name">{{ cap.label }}</kbd></span>
        <span class="built-in">Built in</span>
      </div>
    </div>
    <div class="setting-group tools-master">
      <label data-setting="gwonmacTools"><span><strong>Enable Tools</strong><small>Optional game features. Character Switch works independently.</small></span><input type="checkbox" :checked="snapshot.tools.configured" @change="perform(() => api?.tools.setMasterEnabled(($event.target as HTMLInputElement).checked), true)" /></label>
      <div v-if="snapshot.tools.restartRequired" class="restart-row"><span><strong>Restart the launcher</strong><small>{{ snapshot.tools.configured ? 'Your selection is saved. Restart the launcher to load Tools. Restarting only a game window will not enable them.' : 'Tools are off in every game window. Restart the launcher to finish unloading them.' }}</small><small v-if="hasActiveGames">Close every game window before restarting the launcher.</small></span><button v-if="api?.tools.restartToApply" class="primary" :disabled="hasActiveGames" @click="perform(() => api?.tools.restartToApply?.())">Restart launcher</button></div>
      <p v-else class="tools-state">{{ snapshot.tools.configured ? 'Tools are loaded. Feature switches apply immediately in supported game areas.' : 'Tools are off. Your feature preferences are kept.' }}</p>
    </div>
  <template v-for="tool in GLOBAL_TOOLS" :key="tool">
    <div class="setting-group feature-setting" :data-setting="`tool:${tool}`">
      <div class="feature-heading">
        <label :for="`tool-${tool}`"><strong>{{ features[tool].label }}</strong><small :id="`tool-${tool}-help`">{{ features[tool].description }}</small></label>
        <ShortcutSetting v-if="features[tool].action" :action="features[tool].action!" :shortcuts="snapshot.shortcuts" :api="api?.tools" :perform-save="performSave" :disabled="!enabled(tool)" />
        <input :id="`tool-${tool}`" type="checkbox" :aria-label="features[tool].label" :aria-describedby="`tool-${tool}-help`" :checked="snapshot.tools.features[tool].enabled" :disabled="tool !== 'character-switch' && !snapshot.tools.configured" @change="perform(() => api?.tools.setFeature({ tool, enabled: ($event.target as HTMLInputElement).checked }), true)" />
      </div>
      <p v-if="tool === 'maps' && enabled(tool)" class="tool-link"><button class="text-link" @click="emit('maps')">Layers, styles and map shortcuts in Maps settings</button></p>
      <details v-else-if="enabled(tool) && hasOptions(tool)" class="tool-options" :open="openOptions.has(tool)" @toggle="toggleOptions(tool, $event)">
        <summary>Options</summary>
        <div v-if="tool === 'character-switch'" class="character-details">
          <label v-for="detail in CHARACTER_DETAILS" :key="detail.key" :data-setting="detail.key"><span>{{ detail.label }}</span><input type="checkbox" :checked="snapshot.settings[detail.key]" @change="perform(() => save({ [detail.key]: ($event.target as HTMLInputElement).checked }))" /></label>
        </div>
        <div v-if="tool === 'alcohol-timer'" class="feature-details" role="group" aria-label="Alcohol Timer position" data-setting="alcoholTimerPosition"><button class="secondary" @click="perform(() => save({ alcoholTimerPosition: { ...snapshot.settings.alcoholTimerPosition, locked: false } }))">Adjust position</button><button class="secondary" @click="perform(() => save({ alcoholTimerPosition: DEFAULT_ALCOHOL_TIMER_POSITION }))">Reset position</button><p>Drag the timer in a game window, then select its lock. Position stays fixed to the nearest game-window corner.</p></div>
        <SkillLabelsSettings v-if="tool === 'skill-key-labels'" role="group" aria-label="Skill labels" data-setting="skillKeyBindings" :bindings="snapshot.settings.skillKeyBindings" :save="save" />
        <div v-if="tool === 'chat-filters'" class="chat-filter-details">
          <label v-for="filter in CHAT_FILTERS" :key="filter.key" :data-setting="filter.key"><span>{{ filter.label }}</span><input type="checkbox" :checked="snapshot.settings[filter.key]" @change="perform(() => save({ [filter.key]: ($event.target as HTMLInputElement).checked }))" /></label>
        </div>
        <div v-if="tool === 'reminders'" class="reminder-details">
          <fieldset><legend>Remind me about</legend>
            <label v-for="group in REMINDER_GROUPS" :key="group.key" :data-setting="group.key"><span>{{ group.label }}<small>{{ group.detail }}</small></span><input type="checkbox" :checked="snapshot.settings[group.key]" @change="perform(() => save({ [group.key]: ($event.target as HTMLInputElement).checked }))" /></label>
          </fieldset>
          <fieldset><legend>When</legend>
            <label v-for="timing in REMINDER_TIMING" :key="timing.key" :data-setting="timing.key"><span>{{ timing.label }}</span><input type="checkbox" :checked="snapshot.settings[timing.key]" @change="perform(() => save({ [timing.key]: ($event.target as HTMLInputElement).checked }))" /></label>
          </fieldset>
          <label :data-setting="REMINDER_SOUND.key"><span>{{ REMINDER_SOUND.label }}<small>{{ REMINDER_SOUND.detail }}</small></span><input type="checkbox" :checked="snapshot.settings[REMINDER_SOUND.key]" @change="perform(() => save({ [REMINDER_SOUND.key]: ($event.target as HTMLInputElement).checked }))" /></label>
          <p v-if="remindersSilent" class="reminder-note">Choose at least one item and one time, or no reminder appears.</p>
        </div>
        <template v-if="tool === 'skill-cooldowns'">
          <label data-setting="skillCooldownColor"><span>Timer color</span><select :value="snapshot.settings.skillCooldownColor.kind === 'preset' ? snapshot.settings.skillCooldownColor.preset : 'custom'" @change="perform(() => save({ skillCooldownColor: ($event.target as HTMLSelectElement).value === 'custom' ? { kind: 'custom', value: '#e35a4f' } : { kind: 'preset', preset: ($event.target as HTMLSelectElement).value as typeof SKILL_COOLDOWN_PRESETS[number] } }))"><option v-for="preset in SKILL_COOLDOWN_PRESETS" :key="preset" :value="preset">{{ preset }}</option><option value="custom">Custom</option></select></label>
          <div v-if="snapshot.settings.skillCooldownColor.kind === 'custom'" class="setting-row"><span>Custom timer color</span><ColorControl label="Custom timer color" :value="skillCooldownCssColor(snapshot.settings.skillCooldownColor)" @change="customColor" /></div>
        </template>
      </details>
    </div>
  </template>
  <p v-if="message" role="alert" class="inline-message">{{ message }}</p>
</template>

<style scoped>
.feature-setting { margin-bottom: 0; }
.tools-state { margin: 0 0 16px; font-size: 14px; }
.character-details label,
.chat-filter-details label,
.reminder-details label { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; }
.feature-details { padding: 0 0 16px; }
.reminder-details fieldset { margin: 0; padding: 0; border: 0; }
.reminder-details legend { padding: 12px 0 0; font-size: 13px; font-weight: 600; }
.reminder-details label small { display: block; }
.reminder-note { margin: 0 0 16px; font-size: 14px; }
.feature-details button + button { margin-left: 8px; }
.feature-details p { margin-bottom: 0; }
</style>
