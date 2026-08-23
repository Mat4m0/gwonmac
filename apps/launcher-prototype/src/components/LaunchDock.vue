<script setup lang="ts">
import { Check, ChevronUp, PanelTopOpen, Play, Settings } from "@lucide/vue";
import type { Account, FundingPlacement, RouteName, Scenario } from "../model";

const props = defineProps<{
  accounts: Account[];
  selectedAccount: Account;
  runningCount: number;
  scenario: Scenario;
  menuOpen: boolean;
  fundingPlacement: FundingPlacement;
  fundingRaised: number;
  fundingGoal: number;
}>();

const emit = defineEmits<{
  launch: [accountId: string];
  navigate: [route: RouteName];
  select: [accountId: string];
  "update:menu-open": [value: boolean];
  support: [];
}>();

const playLabel = () => {
  if (props.selectedAccount.status === "running") return "Show Guild Wars";
  if (props.selectedAccount.status === "login-required") return "Sign in and play";
  if (props.scenario === "updating") return "Play while updating";
  return "Play";
};
</script>

<template>
  <footer class="launch-dock">
    <div class="dock-status">
      <div class="status-heading">
        <span class="status-dot" :class="scenario"></span>
        <strong>
          {{ runningCount ? `${runningCount} game ${runningCount === 1 ? "window" : "windows"} running` : scenario === "updating" ? "Updating Guild Wars" : "Ready to play" }}
        </strong>
      </div>
      <span>
        {{ scenario === "updating" ? "Downloading the latest game files" : runningCount ? "Choose an account to start or show its game window" : "Guild Wars and your enabled Tools are available" }}
      </span>
      <div v-if="scenario === 'updating'" class="progress-track update-progress" role="progressbar" aria-label="Game update" aria-valuenow="51" aria-valuemin="0" aria-valuemax="100">
        <span style="width: 51%"></span>
      </div>
      <button v-if="fundingPlacement === 'dock'" class="dock-funding" type="button" @click="emit('support')">
        <span>Yearly costs</span>
        <span>€{{ fundingRaised }} / €{{ fundingGoal }}</span>
        <span class="mini-progress"><span :style="{ width: `${Math.round((fundingRaised / fundingGoal) * 100)}%` }"></span></span>
      </button>
    </div>

    <div class="dock-links">
      <button class="secondary-button" type="button" @click="emit('navigate', 'settings')">Settings</button>
      <button class="secondary-button" type="button" @click="emit('navigate', 'issues')">Status</button>
    </div>

    <div class="play-group">
      <div class="account-picker">
        <button
          class="account-picker-button"
          type="button"
          :aria-expanded="menuOpen"
          aria-controls="account-picker-list"
          @click="emit('update:menu-open', !menuOpen)"
        >
          <span class="account-mini-avatar">{{ selectedAccount.initial }}</span>
          <span>
            <small>Play as</small>
            <strong>{{ selectedAccount.name }}</strong>
          </span>
          <ChevronUp aria-hidden="true" />
        </button>
        <div v-if="menuOpen" id="account-picker-list" class="account-menu" aria-label="Choose an account">
          <button
            v-for="account in accounts"
            :key="account.id"
            type="button"
            @click="emit('select', account.id)"
          >
            <span class="account-mini-avatar">{{ account.initial }}</span>
            <span>
              <strong>{{ account.name }}</strong>
              <small>{{ account.status === "running" ? "Running" : account.status === "login-required" ? "Sign in required" : "Ready" }}</small>
            </span>
            <Check v-if="account.id === selectedAccount.id" aria-hidden="true" />
          </button>
          <button type="button" class="manage-accounts" @click="emit('navigate', 'accounts')">
            <Settings aria-hidden="true" />
            Manage accounts
          </button>
        </div>
      </div>
      <button class="primary-button play-button" type="button" @click="emit('launch', selectedAccount.id)">
        <PanelTopOpen v-if="selectedAccount.status === 'running'" aria-hidden="true" />
        <Play v-else aria-hidden="true" />
        {{ playLabel() }}
      </button>
    </div>
  </footer>
</template>
