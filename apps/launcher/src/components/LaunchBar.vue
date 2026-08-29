<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Check, ChevronDown, Play, Settings, Users, X } from "lucide-vue-next";
import type { LauncherSnapshot } from "@shared/launcher-contracts";
import type { ProfileId } from "@shared/multiple-accounts";
import { launchLabel, profileStatus } from "../launcher-view-model";

const props = defineProps<{
  snapshot: LauncherSnapshot;
  selected: readonly ProfileId[];
  busy: boolean;
}>();
const emit = defineEmits<{
  toggle: [id: ProfileId];
  action: [];
  manage: [];
}>();
const pickerOpen = ref(false);
const pickerWrap = ref<HTMLElement | null>(null);
const pickerButton = ref<HTMLButtonElement | null>(null);

const visibleProfiles = computed(() => props.snapshot.profiles.filter((profile) => !profile.archived));
const selectedProfiles = computed(() => visibleProfiles.value.filter((profile) => props.selected.includes(profile.id)));
const closedSelected = computed(() => selectedProfiles.value.filter((profile) => profile.state !== "running"));
const waiting = computed(() => selectedProfiles.value.some((profile) => profile.state === "queued"));
const label = computed(() => launchLabel(selectedProfiles.value, props.snapshot.readiness));
const disabled = computed(() => props.busy || props.selected.length === 0 || (closedSelected.value.length === 0 && selectedProfiles.value.length > 1));
const readyText = computed(() => {
  if (props.snapshot.readiness.state === "preparing") return "Preparing Guild Wars";
  if (props.snapshot.readiness.state === "repair-required") return "Game files need repair";
  if (props.snapshot.readiness.state === "offline-playable") return "Ready to play offline";
  return props.snapshot.readiness.backgroundDownload?.status === "running" ? "Ready to play · Downloading game files" : "Ready to play";
});

function closePicker(restoreFocus = true) {
  if (!pickerOpen.value) return;
  pickerOpen.value = false;
  if (restoreFocus) requestAnimationFrame(() => pickerButton.value?.focus());
}

function onPointerDown(event: PointerEvent) {
  if (pickerOpen.value && !pickerWrap.value?.contains(event.target as Node)) closePicker(false);
}

function manage() {
  closePicker(false);
  emit("manage");
}

onMounted(() => document.addEventListener("pointerdown", onPointerDown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerDown));
</script>

<template>
  <footer class="launchbar">
    <div class="readiness" role="status" aria-live="polite"><span class="ready-dot" :class="snapshot.readiness.state" /><div><strong>{{ readyText }}</strong><small v-if="snapshot.readiness.state === 'playable'">Guild Wars and your enabled Tools are available.</small></div></div>
    <div ref="pickerWrap" class="picker-wrap">
      <button ref="pickerButton" class="account-picker" aria-haspopup="dialog" :aria-expanded="pickerOpen" aria-controls="profile-picker" @click="pickerOpen = !pickerOpen"><Users /><span><small>Accounts</small><strong>{{ selectedProfiles.length }} selected</strong></span><ChevronDown /></button>
      <div v-if="pickerOpen" id="profile-picker" class="profile-picker" role="dialog" aria-label="Choose accounts" @keydown.esc="closePicker()">
        <strong>Choose accounts</strong>
        <button v-for="profile in visibleProfiles" :key="profile.id" role="checkbox" :aria-checked="selected.includes(profile.id)" @click="emit('toggle', profile.id)">
          <span aria-hidden="true" class="checkbox" :class="{ checked: selected.includes(profile.id) }"><Check v-if="selected.includes(profile.id)" /></span>
          <span><b>{{ profile.name }}</b><small>{{ profileStatus(profile) }}</small></span>
        </button>
        <button class="manage" @click="manage"><Settings />Manage accounts</button>
      </div>
    </div>
    <button class="primary launch" :disabled="disabled" @click="emit('action')"><X v-if="waiting" /><Play v-else />{{ label }}</button>
  </footer>
</template>
