<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Check, X } from "@lucide/vue";
import AccountsView from "./views/AccountsView.vue";
import HomeView from "./views/HomeView.vue";
import IssuesView from "./views/IssuesView.vue";
import NewsView from "./views/NewsView.vue";
import SettingsView from "./views/SettingsView.vue";
import AppHeader from "./components/AppHeader.vue";
import AccountProfileModal from "./components/AccountProfileModal.vue";
import BaseModal from "./components/BaseModal.vue";
import FundingProgress from "./components/FundingProgress.vue";
import LaunchDock from "./components/LaunchDock.vue";
import PrototypeToolbar from "./components/PrototypeToolbar.vue";
import StatusBanner from "./components/StatusBanner.vue";
import { useLauncher } from "./composables/useLauncher";
import type { AccountProfile, FundingPlacement, Scenario, SettingsSection } from "./model";

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
  updateAccount,
} = useLauncher();

const activeArticleId = ref("event");
const editingAccountId = ref<string | null>(null);
const gameFilesOpen = ref(false);
const launcherContent = ref<HTMLElement | null>(null);
const editingAccount = computed(() =>
  accounts.value.find((account) => account.id === editingAccountId.value),
);

const openArticle = (articleId: string) => {
  activeArticleId.value = articleId;
  navigate("news");
};

const saveAccount = (profile: AccountProfile) => {
  if (editingAccountId.value) {
    updateAccount(editingAccountId.value, profile);
    editingAccountId.value = null;
    return;
  }
  addAccount(profile);
};

const redownloadGameFiles = () => {
  gameFilesOpen.value = false;
  scenario.value = "updating";
  showToast("Game files will be downloaded again.");
};
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
          @redownload-game-files="gameFilesOpen = true"
        />
        <IssuesView v-else-if="route === 'issues'" :scenario="scenario" @section-change="resetContentScroll" />
        <AccountsView
          v-else
          :accounts="accounts"
          @add="addAccountOpen = true"
          @edit="editingAccountId = $event"
          @launch="launchAccount"
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

      <BaseModal v-if="gameFilesOpen" title="Redownload game files" @close="gameFilesOpen = false">
        <span class="eyebrow">Game files</span>
        <h1>Redownload game files?</h1>
        <p>The launcher will replace only the downloaded Guild Wars game data with a fresh copy.</p>
        <section class="kept-data" aria-labelledby="kept-data-heading">
          <h2 id="kept-data-heading">Kept on your Mac</h2>
          <ul>
            <li><Check aria-hidden="true" />Account profiles and launcher settings</li>
            <li><Check aria-hidden="true" />Build templates and saved team builds</li>
            <li><Check aria-hidden="true" />Tool settings, shortcuts, and Quick Travel favorites</li>
            <li><Check aria-hidden="true" />Screenshots</li>
          </ul>
        </section>
        <div class="modal-actions">
          <button class="secondary-button" type="button" @click="gameFilesOpen = false">Cancel</button>
          <button class="danger-button" type="button" @click="redownloadGameFiles">Redownload files</button>
        </div>
      </BaseModal>

      <AccountProfileModal
        v-if="addAccountOpen"
        @close="addAccountOpen = false"
        @save="saveAccount"
      />
      <AccountProfileModal
        v-if="editingAccount"
        :account="editingAccount"
        @close="editingAccountId = null"
        @save="saveAccount"
      />
    </section>
  </div>
</template>
