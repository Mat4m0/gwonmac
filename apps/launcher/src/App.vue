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
  Flame,
  Home,
  MessageSquareText,
  Map as MapIcon,
  Newspaper,
  Play,
  Plus,
  RotateCcw,
  ScrollText,
  Settings,
  Shield,
  SlidersHorizontal,
  Swords,
  Star,
  Crown,
  Users,
  Wrench,
  X,
} from "lucide-vue-next";
import type { LauncherSnapshot } from "@shared/launcher-contracts";
import type { GlobalTool, LauncherPreferencesPatch, LauncherSettingsPatch } from "@shared/launcher-contracts";
import { shortcutDisplay } from "@shared/keyboard-shortcuts";
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
const appearanceProfile = ref<ProfileId | null>(null);
const appearanceIcon = ref("swords");
const appearanceColor = ref("#9a6638");
const pickerOpen = ref(false);
const newName = ref("");
const busy = ref(false);
const setupStep = ref<1 | 2>(1);
const introStep = ref(0);
const shortcutMessage = ref("");
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
    if (!next.preferences.content[contentTab.value]) contentTab.value = next.preferences.content.first;
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
const preparationPercent = computed(() => {
  if (snapshot.value.readiness.state !== "preparing") return 0;
  const { received, total } = snapshot.value.readiness.progress;
  return total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
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

function editAppearance(profile: LauncherSnapshot["profiles"][number]) {
  appearanceProfile.value = profile.id;
  appearanceIcon.value = profile.appearance.icon;
  appearanceColor.value = profile.appearance.color;
}

async function saveAppearance() {
  if (!appearanceProfile.value) return;
  await native?.profiles.updateAppearance({ id: appearanceProfile.value, icon: appearanceIcon.value, color: appearanceColor.value });
  appearanceProfile.value = null;
}

function openSettings(section: SettingsRoute = "general") {
  settingsRoute.value = section;
  route.value = "settings";
}

const toolLabels: Readonly<Record<GlobalTool, string>> = {
  "build-management": "Build Management",
  "quick-travel": "Quick Travel",
  "xunlai-storage": "Xunlai Storage",
};
const profileIcons = { swords: Swords, archive: Archive, map: MapIcon, scroll: ScrollText, shield: Shield, star: Star, crown: Crown, flame: Flame } as const;

function checked(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked;
}

async function completeSetup(enableTools: boolean) {
  if (native) await native.experience.completeSetup({ enableTools });
  else snapshot.value = { ...snapshot.value, experience: { ...snapshot.value.experience, setup: "complete" } };
}

async function updateContent(content: NonNullable<LauncherPreferencesPatch["content"]>) {
  await native?.experience.updatePreferences({ content });
  if (!native) snapshot.value = { ...snapshot.value, preferences: { content: { ...snapshot.value.preferences.content, ...content } } };
}

async function updateLauncherSettings(patch: LauncherSettingsPatch) {
  await native?.settings.update(patch);
}

async function setTool(tool: GlobalTool, enabled: boolean) {
  await native?.tools.setFeature({ tool, enabled });
}

async function captureToolShortcut(tool: GlobalTool) {
  shortcutMessage.value = `Press a shortcut for ${toolLabels[tool]}. Escape cancels.`;
  const result = await native?.tools.captureShortcut(tool);
  if (!result) return;
  if (result.status === "captured") {
    await native?.tools.replaceShortcut({ tool, binding: result.binding });
    shortcutMessage.value = "Shortcut saved.";
  } else if (result.status === "reserved") shortcutMessage.value = "That shortcut is used by macOS or this application.";
  else if (result.status === "conflict") shortcutMessage.value = `That shortcut is already used by ${toolLabels[result.tool]}.`;
  else if (result.status === "invalid") shortcutMessage.value = "Use Command with a letter or number.";
  else shortcutMessage.value = "Shortcut change cancelled.";
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
        <button class="help-button" @click="native?.experience.replayIntroduction()"><CircleHelp />Show introduction</button>
        <span class="unofficial">Unofficial client</span>
      </div>
    </header>

    <section v-if="snapshot.readiness.state === 'repair-required'" class="priority-banner danger">
      <AlertTriangle /><div><strong>Game files need repair</strong><span>Guild Wars cannot start until the client is ready.</span></div>
      <button @click="openSettings('game-files')">Open Game Files</button>
    </section>
    <section v-else-if="snapshot.readiness.state === 'preparing'" class="priority-banner">
      <Clock3 /><div><strong>Preparing Guild Wars · {{ preparationPercent }}%</strong><span>{{ snapshot.readiness.progress.label }}</span></div>
      <button v-if="waiting" @click="primaryAction">Cancel waiting</button><button v-else @click="openSettings('game-files')">View download</button>
    </section>
    <section v-else-if="snapshot.appUpdate.phase === 'ready'" class="priority-banner">
      <RotateCcw /><div><strong>An update is ready</strong><span>Install it when you are finished playing.</span></div>
      <button @click="native?.updates.restartAndInstall()">Restart and update</button>
    </section>
    <section v-else-if="snapshot.readiness.state === 'offline-playable'" class="priority-banner"><AlertTriangle /><div><strong>You are offline</strong><span>You can play with the game files already on this Mac.</span></div></section>
    <section v-else-if="snapshot.readiness.state === 'playable' && snapshot.readiness.backgroundDownload?.status === 'running'" class="priority-banner"><Clock3 /><div><strong>Downloading game files</strong><span>You can play while this downloads.</span></div><button @click="openSettings('game-files')">View download</button></section>
    <section v-else class="funding-banner">
      <div><strong>Help cover the yearly costs</strong><span>Apple Developer Program, domain, and hosting</span></div>
      <div class="funding-progress"><span>{{ fixtureContent ? '€42 raised' : 'Yearly cost' }}</span><div><i :style="{ width: fixtureContent ? '34%' : '0%' }" /></div><span>€125 goal</span></div>
      <button @click="native?.external.open('donate')">Support project</button>
    </section>

    <main :class="{ 'artwork-only': route === 'home' && !snapshot.preferences.content.news && !snapshot.preferences.content.dailies }">
      <template v-if="route === 'home'">
        <section class="hero-panel">
          <div class="hero-copy">
            <span class="eyebrow">Guild Wars · August 29</span>
            <h1>Wayfarer’s Reverie starts Tuesday.</h1>
            <p>The event includes quests across Tyria, Cantha, and Elona.</p>
            <button class="text-link">Read update <ExternalLink /></button>
          </div>
        </section>
        <section v-if="snapshot.preferences.content.news || snapshot.preferences.content.dailies" class="home-panel">
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
            <div class="avatar" :style="{ background: profile.appearance.color }"><component :is="profileIcons[profile.appearance.icon as keyof typeof profileIcons] ?? Swords" /></div>
            <div><h3>{{ profile.name }}</h3><p>{{ profile.state === 'running' ? 'Open' : profile.state === 'failed' ? 'Could not open' : 'Ready' }}</p></div>
            <span class="status-dot" :class="profile.state" />
            <div class="account-actions"><button class="secondary" @click="editAppearance(profile)"><Settings />Customize</button><button v-if="profile.state === 'running'" class="secondary" @click="native?.profiles.show(profile.id)">Show</button><template v-else><button v-if="profile.id !== visibleProfiles[0]?.id" class="text-link" @click="native?.profiles.archive(profile.id)">Archive</button><button class="secondary" @click="native?.profiles.play([profile.id])"><Play />Play</button></template></div>
          </article>
        </div>
        <details v-if="snapshot.profiles.some(profile => profile.archived)" class="archived-accounts"><summary>Archived accounts</summary><article v-for="profile in snapshot.profiles.filter(candidate => candidate.archived)" :key="profile.id"><span>{{ profile.name }}</span><button class="secondary" @click="native?.profiles.restore(profile.id)">Restore</button><button class="danger-button" @click="native?.profiles.delete(profile.id)">Delete permanently</button></article></details>
      </section>

      <section v-else-if="route === 'issues'" class="page">
        <div class="page-head"><div><span class="eyebrow">Support</span><h1>Known issues</h1><p>Current game and macOS issues, with workarounds when we have one.</p></div></div>
        <div v-if="snapshot.contentAvailability.knownIssues === 'placeholder'" class="empty-state"><AlertTriangle /><h3>Known Issues are not connected yet.</h3><p>Check GitHub or Discord for current reports and workarounds.</p><div class="form-actions"><button class="secondary" @click="native?.external.open('discord')">Open Discord</button><button class="primary" @click="native?.external.open('github')">Open GitHub</button></div></div>
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
          <div class="form-actions"><button class="secondary" @click="native?.external.open('discord')">Open Discord</button><button class="primary" @click="native?.external.open('bugReport')">Open GitHub issue</button></div>
        </form>
      </section>

      <section v-else class="settings-page">
        <aside><h2>Settings</h2><button v-for="item in (['general', 'content', 'tools', 'game-files', 'advanced'] as SettingsRoute[])" :key="item" :class="{ active: settingsRoute === item }" @click="settingsRoute = item">{{ item.replace('-', ' ') }}</button></aside>
        <div class="settings-content">
          <template v-if="settingsRoute === 'general'"><h1>General</h1><div class="setting-group"><label><span><strong>Automatic updates</strong><small>Keep Guild Wars Reforged up to date.</small></span><input type="checkbox" :checked="snapshot.settings.autoCheckUpdates" @change="updateLauncherSettings({ autoCheckUpdates: checked($event) })" /></label><label><span><strong>Update channel</strong><small>Stable is recommended.</small></span><select :value="snapshot.settings.updateTrack" @change="updateLauncherSettings({ updateTrack: ($event.currentTarget as HTMLSelectElement).value as 'stable' | 'beta' })"><option value="stable">Stable</option><option value="beta">Beta</option></select></label></div></template>
          <template v-else-if="settingsRoute === 'content'"><h1>Content</h1><div class="setting-group"><label><span><strong>News</strong><small>Official Guild Wars and Reforged updates.</small></span><input type="checkbox" :checked="snapshot.preferences.content.news" @change="updateContent({ news: checked($event) })" /></label><label><span><strong>Dailies</strong><small>Daily activities and the weekly schedule.</small></span><input type="checkbox" :checked="snapshot.preferences.content.dailies" @change="updateContent({ dailies: checked($event) })" /></label><label v-if="snapshot.preferences.content.news && snapshot.preferences.content.dailies"><span><strong>First Home tab</strong></span><select :value="snapshot.preferences.content.first" @change="updateContent({ first: ($event.currentTarget as HTMLSelectElement).value as 'news' | 'dailies' })"><option value="news">News</option><option value="dailies">Dailies</option></select></label><label v-if="snapshot.preferences.content.news"><span><strong>Official Guild Wars news</strong></span><input type="checkbox" :checked="snapshot.preferences.content.officialNews" @change="updateContent({ officialNews: checked($event) })" /></label><label v-if="snapshot.preferences.content.news"><span><strong>Guild Wars Reforged news</strong></span><input type="checkbox" :checked="snapshot.preferences.content.reforgedNews" @change="updateContent({ reforgedNews: checked($event) })" /></label></div></template>
          <template v-else-if="settingsRoute === 'tools'"><h1>Tools</h1><p>Tools apply to every account.</p><div class="setting-group"><label><span><strong>Enable Tools</strong><small>Build Management, Quick Travel, and Xunlai Storage.</small></span><input type="checkbox" :checked="snapshot.tools.configured" @change="native?.tools.setMasterEnabled(checked($event))" /></label><div v-for="(setting, tool) in snapshot.tools.features" :key="tool" class="tool-row"><label><span><strong>{{ toolLabels[tool] }}</strong><small>{{ shortcutDisplay(setting.shortcut) }}</small></span><input type="checkbox" :checked="setting.enabled" :disabled="!snapshot.tools.configured" @change="setTool(tool, checked($event))" /></label><div><button class="secondary" @click="captureToolShortcut(tool)">Change shortcut</button><button class="text-link" @click="native?.tools.restoreDefaultShortcut(tool)">Restore default</button></div></div><p v-if="shortcutMessage" class="inline-message" aria-live="polite">{{ shortcutMessage }}</p><div v-if="snapshot.tools.restartRequired" class="restart-row"><span><strong>Restart needed</strong><small>Your change is saved.</small></span><button v-if="!visibleProfiles.some(profile => profile.state === 'running')" class="primary" @click="native?.tools.restartToApply()">Restart launcher</button><span v-else>Applies after your next normal restart.</span></div></div></template>
          <template v-else-if="settingsRoute === 'game-files'"><h1>Game files</h1><div class="setting-group"><div class="setting-row"><span><strong>Guild Wars client</strong><small>Verified and ready to play.</small></span><span class="good">{{ snapshot.readiness.state === 'repair-required' ? 'Needs repair' : 'Ready' }}</span></div><button class="secondary" @click="native?.gameFiles.repair()"><Wrench />Repair game files</button><button v-if="snapshot.readiness.state === 'playable' && snapshot.readiness.backgroundDownload?.status === 'running'" class="secondary" @click="native?.gameFiles.pauseDownload()">Pause background download</button><button v-else class="secondary" @click="native?.gameFiles.resumeDownload()">Resume background download</button><details><summary>Advanced</summary><button class="danger-button" @click="native?.gameFiles.resetAndRestart()">Reset and redownload game files</button><p>Profiles, logins, settings, Tools, shortcuts, builds, templates, screenshots, and chat logs are kept.</p></details></div></template>
          <template v-else><h1>Advanced</h1><div class="setting-group"><label><span><strong>Extended memory</strong><small>Allow longer sessions to use more memory.</small></span><input type="checkbox" :checked="snapshot.settings.extendedMemoryEnabled" @change="updateLauncherSettings({ extendedMemoryEnabled: checked($event) })" /></label><label><span><strong>Diagnostics</strong><small>Collect more local troubleshooting data.</small></span><input type="checkbox" :checked="snapshot.settings.showDiagnostics" @change="updateLauncherSettings({ showDiagnostics: checked($event) })" /></label><button class="secondary" @click="native?.external.revealLogs()"><FileText />Open logs</button><button class="danger-button" @click="native?.settings.reset()">Reset launcher settings</button></div></template>
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

    <div v-if="appearanceProfile" class="modal-backdrop" @click.self="appearanceProfile = null">
      <form class="modal" @submit.prevent="saveAppearance"><div class="modal-head"><h2>Account appearance</h2><button type="button" class="icon-button" aria-label="Close" @click="appearanceProfile = null"><X /></button></div><p>Choose a simple icon and color for this account.</p><fieldset class="icon-options"><legend>Icon</legend><button v-for="(component, icon) in profileIcons" :key="icon" type="button" :aria-label="icon" :class="{ selected: appearanceIcon === icon }" @click="appearanceIcon = icon"><component :is="component" /></button></fieldset><fieldset class="color-options"><legend>Color</legend><button v-for="color in ['#9a6638', '#496b58', '#46658a', '#76558b', '#9a4f4f', '#76703c', '#4c777d', '#6f6258']" :key="color" type="button" :aria-label="`Use ${color}`" :class="{ selected: appearanceColor === color }" :style="{ background: color }" @click="appearanceColor = color" /><label>Custom color<input v-model="appearanceColor" type="color" /></label></fieldset><div class="form-actions"><button type="button" class="secondary" @click="appearanceProfile = null">Cancel</button><button class="primary">Save</button></div></form>
    </div>

    <div v-if="snapshot.experience.showMigrationNotice" class="toast"><Check /><div><strong>{{ snapshot.experience.installationKind === 'migrated-single' ? 'Your existing account is ready.' : 'Your accounts are ready.' }}</strong><span>We kept your saved login, settings, builds, templates, and game files.</span></div><button class="icon-button" aria-label="Dismiss" @click="native?.experience.dismissMigrationNotice()"><X /></button></div>

    <div v-if="snapshot.experience.setup === 'pending'" class="modal-backdrop setup-backdrop">
      <section class="modal setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <template v-if="setupStep === 1"><span class="eyebrow">Welcome</span><h2 id="setup-title">Welcome to Guild Wars Reforged</h2><p>Guild Wars Reforged runs Guild Wars on your Mac. It is an unofficial community project and is not affiliated with ArenaNet or NCSOFT.</p><div class="form-actions"><button class="primary" @click="setupStep = 2">Continue</button></div></template>
        <template v-else><span class="eyebrow">Optional</span><h2 id="setup-title">Optional Tools</h2><p>Build Management saves team builds. Quick Travel opens a map search. Xunlai Storage opens storage in supported outposts.</p><p><strong>Tools apply to every account.</strong></p><div class="form-actions spread"><button class="secondary" @click="setupStep = 1">Back</button><span /><button class="secondary" @click="completeSetup(false)">Not now</button><button class="primary" @click="completeSetup(true)">Enable Tools</button></div></template>
      </section>
    </div>

    <div v-else-if="snapshot.experience.introduction === 'pending'" class="intro-callout" :class="`step-${introStep}`" role="dialog" aria-label="Launcher introduction" @keydown.esc="native?.experience.completeIntroduction()">
      <span>{{ introStep + 1 }} of 3</span>
      <strong>{{ ['Choose the accounts to open', 'Read news or check dailies', 'Find help and report problems'][introStep] }}</strong>
      <p>{{ ['The launcher remembers your selection.', 'You can hide either section in Content settings.', 'Known Issues shows workarounds. Feedback opens the current support channels.'][introStep] }}</p>
      <div class="form-actions"><button class="text-link" @click="native?.experience.completeIntroduction()">Skip</button><button v-if="introStep > 0" class="secondary" @click="introStep -= 1">Back</button><button class="primary" @click="introStep === 2 ? native?.experience.completeIntroduction() : introStep += 1">{{ introStep === 2 ? 'Done' : 'Next' }}</button></div>
    </div>
  </div>
</template>
