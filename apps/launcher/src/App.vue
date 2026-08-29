<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
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
import type { CacheInfo } from "@shared/contracts";
import { shortcutDisplay } from "@shared/keyboard-shortcuts";
import type { ShortcutBinding } from "@shared/keyboard-shortcuts";
import type { ProfileId } from "@shared/multiple-accounts";
import { fixtureSnapshot } from "./fixtures";
import { cacheSummary, formatProgress, launchLabel, profileStatus, updateStatus } from "./launcher-view-model";
import BaseModal from "./components/BaseModal.vue";
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
const pendingShortcutReplacement = ref<{ tool: GlobalTool; binding: ShortcutBinding } | null>(null);
const preferencesResetDismissed = ref(false);
const updateBannerDismissed = ref(false);
const operationError = ref("");
const startupError = ref(false);
const gameFilesInfo = ref<CacheInfo | null>(null);
const gameFilesLoading = ref(false);
const weekExpanded = ref(false);
let unsubscribe: (() => void) | undefined;

const native = window.launcherNative;
const synchronized = ref(!native);
const fixtureContent = computed(() => snapshot.value.contentAvailability.news === "fixture");
onMounted(async () => {
  if (!native) return;
  try {
    const initial = await native.state.get();
    snapshot.value = initial;
    selected.value = [...initial.selectedProfileIds];
    contentTab.value = initial.preferences.content.first;
    synchronized.value = true;
    unsubscribe = native.state.onChange((next) => {
      if (next.revision < snapshot.value.revision) return;
      snapshot.value = next;
      selected.value = [...next.selectedProfileIds];
      if (!next.preferences.content[contentTab.value]) contentTab.value = next.preferences.content.first;
    });
  } catch {
    startupError.value = true;
  }
});
onBeforeUnmount(() => unsubscribe?.());

const visibleProfiles = computed(() => snapshot.value.profiles.filter((profile) => !profile.archived));
const selectedProfiles = computed(() => visibleProfiles.value.filter((profile) => selected.value.includes(profile.id)));
const openSelected = computed(() => selectedProfiles.value.filter((profile) => profile.state === "running"));
const closedSelected = computed(() => selectedProfiles.value.filter((profile) => profile.state !== "running"));
const waiting = computed(() => selectedProfiles.value.some((profile) => profile.state === "queued"));
const primaryLabel = computed(() => launchLabel(selectedProfiles.value, snapshot.value.readiness));
const updateCopy = computed(() => updateStatus(snapshot.value.appUpdate));
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
  await runAction("The account selection could not be saved.", () => native?.profiles.setSelection(next));
}

async function primaryAction() {
  if (busy.value || selected.value.length === 0) return;
  if (snapshot.value.readiness.state === "repair-required") {
    openSettings("game-files");
    return;
  }
  busy.value = true;
  try {
    if (waiting.value) await native?.profiles.cancelQueued([...selected.value]);
    else if (selectedProfiles.value.length === 1 && openSelected.value.length === 1) {
      await native?.profiles.show(selected.value[0]!);
    } else if (closedSelected.value.length > 0) await native?.profiles.play(closedSelected.value.map((profile) => profile.id));
  } catch {
    operationError.value = "Guild Wars could not be opened. Your account data was not changed. Try again.";
  } finally {
    busy.value = false;
  }
}

async function createProfile() {
  const name = newName.value.trim();
  if (!name) return;
  await runAction("The account could not be added. Try another name or try again.", async () => {
    await native?.profiles.create({ name });
    newName.value = "";
    addOpen.value = false;
  });
}

function editAppearance(profile: LauncherSnapshot["profiles"][number]) {
  appearanceProfile.value = profile.id;
  appearanceIcon.value = profile.appearance.icon;
  appearanceColor.value = profile.appearance.color;
}

async function saveAppearance() {
  if (!appearanceProfile.value) return;
  await runAction("The account appearance could not be saved.", async () => {
    await native?.profiles.updateAppearance({ id: appearanceProfile.value!, icon: appearanceIcon.value, color: appearanceColor.value });
    appearanceProfile.value = null;
  });
}

function openSettings(section: SettingsRoute = "general") {
  settingsRoute.value = section;
  route.value = "settings";
  if (section === "game-files") void loadGameFilesInfo();
}

function selectSettings(section: SettingsRoute) {
  settingsRoute.value = section;
  if (section === "game-files") void loadGameFilesInfo();
}

function retryStartup() {
  window.location.reload();
}

async function runAction(message: string, action: () => Promise<unknown> | undefined): Promise<boolean> {
  operationError.value = "";
  try {
    await action();
    return true;
  } catch {
    operationError.value = message;
    return false;
  }
}

async function loadGameFilesInfo() {
  if (!native) {
    gameFilesInfo.value = { bytes: 8_400_000_000, chunks: 4200, totalBytes: 9_100_000_000, totalChunks: 4550, freeBytes: 80_000_000_000, fullDownloadShortfall: 0 };
    return;
  }
  gameFilesLoading.value = true;
  await runAction("Game file details could not be loaded.", async () => {
    gameFilesInfo.value = await native.gameFiles.info();
  });
  gameFilesLoading.value = false;
}

async function runGameFilesAction(message: string, action: () => Promise<void> | undefined) {
  if (await runAction(message, action)) await loadGameFilesInfo();
}

function selectContentTab(tab: "news" | "dailies") {
  contentTab.value = tab;
}

async function moveContentTab(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  contentTab.value = contentTab.value === "news" ? "dailies" : "news";
  await nextTick();
  document.querySelector<HTMLElement>(`#${contentTab.value}-tab`)?.focus();
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
  if (native) {
    await runAction("Setup could not be saved. Try again.", () => native.experience.completeSetup({ enableTools }));
    return;
  }
  snapshot.value = { ...snapshot.value, experience: { ...snapshot.value.experience, setup: "complete" } };
}

async function updateContent(content: NonNullable<LauncherPreferencesPatch["content"]>) {
  await runAction("Content settings could not be saved.", () => native?.experience.updatePreferences({ content }));
  if (!native) snapshot.value = { ...snapshot.value, preferences: { content: { ...snapshot.value.preferences.content, ...content } } };
}

async function updateLauncherSettings(patch: LauncherSettingsPatch) {
  await runAction("This setting could not be saved.", () => native?.settings.update(patch));
}

async function setTool(tool: GlobalTool, enabled: boolean) {
  await runAction("The Tool setting could not be saved.", () => native?.tools.setFeature({ tool, enabled }));
}

async function captureToolShortcut(tool: GlobalTool) {
  pendingShortcutReplacement.value = null;
  shortcutMessage.value = `Press a shortcut for ${toolLabels[tool]}. Escape cancels.`;
  let result;
  try {
    result = await native?.tools.captureShortcut(tool);
  } catch {
    shortcutMessage.value = "The shortcut could not be changed. Try again.";
    return;
  }
  if (!result) return;
  if (result.status === "captured") {
    if (await runAction("The shortcut could not be saved.", () => native?.tools.replaceShortcut({ tool, binding: result.binding }))) shortcutMessage.value = "Shortcut saved.";
  } else if (result.status === "reserved") shortcutMessage.value = "That shortcut is used by macOS or this application.";
  else if (result.status === "conflict") {
    pendingShortcutReplacement.value = { tool, binding: result.binding };
    shortcutMessage.value = `That shortcut is already used by ${toolLabels[result.tool]}.`;
  }
  else if (result.status === "invalid") shortcutMessage.value = "Use Command with a letter or number.";
  else shortcutMessage.value = "Shortcut change cancelled.";
}

async function replaceToolShortcut() {
  const replacement = pendingShortcutReplacement.value;
  if (!replacement) return;
  if (await runAction("The shortcut could not be replaced.", () => native?.tools.replaceShortcut(replacement))) {
    pendingShortcutReplacement.value = null;
    shortcutMessage.value = "Shortcut replaced.";
  }
}
</script>

<template>
  <div v-if="startupError" class="launcher-boot launcher-error" role="alert"><AlertTriangle /><h1>The launcher could not open</h1><p>Your accounts and game files were not changed.</p><button class="primary" @click="retryStartup">Try again</button></div>
  <div v-else-if="!synchronized" class="launcher-boot" role="status">Opening launcher…</div>
  <div v-else class="app-shell">
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
    <section v-else-if="snapshot.appUpdate.phase === 'ready' && !updateBannerDismissed" class="priority-banner">
      <RotateCcw /><div><strong>An update is ready</strong><span>Install it when you are finished playing.</span></div>
      <div class="banner-actions"><button class="quiet-button" @click="updateBannerDismissed = true">Later</button><button @click="runAction('The update could not be installed.', () => native?.updates.restartAndInstall())">Restart and update</button></div>
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
        <section class="hero-panel" :class="{ 'hero-placeholder': !fixtureContent }">
          <div v-if="fixtureContent" class="hero-copy">
            <span class="eyebrow">Guild Wars · August 29</span>
            <h1>Wayfarer’s Reverie starts Tuesday.</h1>
            <p>The event includes quests across Tyria, Cantha, and Elona.</p>
            <button class="text-link" @click="contentTab = 'news'">Read update <ExternalLink /></button>
          </div>
          <div v-else class="hero-copy">
            <span class="eyebrow">Guild Wars Reforged</span>
            <h1>Your accounts. One launcher.</h1>
            <p>Updates, game files, Tools, and every Guild Wars window are managed here.</p>
          </div>
        </section>
        <section v-if="snapshot.preferences.content.news || snapshot.preferences.content.dailies" class="home-panel">
          <div class="panel-head">
            <div v-if="snapshot.preferences.content.news && snapshot.preferences.content.dailies" class="segmented" role="tablist" aria-label="Home content" @keydown="moveContentTab">
              <button id="news-tab" role="tab" :tabindex="contentTab === 'news' ? 0 : -1" :aria-selected="contentTab === 'news'" aria-controls="news-panel" @click="selectContentTab('news')"><Newspaper />News</button>
              <button id="dailies-tab" role="tab" :tabindex="contentTab === 'dailies' ? 0 : -1" :aria-selected="contentTab === 'dailies'" aria-controls="dailies-panel" @click="selectContentTab('dailies')"><Clock3 />Dailies</button>
            </div>
            <h2 v-else>{{ snapshot.preferences.content.news ? 'News' : 'Dailies' }}</h2>
            <button class="customize" @click="openSettings('content')"><SlidersHorizontal />Customize</button>
          </div>
          <div v-if="contentTab === 'news' && snapshot.contentAvailability.news === 'placeholder'" id="news-panel" role="tabpanel" aria-labelledby="news-tab" class="empty-state"><Newspaper /><h3>News is not connected yet.</h3><p>You can still read Guild Wars Reforged updates on the project website.</p><button class="secondary" @click="native?.external.open('github')">Open project updates <ExternalLink /></button></div>
          <div v-else-if="contentTab === 'news'" id="news-panel" role="tabpanel" aria-labelledby="news-tab" class="news-list">
            <article v-if="snapshot.preferences.content.officialNews"><span>Guild Wars</span><div><h3>Client stability update</h3><p>Fixed a cinematic crash and map reveal problems.</p></div><time>Aug 29</time></article>
            <article v-if="snapshot.preferences.content.reforgedNews"><span>Reforged</span><div><h3>The unified launcher is coming</h3><p>Accounts, Tools, downloads, and repair now live in one place.</p></div><time>New</time></article>
            <article><span>Issues</span><div><h3>Two known game issues</h3><p>Workarounds are available.</p></div><button @click="route = 'issues'">View</button></article>
          </div>
          <div v-else-if="snapshot.contentAvailability.dailies === 'placeholder'" id="dailies-panel" role="tabpanel" aria-labelledby="dailies-tab" class="empty-state"><Clock3 /><h3>Daily activities are not connected yet.</h3><p>Use the Guild Wars Wiki for the current schedule.</p></div>
          <div v-else id="dailies-panel" role="tabpanel" aria-labelledby="dailies-tab" class="daily-view">
            <div class="daily-date"><span>Today · Aug 29</span><strong>Changes in 5h 18m</strong><small>18:00 local time</small></div>
            <div class="daily-grid">
              <article v-for="daily in ['Gate of Pain', 'Zoldark the Unholy', 'Random Arena', 'Skyward Reach', 'Justiciar Marron', 'Footman Tate', 'Baked Husks']" :key="daily"><Swords /><div><small>Daily activity</small><strong>{{ daily }}</strong></div><ExternalLink /></article>
            </div>
            <template v-if="weekExpanded">
              <div v-for="day in ['Tomorrow · Aug 30', 'Monday · Aug 31', 'Tuesday · Sep 1', 'Wednesday · Sep 2', 'Thursday · Sep 3', 'Friday · Sep 4']" :key="day" class="daily-week-row"><strong>{{ day }}</strong><span>Zaishen Mission · Zaishen Bounty · Vanguard Quest</span></div>
            </template>
            <button class="load-more" :aria-expanded="weekExpanded" @click="weekExpanded = !weekExpanded">{{ weekExpanded ? 'Show today only' : 'Show the next 7 days' }}</button>
          </div>
        </section>
      </template>

      <section v-else-if="route === 'accounts'" class="page accounts-page">
        <div class="page-head"><div><span class="eyebrow">Accounts</span><h1>Game windows</h1><p>Add another account when you want another game window.</p></div><button class="secondary" @click="addOpen = true"><Plus />Add account</button></div>
        <div class="account-cards">
          <article v-for="profile in visibleProfiles" :key="profile.id" class="account-card">
            <div class="avatar" :style="{ background: profile.appearance.color }"><component :is="profileIcons[profile.appearance.icon as keyof typeof profileIcons] ?? Swords" /></div>
            <div><h3>{{ profile.name }}</h3><p>{{ profileStatus(profile) }}</p></div>
            <span class="status-dot" :class="profile.state" />
            <div class="account-actions"><button class="secondary" @click="editAppearance(profile)"><Settings />Customize</button><button v-if="profile.state === 'running'" class="secondary" @click="runAction('The game window could not be shown.', () => native?.profiles.show(profile.id))">Show</button><template v-else><button v-if="profile.id !== visibleProfiles[0]?.id" class="text-link" @click="runAction('The account could not be archived.', () => native?.profiles.archive(profile.id))">Archive</button><button class="secondary" @click="runAction('This account could not be opened. Try again.', () => native?.profiles.play([profile.id]))"><RotateCcw v-if="profile.state === 'failed'" /><Play v-else />{{ profile.state === 'failed' ? 'Try again' : 'Play' }}</button></template></div>
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
        <form v-if="snapshot.contentAvailability.feedback === 'fixture'" class="feedback-form" @submit.prevent>
          <label>What would you like to share?<textarea rows="6" placeholder="A short description is enough." /></label>
          <div class="form-row"><label>Type<select><option>Problem</option><option>Idea</option><option>Something else</option></select></label><label>Email (optional)<input type="email" placeholder="name@example.com" /></label></div>
          <button type="button" class="attachment"><Plus />Add screenshot or file</button>
          <p class="placeholder-note">Direct feedback is not connected yet. For now, continue on GitHub or Discord.</p>
          <div class="form-actions"><button class="secondary" @click="native?.external.open('discord')">Open Discord</button><button class="primary" @click="native?.external.open('bugReport')">Open GitHub issue</button></div>
        </form>
        <div v-else class="empty-state"><MessageSquareText /><h3>Direct feedback is not connected yet.</h3><p>For now, send a problem or idea through GitHub or talk to us on Discord.</p><div class="form-actions"><button class="secondary" @click="native?.external.open('discord')">Open Discord</button><button class="primary" @click="native?.external.open('bugReport')">Open GitHub issue</button></div></div>
      </section>

      <section v-else class="settings-page">
        <aside><h2>Settings</h2><button v-for="item in (['general', 'content', 'tools', 'game-files', 'advanced'] as SettingsRoute[])" :key="item" :class="{ active: settingsRoute === item }" @click="selectSettings(item)">{{ item.replace('-', ' ') }}</button></aside>
        <div class="settings-content">
          <template v-if="settingsRoute === 'general'"><h1>General</h1><div class="setting-group"><label><span><strong>Automatic updates</strong><small>Keep Guild Wars Reforged up to date.</small></span><input type="checkbox" :checked="snapshot.settings.autoCheckUpdates" @change="updateLauncherSettings({ autoCheckUpdates: checked($event) })" /></label><label><span><strong>Update channel</strong><small>Stable is recommended.</small></span><select :value="snapshot.settings.updateTrack" @change="updateLauncherSettings({ updateTrack: ($event.currentTarget as HTMLSelectElement).value as 'stable' | 'beta' })"><option value="stable">Stable</option><option value="beta">Beta</option></select></label><div class="setting-row"><span><strong>{{ updateCopy.title }}</strong><small>{{ updateCopy.detail }}</small></span><button v-if="snapshot.appUpdate.phase !== 'ready'" class="secondary" :disabled="snapshot.appUpdate.phase === 'checking' || snapshot.appUpdate.phase === 'downloading'" @click="runAction('Could not check for updates. Try again when you are online.', () => native?.updates.check())">Check now</button><button v-else class="primary" @click="runAction('The update could not be installed.', () => native?.updates.restartAndInstall())">Restart and update</button></div></div></template>
          <template v-else-if="settingsRoute === 'content'"><h1>Content</h1><div class="setting-group"><label><span><strong>News</strong><small>Official Guild Wars and Reforged updates.</small></span><input type="checkbox" :checked="snapshot.preferences.content.news" @change="updateContent({ news: checked($event) })" /></label><label><span><strong>Dailies</strong><small>Daily activities and the weekly schedule.</small></span><input type="checkbox" :checked="snapshot.preferences.content.dailies" @change="updateContent({ dailies: checked($event) })" /></label><label v-if="snapshot.preferences.content.news && snapshot.preferences.content.dailies"><span><strong>First Home tab</strong></span><select :value="snapshot.preferences.content.first" @change="updateContent({ first: ($event.currentTarget as HTMLSelectElement).value as 'news' | 'dailies' })"><option value="news">News</option><option value="dailies">Dailies</option></select></label><label v-if="snapshot.preferences.content.news"><span><strong>Official Guild Wars news</strong></span><input type="checkbox" :checked="snapshot.preferences.content.officialNews" @change="updateContent({ officialNews: checked($event) })" /></label><label v-if="snapshot.preferences.content.news"><span><strong>Guild Wars Reforged news</strong></span><input type="checkbox" :checked="snapshot.preferences.content.reforgedNews" @change="updateContent({ reforgedNews: checked($event) })" /></label></div></template>
          <template v-else-if="settingsRoute === 'tools'">
            <h1>Tools</h1><p>Tools apply to every account.</p>
            <div class="setting-group">
              <label><span><strong>Enable Tools</strong><small>Build Management, Quick Travel, and Xunlai Storage.</small></span><input type="checkbox" :checked="snapshot.tools.configured" @change="runAction('Tools could not be enabled.', () => native?.tools.setMasterEnabled(checked($event)))" /></label>
              <div v-for="(setting, tool) in snapshot.tools.features" :key="tool" class="tool-row">
                <label><span><strong>{{ toolLabels[tool] }}</strong><small>{{ shortcutDisplay(setting.shortcut) }}</small></span><input type="checkbox" :checked="setting.enabled" :disabled="!snapshot.tools.configured" @change="setTool(tool, checked($event))" /></label>
                <div><button class="secondary" @click="captureToolShortcut(tool)">Change shortcut</button><button class="text-link" @click="runAction('The default shortcut could not be restored.', () => native?.tools.restoreDefaultShortcut(tool))">Restore default</button></div>
              </div>
              <p v-if="shortcutMessage" class="inline-message" aria-live="polite">{{ shortcutMessage }}</p>
              <div v-if="pendingShortcutReplacement" class="form-actions"><button class="secondary" @click="pendingShortcutReplacement = null; shortcutMessage = 'Shortcut change cancelled.'">Cancel</button><button class="primary" @click="replaceToolShortcut">Replace shortcut</button></div>
              <div v-if="snapshot.tools.restartRequired" class="restart-row"><span><strong>Restart needed</strong><small>Your change is saved.</small></span><button v-if="!visibleProfiles.some(profile => profile.state === 'running')" class="primary" @click="runAction('The launcher could not restart.', () => native?.tools.restartToApply())">Restart launcher</button><span v-else>Applies after your next normal restart.</span></div>
            </div>
          </template>
          <template v-else-if="settingsRoute === 'game-files'"><h1>Game files</h1><p>Game files are shared by every account.</p><div class="setting-group"><div class="setting-row"><span><strong>Guild Wars client</strong><small v-if="gameFilesLoading">Checking game files…</small><small v-else-if="gameFilesInfo">{{ cacheSummary(gameFilesInfo) }}</small><small v-else>File details are unavailable.</small></span><span :class="{ good: snapshot.readiness.state !== 'repair-required' }">{{ snapshot.readiness.state === 'repair-required' ? 'Needs repair' : snapshot.readiness.state === 'preparing' ? 'Preparing' : 'Ready' }}</span></div><div v-if="snapshot.readiness.state === 'preparing'" class="download-card"><div><strong>{{ snapshot.readiness.progress.label }}</strong><span>{{ formatProgress(snapshot.readiness.progress) }}</span></div><progress :value="snapshot.readiness.progress.received" :max="snapshot.readiness.progress.total || 1" /></div><div v-else-if="snapshot.readiness.state === 'playable' && snapshot.readiness.backgroundDownload" class="download-card"><div><strong>Complete game download</strong><span v-if="snapshot.readiness.backgroundDownload.status === 'running'">Downloading in the background. You can play now.</span><span v-else-if="snapshot.readiness.backgroundDownload.status === 'paused'">Download paused. You can still play.</span><span v-else-if="snapshot.readiness.backgroundDownload.status === 'failed'">The background download stopped. Verified files were kept.</span><span v-else-if="snapshot.readiness.backgroundDownload.status === 'complete'">All game files are available offline.</span><span v-else>Pausing download…</span></div><button v-if="snapshot.readiness.backgroundDownload.status === 'running'" class="secondary" @click="runGameFilesAction('The download could not be paused.', () => native?.gameFiles.pauseDownload())">Pause</button><button v-else-if="snapshot.readiness.backgroundDownload.status === 'paused' || snapshot.readiness.backgroundDownload.status === 'failed'" class="secondary" @click="runGameFilesAction('The download could not be resumed.', () => native?.gameFiles.resumeDownload())">{{ snapshot.readiness.backgroundDownload.status === 'failed' ? 'Try again' : 'Resume' }}</button></div><div class="file-actions"><button v-if="snapshot.readiness.state === 'repair-required'" class="primary" @click="runGameFilesAction('Game files could not be repaired.', () => native?.gameFiles.repair())"><Wrench />Repair game files</button><button v-else class="secondary" @click="runGameFilesAction('Game files could not be checked.', () => native?.gameFiles.repair())"><Wrench />Check and repair game files</button><button v-if="snapshot.readiness.state === 'repair-required'" class="secondary" @click="runGameFilesAction('Game preparation could not be restarted.', () => native?.gameFiles.retryPreparation())"><RotateCcw />Try preparation again</button></div><details><summary>Advanced</summary><button class="danger-button" @click="runAction('Game files could not be reset.', () => native?.gameFiles.resetAndRestart())">Reset and redownload game files</button><p>This removes only downloaded Guild Wars client data after restart. Profiles, saved logins, application settings, Tools, shortcuts, builds, templates, screenshots, chat logs, and window positions are kept.</p></details></div></template>
          <template v-else><h1>Advanced</h1><div class="setting-group"><label><span><strong>Extended memory</strong><small>Allow longer sessions to use more memory.</small></span><input type="checkbox" :checked="snapshot.settings.extendedMemoryEnabled" @change="updateLauncherSettings({ extendedMemoryEnabled: checked($event) })" /></label><label><span><strong>Diagnostics</strong><small>Collect more local troubleshooting data.</small></span><input type="checkbox" :checked="snapshot.settings.showDiagnostics" @change="updateLauncherSettings({ showDiagnostics: checked($event) })" /></label><button class="secondary" @click="native?.external.revealLogs()"><FileText />Open logs</button><button class="danger-button" @click="native?.settings.reset()">Reset launcher settings</button></div></template>
        </div>
      </section>
    </main>

    <div v-if="operationError" class="operation-error" role="alert"><AlertTriangle /><span>{{ operationError }}</span><button class="icon-button" aria-label="Dismiss error" @click="operationError = ''"><X /></button></div>

    <footer class="launchbar">
      <div class="readiness"><span class="ready-dot" :class="snapshot.readiness.state" /><div><strong>{{ readyText }}</strong><small v-if="snapshot.readiness.state === 'playable'">Guild Wars and your enabled Tools are available.</small></div></div>
      <div class="picker-wrap">
        <button class="account-picker" aria-haspopup="dialog" :aria-expanded="pickerOpen" aria-controls="profile-picker" @click="pickerOpen = !pickerOpen"><Users /><span><small>Accounts</small><strong>{{ selectedProfiles.length }} selected</strong></span><ChevronDown /></button>
        <div v-if="pickerOpen" id="profile-picker" class="profile-picker" role="dialog" aria-label="Choose accounts" @keydown.esc="pickerOpen = false">
          <strong>Choose accounts</strong>
          <button v-for="profile in visibleProfiles" :key="profile.id" role="checkbox" :aria-checked="selected.includes(profile.id)" @click="toggleProfile(profile.id)">
            <span aria-hidden="true" class="checkbox" :class="{ checked: selected.includes(profile.id) }"><Check v-if="selected.includes(profile.id)" /></span>
            <span><b>{{ profile.name }}</b><small>{{ profileStatus(profile) }}</small></span>
          </button>
          <button class="manage" @click="pickerOpen = false; route = 'accounts'"><Settings />Manage accounts</button>
        </div>
      </div>
      <button class="primary launch" :disabled="busy || selected.length === 0 || (closedSelected.length === 0 && selectedProfiles.length > 1)" @click="primaryAction"><X v-if="waiting" /><Play v-else />{{ primaryLabel }}</button>
    </footer>

    <BaseModal v-if="addOpen" labelledby="add-account-title" @close="addOpen = false">
      <form @submit.prevent="createProfile"><div class="modal-head"><h2 id="add-account-title">Add account</h2><button type="button" class="icon-button" aria-label="Close" @click="addOpen = false"><X /></button></div><p>This opens another separate Guild Wars window. Sign-in stays inside the game.</p><label>Name<input v-model="newName" autofocus maxlength="48" placeholder="Second account" /></label><div class="form-actions"><button type="button" class="secondary" @click="addOpen = false">Cancel</button><button class="primary" :disabled="!newName.trim()">Add account</button></div></form>
    </BaseModal>

    <BaseModal v-if="appearanceProfile" labelledby="appearance-title" @close="appearanceProfile = null">
      <form @submit.prevent="saveAppearance"><div class="modal-head"><h2 id="appearance-title">Account appearance</h2><button type="button" class="icon-button" aria-label="Close" @click="appearanceProfile = null"><X /></button></div><p>Choose a simple icon and color for this account.</p><fieldset class="icon-options"><legend>Icon</legend><button v-for="(component, icon) in profileIcons" :key="icon" type="button" :aria-label="icon" :aria-pressed="appearanceIcon === icon" :class="{ selected: appearanceIcon === icon }" @click="appearanceIcon = icon"><component :is="component" /></button></fieldset><fieldset class="color-options"><legend>Color</legend><button v-for="color in ['#9a6638', '#496b58', '#46658a', '#76558b', '#9a4f4f', '#76703c', '#4c777d', '#6f6258']" :key="color" type="button" :aria-label="`Use ${color}`" :aria-pressed="appearanceColor === color" :class="{ selected: appearanceColor === color }" :style="{ background: color }" @click="appearanceColor = color" /><label>Custom color<input v-model="appearanceColor" type="color" /></label></fieldset><div class="form-actions"><button type="button" class="secondary" @click="appearanceProfile = null">Cancel</button><button class="primary">Save</button></div></form>
    </BaseModal>

    <div v-if="snapshot.experience.preferencesReset && !preferencesResetDismissed" class="toast"><AlertTriangle /><div><strong>Launcher preferences were reset.</strong><span>Your accounts, saved login, game files, builds, and templates were not changed.</span></div><button class="icon-button" aria-label="Dismiss" @click="preferencesResetDismissed = true"><X /></button></div>
    <div v-else-if="snapshot.experience.showMigrationNotice" class="toast"><Check /><div><strong>{{ snapshot.experience.installationKind === 'migrated-single' ? 'Your existing account is ready.' : 'Your accounts are ready.' }}</strong><span>We kept your saved login, settings, builds, templates, and game files.</span></div><button class="icon-button" aria-label="Dismiss" @click="native?.experience.dismissMigrationNotice()"><X /></button></div>

    <BaseModal v-if="snapshot.experience.setup === 'pending'" labelledby="setup-title" :dismissible="false" wide>
      <div class="setup-card">
        <template v-if="setupStep === 1"><span class="eyebrow">Welcome</span><h2 id="setup-title">Welcome to Guild Wars Reforged</h2><p>Guild Wars Reforged runs Guild Wars on your Mac. It is an unofficial community project and is not affiliated with ArenaNet or NCSOFT.</p><div class="form-actions"><button class="primary" @click="setupStep = 2">Continue</button></div></template>
        <template v-else><span class="eyebrow">Optional</span><h2 id="setup-title">Optional Tools</h2><p>Build Management saves team builds. Quick Travel opens a map search. Xunlai Storage opens storage in supported outposts.</p><p><strong>Tools apply to every account.</strong></p><div class="form-actions spread"><button class="secondary" @click="setupStep = 1">Back</button><span /><button class="secondary" @click="completeSetup(false)">Not now</button><button class="primary" @click="completeSetup(true)">Enable Tools</button></div></template>
      </div>
    </BaseModal>

    <div v-else-if="snapshot.experience.introduction === 'pending'" class="intro-callout" :class="`step-${introStep}`" role="dialog" aria-label="Launcher introduction" @keydown.esc="native?.experience.completeIntroduction()">
      <span>{{ introStep + 1 }} of 3</span>
      <strong>{{ ['Choose the accounts to open', 'Read news or check dailies', 'Find help and report problems'][introStep] }}</strong>
      <p>{{ ['The launcher remembers your selection.', 'You can hide either section in Content settings.', 'Known Issues shows workarounds. Feedback opens the current support channels.'][introStep] }}</p>
      <div class="form-actions"><button class="text-link" @click="native?.experience.completeIntroduction()">Skip</button><button v-if="introStep > 0" class="secondary" @click="introStep -= 1">Back</button><button class="primary" @click="introStep === 2 ? native?.experience.completeIntroduction() : introStep += 1">{{ introStep === 2 ? 'Done' : 'Next' }}</button></div>
    </div>
  </div>
</template>
