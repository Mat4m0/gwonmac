<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileText,
  Home,
  MessageSquareText,
  Newspaper,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Swords,
  Users,
  Wrench,
  X,
} from "lucide-vue-next";
import type { LauncherSnapshot } from "@shared/launcher-contracts";
import type { ProfileId } from "@shared/multiple-accounts";
import { fixtureSnapshot } from "./fixtures";
import logoUrl from "@site/reforged-logo.webp";

type Route = "home" | "accounts" | "issues" | "feedback" | "settings";
type SettingsRoute = "general" | "content" | "tools" | "game-files" | "advanced";

const route = ref<Route>("home");
const settingsRoute = ref<SettingsRoute>("general");
const snapshot = ref<LauncherSnapshot>(fixtureSnapshot);
const selected = ref<ProfileId[]>([...snapshot.value.selectedProfileIds]);
const contentTab = ref<"news" | "dailies">(snapshot.value.preferences.content.first);
const addOpen = ref(false);
const pickerOpen = ref(false);
const newName = ref("");
const busy = ref(false);
let unsubscribe: (() => void) | undefined;

const native = window.launcherNative;
const fixtureContent = computed(() => snapshot.value.contentAvailability.news === "fixture");
onMounted(async () => {
  if (!native) return;
  const initial = await native.state.get();
  snapshot.value = initial;
  selected.value = [...initial.selectedProfileIds];
  contentTab.value = initial.preferences.content.first;
  unsubscribe = native.state.onChange((next) => {
    if (next.revision < snapshot.value.revision) return;
    snapshot.value = next;
    selected.value = [...next.selectedProfileIds];
  });
});
onBeforeUnmount(() => unsubscribe?.());

const visibleProfiles = computed(() => snapshot.value.profiles.filter((profile) => !profile.archived));
const selectedProfiles = computed(() => visibleProfiles.value.filter((profile) => selected.value.includes(profile.id)));
const openSelected = computed(() => selectedProfiles.value.filter((profile) => profile.state === "running"));
const waiting = computed(() => selectedProfiles.value.some((profile) => profile.state === "queued"));
const primaryLabel = computed(() => {
  if (waiting.value) return "Cancel waiting";
  if (selectedProfiles.value.length === 1 && openSelected.value.length === 1) return "Show";
  return selectedProfiles.value.length > 1 ? `Open ${selectedProfiles.value.length} accounts` : "Play";
});
const readyText = computed(() => {
  const state = snapshot.value.readiness.state;
  if (state === "preparing") return "Preparing Guild Wars";
  if (state === "repair-required") return "Game files need repair";
  if (state === "offline-playable") return "Ready to play offline";
  return snapshot.value.readiness.backgroundDownload?.status === "running"
    ? "Ready to play · Downloading game files"
    : "Ready to play";
});

async function toggleProfile(id: ProfileId) {
  const next = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id];
  if (next.length === 0) return;
  selected.value = next;
  await native?.profiles.setSelection(next);
}

async function primaryAction() {
  if (busy.value || selected.value.length === 0) return;
  busy.value = true;
  try {
    if (waiting.value) await native?.profiles.cancelQueued(selected.value);
    else if (selectedProfiles.value.length === 1 && openSelected.value.length === 1) {
      await native?.profiles.show(selected.value[0]!);
    } else await native?.profiles.play(selected.value);
  } finally {
    busy.value = false;
  }
}

async function createProfile() {
  const name = newName.value.trim();
  if (!name) return;
  await native?.profiles.create({ name });
  newName.value = "";
  addOpen.value = false;
}

function openSettings(section: SettingsRoute = "general") {
  settingsRoute.value = section;
  route.value = "settings";
}
</script>

<template>
  <div class="app-shell">
    <header class="titlebar">
      <button class="brand" aria-label="Home" @click="route = 'home'">
        <img :src="logoUrl" alt="Guild Wars Reforged" />
      </button>
      <nav aria-label="Main navigation">
        <button :class="{ active: route === 'home' }" @click="route = 'home'"><Home />Home</button>
        <button :class="{ active: route === 'accounts' }" @click="route = 'accounts'"><Users />Accounts</button>
        <button :class="{ active: route === 'issues' }" @click="route = 'issues'"><AlertTriangle />Known issues</button>
        <button :class="{ active: route === 'feedback' }" @click="route = 'feedback'"><MessageSquareText />Feedback</button>
      </nav>
      <div class="title-actions">
        <button class="icon-button" aria-label="Settings" @click="openSettings()"><Settings /></button>
        <button class="help-button"><CircleHelp />Help<ChevronDown /></button>
        <span class="unofficial">Unofficial client</span>
      </div>
    </header>

    <section v-if="snapshot.readiness.state === 'repair-required'" class="priority-banner danger">
      <AlertTriangle /><div><strong>Game files need repair</strong><span>Guild Wars cannot start until the client is ready.</span></div>
      <button @click="openSettings('game-files')">Open Game Files</button>
    </section>
    <section v-else-if="snapshot.appUpdate.phase === 'ready'" class="priority-banner">
      <RotateCcw /><div><strong>An update is ready</strong><span>Install it when you are finished playing.</span></div>
      <button @click="native?.updates.restartAndInstall()">Restart and update</button>
    </section>
    <section v-else class="funding-banner">
      <div><strong>Help cover the yearly costs</strong><span>Apple Developer Program, domain, and hosting</span></div>
      <div class="funding-progress"><span>{{ fixtureContent ? '€42 raised' : 'Yearly cost' }}</span><div><i :style="{ width: fixtureContent ? '34%' : '0%' }" /></div><span>€125 goal</span></div>
      <button>Support project</button>
    </section>

    <main>
      <template v-if="route === 'home'">
        <section class="hero-panel">
          <div class="hero-copy">
            <span class="eyebrow">Guild Wars · August 29</span>
            <h1>Wayfarer’s Reverie starts Tuesday.</h1>
            <p>The event includes quests across Tyria, Cantha, and Elona.</p>
            <button class="text-link">Read update <ExternalLink /></button>
          </div>
        </section>
        <section class="home-panel">
          <div class="panel-head">
            <div v-if="snapshot.preferences.content.news && snapshot.preferences.content.dailies" class="segmented" role="tablist">
              <button :aria-selected="contentTab === 'news'" @click="contentTab = 'news'"><Newspaper />News</button>
              <button :aria-selected="contentTab === 'dailies'" @click="contentTab = 'dailies'"><Clock3 />Dailies</button>
            </div>
            <h2 v-else>{{ snapshot.preferences.content.news ? 'News' : 'Dailies' }}</h2>
            <button class="customize" @click="openSettings('content')"><SlidersHorizontal />Customize</button>
          </div>
          <div v-if="contentTab === 'news' && snapshot.contentAvailability.news === 'placeholder'" class="empty-state"><Newspaper /><h3>News is not connected yet.</h3><p>You can still read Guild Wars Reforged updates on the project website.</p></div>
          <div v-else-if="contentTab === 'news'" class="news-list">
            <article><span>Guild Wars</span><div><h3>Client stability update</h3><p>Fixed a cinematic crash and map reveal problems.</p></div><time>Aug 29</time></article>
            <article><span>Reforged</span><div><h3>The unified launcher is coming</h3><p>Accounts, Tools, downloads, and repair now live in one place.</p></div><time>New</time></article>
            <article><span>Issues</span><div><h3>Two known game issues</h3><p>Workarounds are available.</p></div><button @click="route = 'issues'">View</button></article>
          </div>
          <div v-else-if="snapshot.contentAvailability.dailies === 'placeholder'" class="empty-state"><Clock3 /><h3>Daily activities are not connected yet.</h3><p>Use the Guild Wars Wiki for the current schedule.</p></div>
          <div v-else class="daily-view">
            <div class="daily-date"><span>Today · Aug 29</span><strong>Changes in 5h 18m</strong><small>18:00 local time</small></div>
            <div class="daily-grid">
              <article v-for="daily in ['Gate of Pain', 'Zoldark the Unholy', 'Random Arena', 'Skyward Reach', 'Justiciar Marron', 'Footman Tate', 'Baked Husks']" :key="daily"><Swords /><div><small>Daily activity</small><strong>{{ daily }}</strong></div><ExternalLink /></article>
            </div>
            <button class="load-more">Show the next 7 days</button>
          </div>
        </section>
      </template>

      <section v-else-if="route === 'accounts'" class="page accounts-page">
        <div class="page-head"><div><span class="eyebrow">Accounts</span><h1>Game windows</h1><p>Add another account when you want another game window.</p></div><button class="secondary" @click="addOpen = true"><Plus />Add account</button></div>
        <div class="account-cards">
          <article v-for="profile in visibleProfiles" :key="profile.id" class="account-card">
            <div class="avatar" :style="{ background: profile.appearance.color }"><Archive v-if="profile.appearance.icon === 'archive'" /><Swords v-else /></div>
            <div><h3>{{ profile.name }}</h3><p>{{ profile.state === 'running' ? 'Open' : profile.state === 'failed' ? 'Could not open' : 'Ready' }}</p></div>
            <span class="status-dot" :class="profile.state" />
            <button v-if="profile.state === 'running'" class="secondary" @click="native?.profiles.show(profile.id)">Show</button>
            <button v-else class="secondary" @click="native?.profiles.play([profile.id])"><Play />Play</button>
          </article>
        </div>
      </section>

      <section v-else-if="route === 'issues'" class="page">
        <div class="page-head"><div><span class="eyebrow">Support</span><h1>Known issues</h1><p>Current game and macOS issues, with workarounds when we have one.</p></div></div>
        <div v-if="snapshot.contentAvailability.knownIssues === 'placeholder'" class="empty-state"><AlertTriangle /><h3>Known Issues are not connected yet.</h3><p>Check GitHub or Discord for current reports and workarounds.</p><div class="form-actions"><button class="secondary">Open Discord</button><button class="primary">Open GitHub</button></div></div>
        <div v-else class="issue-list">
          <article><AlertTriangle /><div><h3>Some textures may appear black</h3><p>Restart the affected game window. Your saved data is not affected.</p><button class="text-link">View workaround <ExternalLink /></button></div><span>Game</span></article>
          <article><AlertTriangle /><div><h3>Long sessions can use too much memory</h3><p>Close and reopen the game window when macOS shows a memory warning.</p></div><span>Game</span></article>
          <article class="resolved"><Check /><div><h3>Map reveal crash</h3><p>Fixed in the current launcher version.</p></div><span>Resolved</span></article>
        </div>
      </section>

      <section v-else-if="route === 'feedback'" class="page feedback-page">
        <div class="page-head"><div><span class="eyebrow">Feedback</span><h1>Tell us what happened</h1><p>Small reports are useful. You do not need to write a perfect bug report.</p></div></div>
        <form class="feedback-form" @submit.prevent>
          <label>What would you like to share?<textarea rows="6" placeholder="A short description is enough." /></label>
          <div class="form-row"><label>Type<select><option>Problem</option><option>Idea</option><option>Something else</option></select></label><label>Email (optional)<input type="email" placeholder="name@example.com" /></label></div>
          <button type="button" class="attachment"><Plus />Add screenshot or file</button>
          <p class="placeholder-note">Direct feedback is not connected yet. For now, continue on GitHub or Discord.</p>
          <div class="form-actions"><button class="secondary">Open Discord</button><button class="primary">Open GitHub issue</button></div>
        </form>
      </section>

      <section v-else class="settings-page">
        <aside><h2>Settings</h2><button v-for="item in (['general', 'content', 'tools', 'game-files', 'advanced'] as SettingsRoute[])" :key="item" :class="{ active: settingsRoute === item }" @click="settingsRoute = item">{{ item.replace('-', ' ') }}</button></aside>
        <div class="settings-content">
          <template v-if="settingsRoute === 'general'"><h1>General</h1><div class="setting-group"><label><span><strong>Automatic updates</strong><small>Keep Guild Wars Reforged up to date.</small></span><input type="checkbox" checked /></label><label><span><strong>Update channel</strong><small>Stable is recommended.</small></span><select><option>Stable</option><option>Beta</option></select></label></div></template>
          <template v-else-if="settingsRoute === 'content'"><h1>Content</h1><div class="setting-group"><label><span><strong>News</strong><small>Official Guild Wars and Reforged updates.</small></span><input type="checkbox" checked /></label><label><span><strong>Dailies</strong><small>Daily activities and the weekly schedule.</small></span><input type="checkbox" checked /></label><label><span><strong>First Home tab</strong></span><select><option>News</option><option>Dailies</option></select></label></div></template>
          <template v-else-if="settingsRoute === 'tools'"><h1>Tools</h1><p>Tools apply to every account.</p><div class="setting-group"><label><span><strong>Enable Tools</strong><small>Build Management, Quick Travel, and Xunlai Storage.</small></span><input type="checkbox" /></label><label v-for="tool in ['Build Management', 'Quick Travel', 'Xunlai Storage']" :key="tool"><span><strong>{{ tool }}</strong><small>Shortcut: Not set</small></span><button class="secondary">Change shortcut</button></label></div></template>
          <template v-else-if="settingsRoute === 'game-files'"><h1>Game files</h1><div class="setting-group"><div class="setting-row"><span><strong>Guild Wars client</strong><small>Verified and ready to play.</small></span><span class="good">Ready</span></div><button class="secondary"><Wrench />Repair game files</button><details><summary>Advanced</summary><button class="danger-button">Reset and redownload game files</button><p>Profiles, logins, settings, builds, templates, screenshots, and chat logs are kept.</p></details></div></template>
          <template v-else><h1>Advanced</h1><div class="setting-group"><label><span><strong>Extended memory</strong><small>Allow longer sessions to use more memory.</small></span><input type="checkbox" /></label><label><span><strong>Diagnostics</strong><small>Collect local troubleshooting data.</small></span><select><option>Standard</option><option>Detailed</option></select></label><button class="secondary"><FileText />Open logs</button><button class="danger-button">Reset launcher settings</button></div></template>
        </div>
      </section>
    </main>

    <footer class="launchbar" aria-live="polite">
      <div class="readiness"><span class="ready-dot" :class="snapshot.readiness.state" /><div><strong>{{ readyText }}</strong><small v-if="snapshot.readiness.state === 'playable'">Guild Wars and your enabled Tools are available.</small></div></div>
      <div class="picker-wrap">
        <button class="account-picker" :aria-expanded="pickerOpen" @click="pickerOpen = !pickerOpen"><Users /><span><small>Open</small><strong>{{ selectedProfiles.length }} {{ selectedProfiles.length === 1 ? 'account' : 'accounts' }}</strong></span><ChevronDown /></button>
        <div v-if="pickerOpen" class="profile-picker">
          <strong>Choose accounts</strong>
          <button v-for="profile in visibleProfiles" :key="profile.id" @click="toggleProfile(profile.id)">
            <span class="checkbox" :class="{ checked: selected.includes(profile.id) }"><Check v-if="selected.includes(profile.id)" /></span>
            <span><b>{{ profile.name }}</b><small>{{ profile.state === 'running' ? 'Open' : 'Ready' }}</small></span>
          </button>
          <button class="manage" @click="pickerOpen = false; route = 'accounts'"><Settings />Manage accounts</button>
        </div>
      </div>
      <button class="primary launch" :disabled="busy || selected.length === 0" @click="primaryAction"><X v-if="waiting" /><Play v-else />{{ primaryLabel }}</button>
    </footer>

    <div v-if="addOpen" class="modal-backdrop" @click.self="addOpen = false">
      <form class="modal" @submit.prevent="createProfile"><div class="modal-head"><h2>Add account</h2><button type="button" class="icon-button" aria-label="Close" @click="addOpen = false"><X /></button></div><p>This opens another separate Guild Wars window.</p><label>Name<input v-model="newName" autofocus maxlength="48" placeholder="Second account" /></label><details><summary>Appearance</summary><p>You can choose an icon and color after the account is added.</p></details><div class="form-actions"><button type="button" class="secondary" @click="addOpen = false">Cancel</button><button class="primary" :disabled="!newName.trim()">Add account</button></div></form>
    </div>

    <div v-if="snapshot.experience.showMigrationNotice" class="toast"><Check /><div><strong>{{ snapshot.experience.installationKind === 'migrated-single' ? 'Your existing account is ready.' : 'Your accounts are ready.' }}</strong><span>We kept your saved login, settings, builds, templates, and game files.</span></div><button class="icon-button" aria-label="Dismiss" @click="native?.experience.dismissMigrationNotice()"><X /></button></div>
  </div>
</template>
