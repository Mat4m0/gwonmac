<script setup lang="ts">
import { computed } from "vue";
import { RotateCcw, Wrench } from "lucide-vue-next";
import type { CacheInfo } from "@shared/contracts";
import type { LauncherReadiness } from "@shared/launcher-contracts";
import { cacheSummary, formatProgress } from "../launcher-view-model";
import { backgroundDownloadFailure, repairReason } from "../update-game-files-copy";

const props = defineProps<{
  readiness: LauncherReadiness;
  info: CacheInfo | null;
  loading: boolean;
  repair: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  reset: () => Promise<void>;
}>();

const background = computed(() => props.readiness.state === "playable"
  ? props.readiness.backgroundDownload
  : null);
const backgroundProgress = computed(() => {
  const value = background.value;
  if (!value || value.status !== "running") return null;
  return {
    text: formatProgress({
      phase: "image",
      label: "Downloading full game",
      received: value.received,
      total: value.total,
      bytesPerSecond: value.bytesPerSecond,
      secondsRemaining: value.secondsRemaining,
    }),
    received: value.received,
    total: value.total,
  };
});
const status = computed(() => {
  if (props.readiness.state === "repair-required") return "Needs repair";
  if (props.readiness.state === "preparing") return "Preparing";
  return "Ready";
});
</script>

<template>
  <h1>Game files</h1>
  <p>Game files and required Guild Wars updates are shared by every account and managed automatically.</p>
  <div class="setting-group">
    <div class="setting-row">
      <span>
        <strong>Guild Wars client</strong>
        <small v-if="loading">Checking game files…</small>
        <small v-else-if="info">{{ cacheSummary(info) }}</small>
        <small v-else>File details are unavailable.</small>
      </span>
      <span :class="{ good: readiness.state !== 'repair-required' }">{{ status }}</span>
    </div>

    <div v-if="readiness.state === 'preparing'" class="download-card">
      <div><strong>{{ readiness.progress.label }}</strong><span>{{ formatProgress(readiness.progress) }}</span></div>
      <progress :value="readiness.progress.received" :max="readiness.progress.total || 1" />
    </div>

    <div v-else-if="background" class="download-card">
      <div>
        <strong>Complete game download</strong>
        <span v-if="background.status === 'running'">{{ backgroundProgress?.text }} · You can play now.</span>
        <span v-else-if="background.status === 'paused'">Download paused. You can still play.</span>
        <span v-else-if="background.status === 'failed'">{{ backgroundDownloadFailure(background.errorCode) }}</span>
        <span v-else-if="background.status === 'complete'">All game files are available offline.</span>
        <span v-else>Pausing download…</span>
      </div>
      <button v-if="background.status === 'running'" class="secondary" @click="pause">Pause</button>
      <button v-else-if="background.status === 'paused' || background.status === 'failed'" class="secondary" @click="resume">
        {{ background.status === 'failed' ? 'Try again' : 'Resume' }}
      </button>
      <progress v-if="backgroundProgress" :value="backgroundProgress.received" :max="backgroundProgress.total || 1" />
    </div>

    <div v-if="readiness.state === 'repair-required'" class="recovery-card" role="status">
      <div><strong>Repair needed</strong><span>{{ repairReason(readiness.reason) }}</span></div>
      <button class="primary" @click="repair"><Wrench />Repair game files</button>
    </div>
    <div v-else class="file-actions">
      <button class="secondary" @click="repair"><Wrench />Check and repair game files</button>
      <small>The launcher restarts to verify the client. Close open game windows first.</small>
    </div>

    <details>
      <summary>Advanced</summary>
      <button class="danger-button" @click="reset"><RotateCcw />Reset and redownload game files</button>
      <p>This removes only downloaded Guild Wars client data after restart. Profiles, saved logins, application settings, Tools, shortcuts, builds, templates, screenshots, chat logs, and window positions are kept.</p>
    </details>
  </div>
</template>
