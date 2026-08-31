<script setup lang="ts">
import { computed } from "vue";
import type { AppUpdateState } from "@shared/contracts";
import type { LauncherSettings, LauncherSettingsPatch } from "@shared/launcher-contracts";
import { applicationUpdatePresentation } from "../update-game-files-copy";

const props = defineProps<{
  settings: Pick<LauncherSettings, "autoCheckUpdates" | "updateTrack">;
  update: AppUpdateState;
  save: (patch: LauncherSettingsPatch) => Promise<void>;
  check: () => Promise<void>;
  restart: () => Promise<void>;
  openReleases: () => Promise<void>;
}>();

const presentation = computed(() => applicationUpdatePresentation(props.update));

function checked(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked;
}

function track(event: Event): "stable" | "beta" {
  return (event.currentTarget as HTMLSelectElement).value as "stable" | "beta";
}

function performAction(): Promise<void> {
  if (presentation.value.action === "restart") return props.restart();
  if (presentation.value.action === "releases") return props.openReleases();
  return props.check();
}
</script>

<template>
  <h1>General</h1>
  <div class="setting-group">
    <label>
      <span>
        <strong>Automatically update this launcher</strong>
        <small>Checks for Guild Wars Reforged app updates. Guild Wars game files update separately.</small>
      </span>
      <input type="checkbox" :checked="settings.autoCheckUpdates" @change="save({ autoCheckUpdates: checked($event) })" />
    </label>
    <label>
      <span><strong>Launcher update channel</strong><small>Stable is recommended.</small></span>
      <select :value="settings.updateTrack" @change="save({ updateTrack: track($event) })">
        <option value="stable">Stable</option>
        <option value="beta">Beta</option>
      </select>
    </label>
    <div class="setting-row">
      <span><strong>{{ presentation.title }}</strong><small>{{ presentation.detail }}</small></span>
      <button
        v-if="presentation.action !== 'none'"
        :class="presentation.action === 'restart' ? 'primary' : 'secondary'"
        @click="performAction"
      >{{ presentation.actionLabel }}</button>
    </div>
  </div>
</template>
