<script setup lang="ts">
import { LogIn, PanelTopOpen, PanelsTopLeft, Play, ShieldCheck, UserPlus } from "@lucide/vue";
import type { Account, LauncherSettings } from "../model";

defineProps<{
  accounts: Account[];
  settings: LauncherSettings;
  selectedAccountId: string;
}>();

const emit = defineEmits<{
  add: [];
  launch: [accountId: string];
  select: [accountId: string];
  stop: [accountId: string];
  "update:multiple-windows": [enabled: boolean];
}>();
</script>

<template>
  <div class="section-layout accounts-layout">
    <aside class="section-sidebar account-sidebar">
      <span class="eyebrow">Launcher</span>
      <h1>Accounts</h1>
      <p>Start every account from this launcher. Each account opens in its own game window.</p>
      <button class="secondary-button add-account-button" type="button" @click="emit('add')">
        <UserPlus aria-hidden="true" />
        Add account
      </button>
    </aside>
    <section class="section-content accounts-screen">
      <div class="content-heading">
        <div><span class="eyebrow">Accounts</span><h1>Choose an account</h1><p>You do not need another launcher. Start, stop, and switch between game windows here.</p></div>
      </div>

      <section class="multi-window-setting">
        <div class="setting-icon"><PanelsTopLeft aria-hidden="true" /></div>
        <div>
          <strong>Multiple game windows</strong>
          <p>Allow more than one account to run at the same time. This change applies immediately.</p>
        </div>
        <input
          class="switch"
          type="checkbox"
          :checked="settings.multipleWindows"
          aria-label="Multiple game windows"
          @change="emit('update:multiple-windows', ($event.target as HTMLInputElement).checked)"
        />
      </section>

      <div class="account-grid">
        <article
          v-for="account in accounts"
          :key="account.id"
          class="account-card"
          :class="{ selected: selectedAccountId === account.id, running: account.status === 'running' }"
        >
          <button class="account-card-main" type="button" @click="emit('select', account.id)">
            <span class="account-avatar">{{ account.initial }}</span>
            <span class="account-copy">
              <strong>{{ account.name }}</strong>
              <small>{{ account.note }}</small>
            </span>
            <span class="account-state" :class="account.status">
              <span class="status-dot" :class="account.status === 'running' ? 'ready' : ''"></span>
              {{ account.status === "running" ? "Running" : account.status === "login-required" ? "Sign in required" : "Ready" }}
            </span>
          </button>
          <div class="account-actions">
            <button v-if="account.status === 'running'" class="secondary-button" type="button" @click="emit('stop', account.id)">Stop</button>
            <button class="primary-button" type="button" @click="emit('launch', account.id)">
              <PanelTopOpen v-if="account.status === 'running'" aria-hidden="true" />
              <LogIn v-else-if="account.status === 'login-required'" aria-hidden="true" />
              <Play v-else aria-hidden="true" />
              {{ account.status === "running" ? "Show game" : account.status === "login-required" ? "Sign in and play" : "Play" }}
            </button>
          </div>
        </article>
      </div>

      <section class="account-explainer">
        <ShieldCheck aria-hidden="true" />
        <div><strong>Accounts stay separate</strong><p>Each game window keeps its own login and settings. The launcher does not copy keyboard or mouse input between accounts.</p></div>
      </section>
    </section>
  </div>
</template>
