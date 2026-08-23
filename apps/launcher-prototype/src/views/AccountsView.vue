<script setup lang="ts">
import { PanelTopOpen, Pencil, Play, ShieldCheck, UserPlus, Zap } from "@lucide/vue";
import AccountAvatar from "../components/AccountAvatar.vue";
import type { Account } from "../model";

defineProps<{ accounts: Account[] }>();

const emit = defineEmits<{
  add: [];
  edit: [accountId: string];
  launch: [accountId: string];
  quickStart: [];
  stop: [accountId: string];
  toggleQuickStart: [accountId: string];
}>();
</script>

<template>
  <div class="section-layout accounts-layout">
    <aside class="section-sidebar account-sidebar">
      <span class="eyebrow">Launcher</span>
      <h1>Accounts</h1>
      <p>Add an account when you want another game window. There is no separate mode or launcher.</p>
      <button class="secondary-button add-account-button" type="button" @click="emit('add')"><UserPlus aria-hidden="true" />Add account</button>
    </aside>

    <section class="section-content accounts-screen">
      <div class="content-heading account-heading">
        <div><span class="eyebrow">Accounts</span><h1>Game windows</h1><p>Start one account or open your usual set with Quick start.</p></div>
        <button class="primary-button" type="button" @click="emit('quickStart')"><Zap aria-hidden="true" />Quick start</button>
      </div>

      <section class="quick-start-panel">
        <div class="setting-icon"><Zap aria-hidden="true" /></div>
        <div><strong>Quick start session</strong><p>Select the accounts that should open together. You can change this at any time.</p></div>
        <span>{{ accounts.filter((account) => account.quickStart).length }} selected</span>
      </section>

      <div class="account-grid">
        <article v-for="account in accounts" :key="account.id" class="account-card" :class="{ running: account.status === 'running' }">
          <div class="account-card-main">
            <AccountAvatar :icon="account.icon" :color="account.color" />
            <span class="account-copy"><strong>{{ account.name }}</strong><small>{{ account.note }}</small></span>
            <span class="account-state" :class="account.status"><span class="status-dot" :class="account.status === 'running' ? 'ready' : ''"></span>{{ account.status === "running" ? "Open" : "Ready" }}</span>
          </div>
          <div class="account-card-footer">
            <label class="quick-start-choice"><input type="checkbox" :checked="account.quickStart" @change="emit('toggleQuickStart', account.id)" />Include in Quick start</label>
            <div class="account-actions">
              <button class="secondary-button" type="button" @click="emit('edit', account.id)"><Pencil aria-hidden="true" />Customize</button>
              <button v-if="account.status === 'running'" class="secondary-button" type="button" @click="emit('stop', account.id)">Stop</button>
              <button class="primary-button" type="button" @click="emit('launch', account.id)"><PanelTopOpen v-if="account.status === 'running'" aria-hidden="true" /><Play v-else aria-hidden="true" />{{ account.status === "running" ? "Show game" : "Play" }}</button>
            </div>
          </div>
        </article>
      </div>

      <section class="account-explainer">
        <ShieldCheck aria-hidden="true" />
        <div><strong>Each account stays separate</strong><p>Each account opens in its own game window. Guild Wars handles sign-in inside that window.</p></div>
      </section>
    </section>
  </div>
</template>
