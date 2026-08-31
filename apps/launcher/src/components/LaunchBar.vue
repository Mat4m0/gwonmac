<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AlertTriangle, Check, ChevronDown, Clock3, Play, RotateCcw, Settings, Users, WifiOff, X } from "lucide-vue-next";
import type { LauncherSnapshot } from "@shared/launcher-contracts";
import type { ProfileId } from "@shared/multiple-accounts";
import { launchLabel, profileStatus } from "../launcher-view-model";
import { backgroundDownloadPresentation, playableNoticePresentation } from "../update-game-files-copy";

const props = defineProps<{
  snapshot: LauncherSnapshot;
  selected: readonly ProfileId[];
  busy: boolean;
  operationError?: string;
  updateDismissed?: boolean;
}>();
const emit = defineEmits<{
  toggle: [id: ProfileId];
  show: [id: ProfileId];
  action: [];
  manage: [];
  gameFiles: [];
  dismissError: [];
  dismissUpdate: [];
  installUpdate: [];
}>();
const pickerOpen = ref(false);
const pickerWrap = ref<HTMLElement | null>(null);
const pickerButton = ref<HTMLButtonElement | null>(null);

const visibleProfiles = computed(() => props.snapshot.profiles.filter((profile) => !profile.archived));
const selectedProfiles = computed(() => visibleProfiles.value.filter((profile) => props.selected.includes(profile.id)));
const closedSelected = computed(() => selectedProfiles.value.filter((profile) => profile.state !== "running"));
const waiting = computed(() => selectedProfiles.value.some((profile) => profile.state === "queued"));
const starting = computed(() => selectedProfiles.value.some((profile) => profile.state === "opening" || profile.state === "checking"));
const label = computed(() => launchLabel(selectedProfiles.value, props.snapshot.readiness));
const disabled = computed(() => (
  props.busy
  || starting.value
  || props.selected.length === 0
  || (
    props.snapshot.readiness.state !== "repair-required"
    && closedSelected.value.length === 0
    && selectedProfiles.value.length > 1
  )
));
type StatusAction = "game-files" | "install-update";
type StatusTone = "ready" | "working" | "warning" | "danger";
interface OperationalStatus {
  readonly title: string;
  readonly detail: string;
  readonly tone: StatusTone;
  readonly icon: typeof Check;
  readonly action?: StatusAction;
  readonly actionLabel?: string;
  readonly dismiss?: "error" | "update";
  readonly progress?: number;
}

const operationalStatus = computed<OperationalStatus>(() => {
  if (props.operationError) {
    return {
      title: props.operationError,
      detail: "Nothing was changed.",
      tone: "danger",
      icon: AlertTriangle,
      dismiss: "error",
    };
  }

  const readiness = props.snapshot.readiness;
  if (readiness.state === "repair-required") {
    return {
      title: "Game files need repair",
      detail: "Guild Wars cannot start until the game files are ready.",
      tone: "danger",
      icon: AlertTriangle,
    };
  }
  if (readiness.state === "preparing") {
    const progress = readiness.progress.total > 0
      ? Math.min(100, Math.round((readiness.progress.received / readiness.progress.total) * 100))
      : undefined;
    return {
      title: progress === undefined ? "Preparing Guild Wars" : `Preparing Guild Wars · ${progress}%`,
      detail: readiness.progress.label,
      tone: "working",
      icon: Clock3,
      action: "game-files",
      actionLabel: "View download",
      ...(progress === undefined ? {} : { progress }),
    };
  }

  if (props.snapshot.appUpdate.phase === "ready" && !props.updateDismissed) {
    return {
      title: "Launcher update ready",
      detail: "Restart when you are finished playing.",
      tone: "working",
      icon: RotateCcw,
      action: "install-update",
      actionLabel: "Restart and update",
      dismiss: "update",
    };
  }

  const playableNotice = playableNoticePresentation(readiness);
  if (playableNotice) {
    return {
      ...playableNotice,
      tone: "warning",
      icon: AlertTriangle,
      action: "game-files",
      actionLabel: "View game files",
    };
  }

  if (readiness.state === "offline-playable") {
    return {
      title: "Ready to play offline",
      detail: "Using the game files already on this Mac.",
      tone: "warning",
      icon: WifiOff,
    };
  }

  const download = readiness.state === "playable" ? readiness.backgroundDownload : null;
  const downloadCopy = download ? backgroundDownloadPresentation(download) : null;
  if (download && downloadCopy) {
    const progress = download.status === "running" && download.total > 0
      ? Math.min(100, Math.round((download.received / download.total) * 100))
      : undefined;
    return {
      ...downloadCopy,
      tone: download.status === "failed" ? "warning" : "working",
      icon: download.status === "failed" ? AlertTriangle : Clock3,
      action: "game-files",
      actionLabel: download.status === "failed" ? "Review download" : "View download",
      ...(progress === undefined ? {} : { progress }),
    };
  }

  return {
    title: "Ready to play",
    detail: "Guild Wars is available.",
    tone: "ready",
    icon: Check,
  };
});

function runStatusAction(action: StatusAction) {
  if (action === "game-files") emit("gameFiles");
  else emit("installUpdate");
}

function dismissStatus(kind: "error" | "update") {
  if (kind === "error") emit("dismissError");
  else emit("dismissUpdate");
}

function closePicker(restoreFocus = true) {
  if (!pickerOpen.value) return;
  pickerOpen.value = false;
  if (restoreFocus) requestAnimationFrame(() => pickerButton.value?.focus());
}

function onPointerDown(event: PointerEvent) {
  if (pickerOpen.value && !pickerWrap.value?.contains(event.target as Node)) closePicker(false);
}

function onFocusIn(event: FocusEvent) {
  if (pickerOpen.value && !pickerWrap.value?.contains(event.target as Node)) closePicker(false);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !pickerOpen.value) return;
  event.preventDefault();
  closePicker();
}

function manage() {
  closePicker(false);
  emit("manage");
}

watch(pickerOpen, async (open) => {
  if (!open) return;
  await nextTick();
  pickerWrap.value?.querySelector<HTMLElement>('[role="checkbox"]')?.focus();
});

onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <footer class="launchbar">
    <div class="readiness" :class="`status-${operationalStatus.tone}`" :role="operationalStatus.tone === 'danger' ? 'alert' : 'status'" :aria-live="operationalStatus.tone === 'danger' ? 'assertive' : 'polite'">
      <span class="status-icon" aria-hidden="true"><component :is="operationalStatus.icon" /></span>
      <div class="status-copy">
        <strong>{{ operationalStatus.title }}</strong>
        <small>{{ operationalStatus.detail }}</small>
        <progress v-if="operationalStatus.progress !== undefined" :value="operationalStatus.progress" max="100" :aria-label="`${operationalStatus.progress}% complete`" />
      </div>
      <div v-if="operationalStatus.action || operationalStatus.dismiss" class="status-actions">
        <button v-if="operationalStatus.dismiss === 'update'" class="status-quiet-action" @click="dismissStatus('update')">Later</button>
        <button v-if="operationalStatus.action" class="status-action" @click="runStatusAction(operationalStatus.action)">{{ operationalStatus.actionLabel }}</button>
        <button v-if="operationalStatus.dismiss === 'error'" class="icon-button" aria-label="Dismiss error" @click="dismissStatus('error')"><X /></button>
      </div>
    </div>
    <div ref="pickerWrap" class="picker-wrap">
      <button ref="pickerButton" class="account-picker" :aria-label="`Choose accounts, ${selectedProfiles.length} selected`" aria-haspopup="true" :aria-expanded="pickerOpen" aria-controls="profile-picker" @click="pickerOpen = !pickerOpen"><Users /><span aria-hidden="true"><small>Accounts</small><strong>{{ selectedProfiles.length }} selected</strong></span><ChevronDown aria-hidden="true" /></button>
      <div v-if="pickerOpen" id="profile-picker" class="profile-picker" role="group" aria-label="Choose accounts">
        <strong>Choose accounts</strong>
        <div v-for="profile in visibleProfiles" :key="profile.id" class="profile-choice">
          <button class="profile-toggle" role="checkbox" :aria-checked="selected.includes(profile.id)" @click="emit('toggle', profile.id)">
            <span aria-hidden="true" class="checkbox" :class="{ checked: selected.includes(profile.id) }"><Check v-if="selected.includes(profile.id)" /></span>
            <span><b>{{ profile.name }}</b><small>{{ profileStatus(profile) }}</small></span>
          </button>
          <button v-if="profile.state === 'running'" class="show-profile" :aria-label="`Show ${profile.name}`" @click="emit('show', profile.id)">Show</button>
        </div>
        <button class="manage" @click="manage"><Settings />Manage accounts</button>
      </div>
    </div>
    <button class="primary launch" :disabled="disabled" @click="emit('action')"><X v-if="waiting" /><Play v-else />{{ label }}</button>
  </footer>
</template>
