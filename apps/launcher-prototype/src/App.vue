<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { X } from "@lucide/vue";
import AccountsView from "./views/AccountsView.vue";
import HomeView from "./views/HomeView.vue";
import IssuesView from "./views/IssuesView.vue";
import NewsView from "./views/NewsView.vue";
import SettingsView from "./views/SettingsView.vue";
import AppHeader from "./components/AppHeader.vue";
import BaseModal from "./components/BaseModal.vue";
import FundingProgress from "./components/FundingProgress.vue";
import LaunchDock from "./components/LaunchDock.vue";
import PrototypeToolbar from "./components/PrototypeToolbar.vue";
import StatusBanner from "./components/StatusBanner.vue";
import { useLauncher } from "./composables/useLauncher";
import type { FundingPlacement, Scenario, SettingsSection } from "./model";

const {
  accounts,
  accountMenuOpen,
  addAccount,
  addAccountOpen,
  fundingGoal,
  fundingOpen,
  fundingPlacement,
  fundingRaised,
  launchAccount,
  launchQuickStart,
  navigate,
  quickStartAccounts,
  reset,
  route,
  runningAccounts,
  scenario,
  settings,
  settingsSection,
  showToast,
  stopAccount,
  toggleQuickStart,
  toast,
} = useLauncher();

const activeArticleId = ref("event");
const newAccountName = ref("");
const launcherContent = ref<HTMLElement | null>(null);

const openArticle = (articleId: string) => {
  activeArticleId.value = articleId;
  navigate("news");
};

const submitNewAccount = () => {
  if (!newAccountName.value.trim()) return;
  addAccount(newAccountName.value);
  newAccountName.value = "";
};

const saveSettings = () => showToast("Settings saved.");
const resetContentScroll = async () => {
  await nextTick();
  launcherContent.value?.scrollTo({ top: 0 });
};

const setSettingsSection = async (section: SettingsSection) => {
  settingsSection.value = section;
  await resetContentScroll();
};

watch(route, async () => {
  await resetContentScroll();
});
</script>

<template>
  <a class="skip-link" href="#launcher-content">Skip to content</a>
  <PrototypeToolbar
    :scenario="scenario"
    :funding-placement="fundingPlacement"
    @update:scenario="scenario = $event as Scenario"
    @update:funding-placement="fundingPlacement = $event as FundingPlacement"
    @reset="reset"
  />

  <div class="stage">
    <section class="launcher-window" aria-label="Guild Wars Reforged launcher prototype">
      <div class="world-background" aria-hidden="true"></div>
      <AppHeader
        :active-route="route"
        :running-count="runningAccounts.length"
        @navigate="navigate"
        @refresh="showToast('News and status are up to date.')"
      />
      <StatusBanner :scenario="scenario" @navigate="navigate" />
      <FundingProgress
        v-if="fundingPlacement === 'bar'"
        class="funding-bar"
        :raised="fundingRaised"
        :goal="fundingGoal"
        @support="fundingOpen = true"
      />

      <main id="launcher-content" ref="launcherContent" class="launcher-content" tabindex="-1">
        <HomeView
          v-if="route === 'home'"
          :scenario="scenario"
          :funding-placement="fundingPlacement"
          :funding-raised="fundingRaised"
          :funding-goal="fundingGoal"
          :settings="settings"
          @navigate="navigate"
          @open-article="openArticle"
          @open-home-settings="settingsSection = 'home'; navigate('settings')"
          @support="fundingOpen = true"
        />
        <NewsView v-else-if="route === 'news'" :key="activeArticleId" :initial-article-id="activeArticleId" :settings="settings" @open-settings="settingsSection = 'home'; navigate('settings')" />
        <SettingsView
          v-else-if="route === 'settings'"
          v-model:settings="settings"
          :active-section="settingsSection"
          @update:active-section="setSettingsSection($event as SettingsSection)"
          @save="saveSettings"
        />
        <IssuesView v-else-if="route === 'issues'" :scenario="scenario" @section-change="resetContentScroll" />
        <AccountsView
          v-else
          :accounts="accounts"
          @add="addAccountOpen = true"
          @launch="launchAccount"
          @quick-start="launchQuickStart"
          @stop="stopAccount"
          @toggle-quick-start="toggleQuickStart"
        />
      </main>

      <LaunchDock
        :accounts="accounts"
        :quick-start-count="quickStartAccounts.length"
        :running-count="runningAccounts.length"
        :scenario="scenario"
        :menu-open="accountMenuOpen"
        :funding-placement="fundingPlacement"
        :funding-raised="fundingRaised"
        :funding-goal="fundingGoal"
        @quick-start="launchQuickStart"
        @navigate="navigate"
        @toggle-account="toggleQuickStart"
        @update:menu-open="accountMenuOpen = $event"
        @support="fundingOpen = true"
      />

      <div class="toast-region" role="status" aria-live="polite" aria-atomic="true">
        <div v-if="toast" class="toast">{{ toast }}</div>
      </div>

      <BaseModal v-if="fundingOpen" title="Yearly project costs" @close="fundingOpen = false">
        <button class="modal-close" type="button" aria-label="Close" @click="fundingOpen = false"><X aria-hidden="true" /></button>
        <span class="eyebrow">Yearly costs</span>
        <h1>Help keep the project running</h1>
        <p>Guild Wars Reforged for macOS costs about €125 per year to maintain.</p>
        <dl class="cost-list">
          <div><dt>Apple Developer Program</dt><dd>about €100</dd></div>
          <div><dt>Domain</dt><dd>€20</dd></div>
          <div><dt>Hosting</dt><dd>€5</dd></div>
          <div class="total"><dt>Total</dt><dd>about €125</dd></div>
        </dl>
        <p>Support is optional. The launcher and the game work the same either way.</p>
        <div class="modal-actions"><button class="secondary-button" type="button" @click="fundingOpen = false">Close</button><button class="primary-button" type="button" @click="fundingOpen = false; showToast('This would open the project support page.')">Open support page</button></div>
      </BaseModal>

      <BaseModal v-if="addAccountOpen" title="Add an account" @close="addAccountOpen = false">
        <button class="modal-close" type="button" aria-label="Close" @click="addAccountOpen = false"><X aria-hidden="true" /></button>
        <span class="eyebrow">Accounts</span>
        <h1>Add an account</h1>
        <p>Give this game window a name so you can find it in Quick start.</p>
        <form class="account-form" @submit.prevent="submitNewAccount">
          <label for="account-name">Account name</label>
          <input id="account-name" v-model="newAccountName" name="account-name" autocomplete="off" placeholder="Storage account" required />
          <div class="modal-actions"><button class="secondary-button" type="button" @click="addAccountOpen = false">Cancel</button><button class="primary-button" type="submit">Add account</button></div>
        </form>
      </BaseModal>
    </section>
  </div>
</template>
