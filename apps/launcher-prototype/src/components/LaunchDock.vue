<script setup lang="ts">
import { ChevronUp, PanelTopOpen, Play, Settings } from "@lucide/vue";
import { onBeforeUnmount, onMounted } from "vue";
import type { Account, FundingPlacement, RouteName, Scenario } from "../model";

const props = defineProps<{
  accounts: Account[];
  quickStartCount: number;
  runningCount: number;
  scenario: Scenario;
  menuOpen: boolean;
  fundingPlacement: FundingPlacement;
  fundingRaised: number;
  fundingGoal: number;
}>();

const emit = defineEmits<{
  quickStart: [];
  navigate: [route: RouteName];
  toggleAccount: [accountId: string];
  "update:menu-open": [value: boolean];
  support: [];
}>();

const accountCountLabel = () => {
  if (!props.quickStartCount) return "Choose accounts";
  return `${props.quickStartCount} ${props.quickStartCount === 1 ? "account" : "accounts"}`;
};

const closeMenuOnEscape = (event: KeyboardEvent) => {
  if (event.key === "Escape" && props.menuOpen) emit("update:menu-open", false);
};

onMounted(() => window.addEventListener("keydown", closeMenuOnEscape));
onBeforeUnmount(() => window.removeEventListener("keydown", closeMenuOnEscape));
</script>

<template>
  <footer class="launch-dock">
    <div class="dock-status">
      <div class="status-heading">
        <span class="status-dot" :class="scenario"></span>
        <strong>{{ runningCount ? `${runningCount} game ${runningCount === 1 ? "window" : "windows"} open` : scenario === "updating" ? "Updating Guild Wars" : "Ready to play" }}</strong>
      </div>
      <span>{{ scenario === "updating" ? "Downloading the latest game files" : runningCount ? "Each account runs in its own window" : "Guild Wars and your enabled Tools are available" }}</span>
      <div v-if="scenario === 'updating'" class="progress-track update-progress" role="progressbar" aria-label="Game update" aria-valuenow="51" aria-valuemin="0" aria-valuemax="100"><span style="width: 51%"></span></div>
      <button v-if="fundingPlacement === 'dock'" class="dock-funding" type="button" @click="emit('support')">
        <span>Yearly costs</span><span>€{{ fundingRaised }} / €{{ fundingGoal }}</span><span class="mini-progress"><span :style="{ width: `${Math.round((fundingRaised / fundingGoal) * 100)}%` }"></span></span>
      </button>
    </div>

    <div class="dock-links">
      <button class="secondary-button" type="button" @click="emit('navigate', 'settings')">Settings</button>
      <button class="secondary-button" type="button" @click="emit('navigate', 'issues')">Help</button>
    </div>

    <div class="play-group">
      <div class="account-picker">
        <button class="account-picker-button" type="button" :aria-expanded="menuOpen" aria-controls="quick-start-list" @click="emit('update:menu-open', !menuOpen)">
          <span class="account-mini-avatar"><PanelTopOpen aria-hidden="true" /></span>
          <span><small>Quick start</small><strong>{{ accountCountLabel() }}</strong></span>
          <ChevronUp aria-hidden="true" />
        </button>
        <div v-if="menuOpen" id="quick-start-list" class="account-menu" role="group" aria-label="Choose Quick start accounts">
          <div class="account-menu-heading"><strong>Quick start</strong><small>Choose the windows to open together.</small></div>
          <label v-for="account in accounts" :key="account.id" class="quick-account-option">
            <span class="account-mini-avatar">{{ account.initial }}</span>
            <span><strong>{{ account.name }}</strong><small>{{ account.status === "running" ? "Open" : "Ready" }}</small></span>
            <input type="checkbox" :checked="account.quickStart" :aria-label="`Include ${account.name} in Quick start`" @change="emit('toggleAccount', account.id)" />
          </label>
          <button type="button" class="manage-accounts" @click="emit('navigate', 'accounts')"><Settings aria-hidden="true" />Manage accounts</button>
        </div>
      </div>
      <button class="primary-button play-button" type="button" @click="emit('quickStart')"><Play aria-hidden="true" />Quick start</button>
    </div>
  </footer>
</template>
