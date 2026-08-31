<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  AlertTriangle,
  Archive,
  Check,
  FileText,
  Flame,
  Map as MapIcon,
  ScrollText,
  Shield,
  Swords,
  Star,
  Crown,
  X,
} from "lucide-vue-next";
import type { LauncherSnapshot } from "@shared/launcher-contracts";
import type { GlobalTool, LauncherPreferencesPatch, LauncherSettingsPatch } from "@shared/launcher-contracts";
import type { CacheInfo } from "@shared/contracts";
import { shortcutDisplay } from "@shared/keyboard-shortcuts";
import type { ShortcutBinding } from "@shared/keyboard-shortcuts";
import type { ProfileId } from "@shared/multiple-accounts";
import { fixtureSnapshotFor } from "./fixtures";
import AccountsView from "./components/AccountsView.vue";
import BaseModal from "./components/BaseModal.vue";
import FeedbackView from "./components/FeedbackView.vue";
import GameFilesSettings from "./components/GameFilesSettings.vue";
import GeneralUpdateSettings from "./components/GeneralUpdateSettings.vue";
import LauncherHeader from "./components/LauncherHeader.vue";
import LaunchBar from "./components/LaunchBar.vue";
import HomeView from "./components/HomeView.vue";
import KnownIssuesView from "./components/KnownIssuesView.vue";
import MapsSettings from "./components/MapsSettings.vue";
import type { LauncherRoute, SettingsRoute } from "./routes";

const route = ref<LauncherRoute>("home");
const settingsRoute = ref<SettingsRoute>("general");
const settingsGroups: readonly {
  readonly label: string;
  readonly items: readonly { readonly id: SettingsRoute; readonly label: string }[];
}[] = [
  { label: "Launcher", items: [
    { id: "general", label: "Updates" },
    { id: "content", label: "Content" },
    { id: "advanced", label: "Advanced" },
  ] },
  { label: "Game", items: [
    { id: "game", label: "Game settings" },
    { id: "tools", label: "Tools" },
    { id: "maps", label: "Maps" },
    { id: "game-files", label: "Game files" },
  ] },
];
const snapshot = ref<LauncherSnapshot>(fixtureSnapshotFor(window.location.search));
const selected = ref<ProfileId[]>([...snapshot.value.selectedProfileIds]);
const addOpen = ref(false);
const appearanceProfile = ref<ProfileId | null>(null);
const appearanceIcon = ref("swords");
const appearanceColor = ref("#9a6638");
const newName = ref("");
const newIcon = ref("swords");
const newColor = ref("#9a6638");
const busy = ref(false);
const setupStep = ref<1 | 2>(1);
const introStep = ref(0);
const introCallout = ref<HTMLElement | null>(null);
const shortcutMessage = ref("");
const pendingShortcutReplacement = ref<{ tool: GlobalTool; binding: ShortcutBinding } | null>(null);
const updateBannerDismissed = ref(false);
const operationError = ref("");
const startupError = ref(false);
const gameFilesInfo = ref<CacheInfo | null>(null);
const gameFilesLoading = ref(false);
const MIGRATION_NOTICE_DURATION_MS = 8_000;
let unsubscribe: (() => void) | undefined;
let migrationNoticeTimer: ReturnType<typeof setTimeout> | undefined;

const native = window.launcherNative;
const synchronized = ref(!native);
const fixtureContent = computed(() => snapshot.value.contentAvailability.news === "fixture");
onMounted(async () => {
  if (!native) return;
  try {
    const initial = await native.state.get();
    snapshot.value = initial;
    selected.value = [...initial.selectedProfileIds];
    synchronized.value = true;
    unsubscribe = native.state.onChange((next) => {
      if (next.revision < snapshot.value.revision) return;
      snapshot.value = next;
      selected.value = [...next.selectedProfileIds];
    });
  } catch {
    startupError.value = true;
  }
});
onBeforeUnmount(() => {
  unsubscribe?.();
  clearTimeout(migrationNoticeTimer);
});
watch([synchronized, () => snapshot.value.experience.introduction], async ([ready, introduction]) => {
  if (!ready || introduction !== "pending") return;
  await nextTick();
  introCallout.value?.focus();
}, { immediate: true });
watch([synchronized, () => snapshot.value.experience.showMigrationNotice], ([ready, show]) => {
  clearTimeout(migrationNoticeTimer);
  migrationNoticeTimer = undefined;
  if (!ready || !show) return;
  migrationNoticeTimer = setTimeout(() => void dismissMigrationNotice(), MIGRATION_NOTICE_DURATION_MS);
}, { immediate: true });

const visibleProfiles = computed(() => snapshot.value.profiles.filter((profile) => !profile.archived));
const appearanceProfileDetails = computed(() => snapshot.value.profiles.find((profile) => profile.id === appearanceProfile.value) ?? null);
const canArchiveAppearanceProfile = computed(() => {
  const profile = appearanceProfileDetails.value;
  return profile !== null
    && profile.id !== visibleProfiles.value[0]?.id
    && (profile.state === "ready" || profile.state === "failed");
});
const selectedProfiles = computed(() => visibleProfiles.value.filter((profile) => selected.value.includes(profile.id)));
const openSelected = computed(() => selectedProfiles.value.filter((profile) => profile.state === "running"));
const closedSelected = computed(() => selectedProfiles.value.filter((profile) => profile.state !== "running"));
const waiting = computed(() => selectedProfiles.value.some((profile) => profile.state === "queued"));
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

async function showProfile(id: ProfileId) {
  await runAction(
    "The game window could not be shown.",
    () => native?.profiles.show(id),
  );
}

async function createProfile() {
  const name = newName.value.trim();
  if (!name) return;
  await runAction("The account could not be added. Try another name or try again.", async () => {
    await native?.profiles.create({ name, appearance: { icon: newIcon.value, color: newColor.value } });
    newName.value = "";
    newIcon.value = "swords";
    newColor.value = "#9a6638";
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

async function archiveAppearanceProfile() {
  const profile = appearanceProfileDetails.value;
  if (!profile || !canArchiveAppearanceProfile.value) return;
  if (await runAction("The account could not be archived.", () => native?.profiles.archive(profile.id))) {
    appearanceProfile.value = null;
  }
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

async function completeIntroduction() {
  if (native) await runAction("The introduction could not be closed.", () => native.experience.completeIntroduction());
  else snapshot.value = { ...snapshot.value, experience: { ...snapshot.value.experience, introduction: "complete" } };
}

async function dismissMigrationNotice() {
  clearTimeout(migrationNoticeTimer);
  migrationNoticeTimer = undefined;
  if (native) await runAction("The notice could not be dismissed.", () => native.experience.dismissMigrationNotice());
  else snapshot.value = { ...snapshot.value, experience: { ...snapshot.value.experience, showMigrationNotice: false } };
}

async function dismissPreferencesReset() {
  if (native) await runAction("The notice could not be dismissed.", () => native.experience.dismissPreferencesReset());
  else snapshot.value = { ...snapshot.value, experience: { ...snapshot.value.experience, preferencesReset: false } };
}

async function openExternal(kind: Parameters<NonNullable<typeof native>["external"]["open"]>[0]) {
  await runAction("The link could not be opened.", () => native?.external.open(kind));
}

async function updateContent(content: NonNullable<LauncherPreferencesPatch["content"]>) {
  await runAction("Content settings could not be saved.", () => native?.experience.updatePreferences({ content }));
  if (!native) snapshot.value = { ...snapshot.value, preferences: { content: { ...snapshot.value.preferences.content, ...content } } };
}

async function updateLauncherSettings(patch: LauncherSettingsPatch) {
  await runAction("This setting could not be saved.", () => native?.settings.update(patch));
}

async function checkLauncherUpdate() {
  await runAction("Could not check for launcher updates.", () => native?.updates.check());
}

async function restartAndInstallUpdate() {
  await runAction("The launcher update could not be installed.", () => native?.updates.restartAndInstall());
}

async function repairGameFiles() {
  await runGameFilesAction("Game files could not be repaired.", () => native?.gameFiles.repair());
}

async function pauseGameDownload() {
  await runGameFilesAction("The download could not be paused.", () => native?.gameFiles.pauseDownload());
}

async function resumeGameDownload() {
  await runGameFilesAction("The download could not be resumed.", () => native?.gameFiles.resumeDownload());
}

async function resetGameFiles() {
  await runAction("Game files could not be reset.", () => native?.gameFiles.resetAndRestart());
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
  <div v-else class="app-shell" :data-intro-step="snapshot.experience.introduction === 'pending' ? introStep : undefined">
    <LauncherHeader :route="route" @navigate="route = $event" @settings="openSettings()" @external="openExternal" />

    <section class="funding-banner" aria-label="Project funding">
      <div><strong>Support gwonmac</strong></div>
      <div class="funding-progress" :aria-label="fixtureContent ? '€42 of €125 funded' : '€125 yearly cost'">
        <span>{{ fixtureContent ? '€42' : 'Yearly costs' }}</span><div><i :style="{ width: fixtureContent ? '34%' : '0%' }" /></div><span>€125</span>
      </div>
      <button @click="openExternal('donate')">Support</button>
    </section>

    <main :class="{ 'artwork-only': route === 'home' && !snapshot.preferences.content.news && !snapshot.preferences.content.dailies }">
      <HomeView v-if="route === 'home'" :snapshot="snapshot" @settings="openSettings('content')" @issues="route = 'issues'" @external="openExternal" />

      <AccountsView
        v-else-if="route === 'accounts'"
        :profiles="snapshot.profiles"
        @add="addOpen = true"
        @customize="editAppearance"
        @show="showProfile"
        @play="id => runAction('This account could not be opened. Try again.', () => native?.profiles.play([id]))"
        @restore="id => runAction('The account could not be restored.', () => native?.profiles.restore(id))"
        @delete="id => runAction('The account could not be deleted.', () => native?.profiles.delete(id))"
      />

      <KnownIssuesView v-else-if="route === 'issues'" :availability="snapshot.contentAvailability.knownIssues" @external="openExternal" />

      <FeedbackView v-else-if="route === 'feedback'" :availability="snapshot.contentAvailability.feedback" @external="openExternal" />

      <section v-else class="settings-page">
        <aside aria-label="Settings sections">
          <h2>Settings</h2>
          <div v-for="group in settingsGroups" :key="group.label" class="settings-nav-group" role="group" :aria-label="group.label">
            <h3>{{ group.label }}</h3>
            <button v-for="item in group.items" :key="item.id" :aria-current="settingsRoute === item.id ? 'page' : undefined" :class="{ active: settingsRoute === item.id }" @click="selectSettings(item.id)">{{ item.label }}</button>
          </div>
        </aside>
        <div class="settings-content">
          <GeneralUpdateSettings
            v-if="settingsRoute === 'general'"
            :settings="snapshot.settings"
            :update="snapshot.appUpdate"
            :save="updateLauncherSettings"
            :check="checkLauncherUpdate"
            :restart="restartAndInstallUpdate"
            :open-releases="() => openExternal('releases')"
          />
          <template v-else-if="settingsRoute === 'content'"><h1>Content</h1><div class="setting-group"><label><span><strong>News</strong><small>Official Guild Wars and Reforged updates.</small></span><input type="checkbox" :checked="snapshot.preferences.content.news" @change="updateContent({ news: checked($event) })" /></label><label><span><strong>Dailies</strong><small>Daily activities and the weekly schedule.</small></span><input type="checkbox" :checked="snapshot.preferences.content.dailies" @change="updateContent({ dailies: checked($event) })" /></label><label v-if="snapshot.preferences.content.news && snapshot.preferences.content.dailies"><span><strong>First Home tab</strong></span><select :value="snapshot.preferences.content.first" @change="updateContent({ first: ($event.currentTarget as HTMLSelectElement).value as 'news' | 'dailies' })"><option value="news">News</option><option value="dailies">Dailies</option></select></label><label v-if="snapshot.preferences.content.news"><span><strong>Official Guild Wars news</strong></span><input type="checkbox" :checked="snapshot.preferences.content.officialNews" @change="updateContent({ officialNews: checked($event) })" /></label><label v-if="snapshot.preferences.content.news"><span><strong>Guild Wars Reforged news</strong></span><input type="checkbox" :checked="snapshot.preferences.content.reforgedNews" @change="updateContent({ reforgedNews: checked($event) })" /></label></div></template>
          <template v-else-if="settingsRoute === 'game'">
            <h1>Game settings</h1>
            <div class="setting-group">
              <label><span><strong>Render quality</strong><small>Higher quality uses more graphics power.</small></span><select :value="snapshot.settings.renderScale" @change="updateLauncherSettings({ renderScale: Number(($event.currentTarget as HTMLSelectElement).value) as 1 | 1.5 | 2 })"><option :value="1">Standard</option><option :value="1.5">High</option><option :value="2">Very high</option></select></label>
              <label><span><strong>Extended memory</strong><small>Allow longer sessions to use more memory.</small></span><input type="checkbox" :checked="snapshot.settings.extendedMemoryEnabled" @change="updateLauncherSettings({ extendedMemoryEnabled: checked($event) })" /></label>
            </div>
          </template>
          <template v-else-if="settingsRoute === 'tools'">
            <h1>Tools</h1><p>Tools apply to every account.</p>
            <div class="setting-group">
              <label><span><strong>Enable Tools</strong><small>Build Management, Quick Travel, and Xunlai Storage.</small></span><input type="checkbox" :checked="snapshot.tools.configured" @change="runAction('The Tools setting could not be saved.', () => native?.tools.setMasterEnabled(checked($event)))" /></label>
              <div v-for="(setting, tool) in snapshot.tools.features" :key="tool" class="tool-row">
                <label><span><strong>{{ toolLabels[tool] }}</strong><small>{{ shortcutDisplay(setting.shortcut) }}</small></span><input type="checkbox" :checked="setting.enabled" :disabled="!snapshot.tools.configured" @change="setTool(tool, checked($event))" /></label>
                <div><button class="secondary" @click="captureToolShortcut(tool)">Change shortcut</button><button class="text-link" @click="runAction('The default shortcut could not be restored.', () => native?.tools.restoreDefaultShortcut(tool))">Restore default</button></div>
              </div>
              <p v-if="shortcutMessage" class="inline-message" aria-live="polite">{{ shortcutMessage }}</p>
              <div v-if="pendingShortcutReplacement" class="form-actions"><button class="secondary" @click="pendingShortcutReplacement = null; shortcutMessage = 'Shortcut change cancelled.'">Cancel</button><button class="primary" @click="replaceToolShortcut">Replace shortcut</button></div>
              <div v-if="snapshot.tools.restartRequired" class="restart-row"><span><strong>Restart needed</strong><small>Your change is saved.</small></span><button v-if="!visibleProfiles.some(profile => profile.state === 'running')" class="primary" @click="runAction('The application could not restart.', () => native?.tools.restartToApply())">Restart application</button><span v-else>Applies after your next normal restart.</span></div>
            </div>
          </template>
          <MapsSettings v-else-if="settingsRoute === 'maps'" :settings="snapshot.settings" :save="updateLauncherSettings" />
          <GameFilesSettings
            v-else-if="settingsRoute === 'game-files'"
            :readiness="snapshot.readiness"
            :info="gameFilesInfo"
            :loading="gameFilesLoading"
            :repair="repairGameFiles"
            :pause="pauseGameDownload"
            :resume="resumeGameDownload"
            :reset="resetGameFiles"
          />
          <template v-else>
            <h1>Advanced</h1>
            <div class="setting-group">
              <label><span><strong>Diagnostics</strong><small>Collect more local troubleshooting data.</small></span><input type="checkbox" :checked="snapshot.settings.showDiagnostics" @change="updateLauncherSettings({ showDiagnostics: checked($event) })" /></label>
              <button class="secondary" @click="runAction('Logs could not be opened.', () => native?.external.revealLogs())"><FileText />Open logs</button>
              <button class="danger-button" @click="runAction('Launcher settings could not be reset.', () => native?.settings.reset())">Reset launcher settings</button>
            </div>
          </template>
        </div>
      </section>
    </main>

    <LaunchBar
      :snapshot="snapshot"
      :selected="selected"
      :busy="busy"
      :operation-error="operationError"
      :update-dismissed="updateBannerDismissed"
      @toggle="toggleProfile"
      @show="showProfile"
      @action="primaryAction"
      @manage="route = 'accounts'"
      @game-files="openSettings('game-files')"
      @dismiss-error="operationError = ''"
      @dismiss-update="updateBannerDismissed = true"
      @install-update="runAction('The update could not be installed.', () => native?.updates.restartAndInstall())"
    />

    <BaseModal v-if="addOpen" labelledby="add-account-title" @close="addOpen = false">
      <form @submit.prevent="createProfile"><div class="modal-head"><h2 id="add-account-title">Add account</h2><button type="button" class="icon-button" aria-label="Close" @click="addOpen = false"><X /></button></div><p>This opens another separate Guild Wars window. Sign-in stays inside the game.</p><label>Name<input v-model="newName" autofocus maxlength="48" placeholder="Second account" /></label><details><summary>Appearance</summary><fieldset class="icon-options"><legend>Icon</legend><button v-for="(component, icon) in profileIcons" :key="icon" type="button" :aria-label="icon" :aria-pressed="newIcon === icon" :class="{ selected: newIcon === icon }" @click="newIcon = icon"><component :is="component" /></button></fieldset><fieldset class="color-options"><legend>Color</legend><button v-for="color in ['#9a6638', '#496b58', '#46658a', '#76558b', '#9a4f4f', '#76703c', '#4c777d', '#6f6258']" :key="color" type="button" :aria-label="`Use ${color}`" :aria-pressed="newColor === color" :class="{ selected: newColor === color }" :style="{ background: color }" @click="newColor = color" /><label>Custom color<input v-model="newColor" type="color" /></label></fieldset></details><div class="form-actions"><button type="button" class="secondary" @click="addOpen = false">Cancel</button><button class="primary" :disabled="!newName.trim()">Add account</button></div></form>
    </BaseModal>

    <BaseModal v-if="appearanceProfile" labelledby="appearance-title" @close="appearanceProfile = null">
      <form @submit.prevent="saveAppearance"><div class="modal-head"><h2 id="appearance-title">Edit account</h2><button type="button" class="icon-button" aria-label="Close" @click="appearanceProfile = null"><X /></button></div><p>Choose how this account appears in the launcher.</p><fieldset class="icon-options"><legend>Icon</legend><button v-for="(component, icon) in profileIcons" :key="icon" type="button" :aria-label="icon" :aria-pressed="appearanceIcon === icon" :class="{ selected: appearanceIcon === icon }" @click="appearanceIcon = icon"><component :is="component" /></button></fieldset><fieldset class="color-options"><legend>Color</legend><button v-for="color in ['#9a6638', '#496b58', '#46658a', '#76558b', '#9a4f4f', '#76703c', '#4c777d', '#6f6258']" :key="color" type="button" :aria-label="`Use ${color}`" :aria-pressed="appearanceColor === color" :class="{ selected: appearanceColor === color }" :style="{ background: color }" @click="appearanceColor = color" /><label>Custom color<input v-model="appearanceColor" type="color" /></label></fieldset><div v-if="canArchiveAppearanceProfile" class="archive-account-row"><span><strong>Archive account</strong><small>Hide this account without deleting its data.</small></span><button type="button" class="archive-button" @click="archiveAppearanceProfile"><Archive />Archive</button></div><div class="form-actions"><button type="button" class="secondary" @click="appearanceProfile = null">Cancel</button><button class="primary">Save</button></div></form>
    </BaseModal>

    <div v-if="snapshot.experience.preferencesReset" class="toast"><AlertTriangle /><div><strong>Launcher preferences were reset.</strong><span>Your accounts, saved login, game files, builds, and templates were not changed.</span></div><button class="icon-button" aria-label="Dismiss" @click="dismissPreferencesReset"><X /></button></div>
    <div v-else-if="snapshot.experience.showMigrationNotice" class="toast"><Check /><div><strong>{{ snapshot.experience.installationKind === 'migrated-single' ? 'Your existing account is ready.' : 'Your accounts are ready.' }}</strong><span>We kept your saved login, settings, builds, templates, and game files.</span></div><button class="icon-button" aria-label="Dismiss" @click="dismissMigrationNotice"><X /></button></div>

    <BaseModal v-if="snapshot.experience.setup === 'pending'" labelledby="setup-title" :dismissible="false" wide>
      <div class="setup-card">
        <template v-if="setupStep === 1"><h2 id="setup-title">Welcome to Guild Wars Reforged</h2><p>Guild Wars Reforged runs Guild Wars on your Mac. It is an unofficial community project and is not affiliated with ArenaNet or NCSOFT.</p><div class="form-actions"><button class="primary" @click="setupStep = 2">Continue</button></div></template>
        <template v-else><h2 id="setup-title">Optional Tools</h2><p>Build Management saves team builds. Quick Travel opens a map search. Xunlai Storage opens storage in supported outposts.</p><p><strong>Tools apply to every account.</strong></p><p class="setup-note">If you enable Tools, the app restarts once to finish setup.</p><div class="form-actions spread"><button class="secondary" @click="setupStep = 1">Back</button><span /><button class="secondary" @click="completeSetup(false)">Not now</button><button class="primary" @click="completeSetup(true)">Enable Tools</button></div></template>
      </div>
    </BaseModal>

    <aside v-else-if="snapshot.experience.introduction === 'pending'" ref="introCallout" class="intro-callout" :class="`step-${introStep}`" aria-label="Launcher introduction" tabindex="-1" @keydown.esc="completeIntroduction">
      <span>{{ introStep + 1 }} of 3</span>
      <strong>{{ ['Choose the accounts to open', 'Read news or check dailies', 'Find help and report problems'][introStep] }}</strong>
      <p>{{ ['The launcher remembers your selection.', 'You can hide either section in Content settings.', 'Known Issues shows workarounds. Feedback opens the current support channels.'][introStep] }}</p>
      <div class="form-actions"><button class="text-link" @click="completeIntroduction">Skip</button><button v-if="introStep > 0" class="secondary" @click="introStep -= 1">Back</button><button class="primary" @click="introStep === 2 ? completeIntroduction() : introStep += 1">{{ introStep === 2 ? 'Done' : 'Next' }}</button></div>
    </aside>
  </div>
</template>
