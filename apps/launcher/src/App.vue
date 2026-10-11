<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  AlertTriangle,
  Archive,
  Check,
  Flame,
  Map as MapIcon,
  ScrollText,
  Shield,
  Swords,
  Star,
  Crown,
  X,
} from "lucide-vue-next";
import type { LauncherDestination, LauncherPreferencesPatch, LauncherSnapshot } from "@shared/launcher-contracts";
import type { SettingsSection, SettingsTarget } from "@shared/settings-catalogue";
import type { ProfileId } from "@shared/multiple-accounts";
import { parseProfileName, profileNameKey } from "@shared/multiple-accounts";
import { fixtureSnapshotFor } from "./fixtures";
import AccountsView from "./components/AccountsView.vue";
import BaseModal from "./components/BaseModal.vue";
import FeedbackView from "./components/FeedbackView.vue";
import LauncherHeader from "./components/LauncherHeader.vue";
import LaunchBar from "./components/LaunchBar.vue";
import HomeView from "./components/HomeView.vue";
import KnownIssuesView from "./components/KnownIssuesView.vue";
import SettingsView from "./components/SettingsView.vue";
import ColorControl from "./components/ColorControl.vue";
import type { LauncherRoute } from "./routes";

const route = ref<LauncherRoute>("home");
const snapshot = shallowRef<LauncherSnapshot>(fixtureSnapshotFor(window.location.search));
const funding = computed(() => snapshot.value.funding);
const selected = ref<ProfileId[]>([...snapshot.value.selectedProfileIds]);
const addOpen = ref(false);
const appearanceProfile = ref<ProfileId | null>(null);
const appearanceName = ref("");
const appearanceError = ref("");
const appearanceSaving = ref(false);
const appearanceIcon = ref("swords");
const appearanceColor = ref("#9a6638");
const newName = ref("");
const newIcon = ref("swords");
const newColor = ref("#9a6638");
const busy = ref(false);
const setupStep = ref<1 | 2>(1);
const updateBannerDismissed = ref(false);
const operationError = ref("");
const startupError = ref(false);
const MIGRATION_NOTICE_DURATION_MS = 8_000;
let unsubscribe: (() => void) | undefined;
let unsubscribeNavigation: (() => void) | undefined;
let migrationNoticeTimer: ReturnType<typeof setTimeout> | undefined;

const native = window.launcherNative;
let navigationRequested = false;
// Browser previews remember only navigation in this tab. Native preferences
// remain the production owner, with no browser-storage fallback.
if (!native && import.meta.env.MODE === "development") {
  const remembered = sessionStorage.getItem("launcher-preview-page");
  if (remembered === "home" || remembered === "accounts") route.value = remembered;
}
watch(route, (page) => {
  if (page !== "home" && page !== "accounts") return;
  if (!native) {
    if (import.meta.env.MODE === "development") sessionStorage.setItem("launcher-preview-page", page);
    return;
  }
  if (snapshot.value.preferences.lastPlayPage === page) return;
  void runAction("The starting page could not be remembered.", () => native.experience.updatePreferences({ lastPlayPage: page }));
});
const synchronized = ref(!native);
onMounted(async () => {
  if (!native) return;
  unsubscribeNavigation = native.navigation.onRequest(navigateFromMain);
  // Subscribe before fetching: a window can close while the initial snapshot
  // crosses IPC. Revision ordering also refuses a late, older response.
  let receivedRevision = -1;
  const applySnapshot = (next: LauncherSnapshot) => {
    if (next.revision < receivedRevision) return;
    receivedRevision = next.revision;
    snapshot.value = next;
    selected.value = [...next.selectedProfileIds];
  };
  unsubscribe = native.state.onChange(applySnapshot);
  try {
    applySnapshot(await native.state.get());
    if (!navigationRequested) route.value = snapshot.value.preferences.lastPlayPage ?? "home";
    synchronized.value = true;
  } catch {
    startupError.value = true;
  }
});
onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribeNavigation?.();
  clearTimeout(migrationNoticeTimer);
});
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

async function playProfile(id: ProfileId) {
  const profile = snapshot.value.profiles.find(candidate => candidate.id === id);
  if (!profile || profile.archived || (profile.state !== "ready" && profile.state !== "failed")) return;
  if (snapshot.value.readiness.state === "repair-required") {
    openSettings("game-files");
    return;
  }
  await runAction("This account could not be opened. Try again.", () => native?.profiles.play([id]));
}

async function cancelProfile(id: ProfileId) {
  await runAction("The waiting account could not be cancelled.", () => native?.profiles.cancelQueued([id]));
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
  appearanceName.value = profile.name;
  appearanceError.value = "";
  appearanceIcon.value = profile.appearance.icon;
  appearanceColor.value = profile.appearance.color;
}

async function saveAppearance() {
  const id = appearanceProfile.value;
  if (!id || appearanceSaving.value) return;
  appearanceError.value = "";
  let name: string;
  try {
    name = parseProfileName(appearanceName.value);
    if (snapshot.value.profiles.some(profile => profile.id !== id && profileNameKey(profile.name) === profileNameKey(name))) {
      appearanceError.value = "Another account already uses this name.";
      return;
    }
  } catch {
    appearanceError.value = "Enter a name of 1–48 characters without control characters.";
    return;
  }
  appearanceSaving.value = true;
  try {
    if (native) await native.profiles.update({ id, name, icon: appearanceIcon.value, color: appearanceColor.value });
    else snapshot.value = {
      ...snapshot.value,
      profiles: snapshot.value.profiles.map(profile => profile.id === id
        ? { ...profile, name, appearance: { icon: appearanceIcon.value, color: appearanceColor.value } }
        : profile),
    };
    appearanceProfile.value = null;
  } catch {
    appearanceError.value = "The account could not be fully saved. Some changes may already be saved. Try again.";
  } finally {
    appearanceSaving.value = false;
  }
}

async function archiveAppearanceProfile() {
  const profile = appearanceProfileDetails.value;
  if (!profile || !canArchiveAppearanceProfile.value) return;
  if (await runAction("The account could not be archived.", () => native?.profiles.archive(profile.id))) {
    appearanceProfile.value = null;
  }
}

/** Where Settings opens next; each request is a new object, so the same control opens again. */
const settingsTarget = ref<SettingsTarget | null>(null);
const settingsSection = ref<SettingsSection | null>(null);
function openSettings(target?: SettingsSection | SettingsTarget) {
  settingsTarget.value = typeof target === "string" ? { section: target } : target ? { ...target } : null;
  route.value = "settings";
}

function navigateFromMain(destination: LauncherDestination) {
  navigationRequested = true;
  if (typeof destination === "object") openSettings(destination);
  else if (destination === "settings") openSettings();
  else route.value = destination;
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

const profileIcons = { swords: Swords, archive: Archive, map: MapIcon, scroll: ScrollText, shield: Shield, star: Star, crown: Crown, flame: Flame } as const;

async function completeSetup(enableTools: boolean) {
  if (native) {
    await runAction("Setup could not be saved. Try again.", () => native.experience.completeSetup({ enableTools }));
    return;
  }
  snapshot.value = { ...snapshot.value, experience: { ...snapshot.value.experience, setup: "complete" } };
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

async function openNews(id: string) {
  await runAction("The news item could not be opened.", () => native?.news.open(id));
}

async function updateContent(content: NonNullable<LauncherPreferencesPatch["content"]>) {
  const save = async () => {
    if (native) await native.experience.updatePreferences({ content });
    else snapshot.value = { ...snapshot.value, preferences: { content: { ...snapshot.value.preferences.content, ...content } } };
  };
  await runAction("Content settings could not be saved.", save);
}

</script>

<template>
  <div v-if="startupError" class="launcher-boot launcher-error" role="alert"><AlertTriangle /><h1>The launcher could not open</h1><p>Your accounts and game files were not changed.</p><button class="primary" @click="retryStartup">Try again</button></div>
  <div v-else-if="!synchronized" class="launcher-boot" role="status">Opening launcher…</div>
  <div v-else class="app-shell" :class="{ 'settings-shell': route === 'settings', 'accounts-shell': route === 'accounts' }">
    <LauncherHeader :route="route" @navigate="route = $event" @settings="openSettings()" @external="openExternal" />

    <section class="funding-banner" aria-label="Project funding">
      <div><strong>Support gwonmac</strong></div>
      <div class="funding-progress" role="progressbar" aria-label="Project funding" :aria-valuenow="Math.min(funding.raisedEuros, funding.goalEuros)" :aria-valuemax="funding.goalEuros" :aria-valuemin="0" :aria-valuetext="`€${funding.raisedEuros} of €${funding.goalEuros} funded`">
        <span>€{{ funding.raisedEuros }}</span><div><i :style="{ width: `${Math.min(100, funding.raisedEuros / funding.goalEuros * 100)}%` }" /></div><span>€{{ funding.goalEuros }}</span>
      </div>
      <button @click="openExternal('donate')">Support</button>
    </section>

    <main :class="{ 'artwork-only': route === 'home' && !snapshot.preferences.content.news && !snapshot.preferences.content.dailies }">
      <HomeView v-if="route === 'home'" :snapshot="snapshot" @settings="openSettings('home')" @preferences="updateContent" @news="openNews" />

      <AccountsView
        v-else-if="route === 'accounts'"
        :profiles="snapshot.profiles"
        :selected="selected"
        :readiness="snapshot.readiness"
        @toggle="toggleProfile"
        @add="addOpen = true"
        @customize="editAppearance"
        @show="showProfile"
        @play="playProfile"
        @cancel="cancelProfile"
        @restore="id => runAction('The account could not be restored.', () => native?.profiles.restore(id))"
        @delete="id => runAction('The account could not be deleted.', () => native?.profiles.delete(id))"
      />

      <KnownIssuesView v-else-if="route === 'issues'" :availability="snapshot.contentAvailability.knownIssues" @external="openExternal" />

      <FeedbackView v-else-if="route === 'feedback'" :availability="snapshot.contentAvailability.feedback" @external="openExternal" />

      <SettingsView v-else :snapshot="snapshot" :native="native" :launcher="{ snapshot, native }" :target="settingsTarget" @fixture="snapshot = $event" @section="settingsSection = $event" />
    </main>

    <LaunchBar
      :snapshot="snapshot"
      :selected="selected"
      :busy="busy"
      :operation-error="operationError"
      :update-dismissed="updateBannerDismissed"
      @toggle="toggleProfile"
      @play="playProfile"
        @cancel="cancelProfile"
      @show="showProfile"
      @action="primaryAction"
      @manage="route = 'accounts'"
      :viewing-game-files="route === 'settings' && settingsSection === 'game-files'"
      @game-files="openSettings('game-files')"
      @dismiss-error="operationError = ''"
      @dismiss-update="updateBannerDismissed = true"
      @install-update="runAction('The update could not be installed.', () => native?.updates.restartAndInstall())"
    />

    <BaseModal v-if="addOpen" labelledby="add-account-title" @close="addOpen = false">
      <form @submit.prevent="createProfile"><div class="modal-head"><h2 id="add-account-title">Add account</h2><button type="button" class="icon-button" aria-label="Close" @click="addOpen = false"><X /></button></div><p>This opens another separate Guild Wars window. Sign-in stays inside the game.</p><label>Name<input v-model="newName" autofocus maxlength="48" placeholder="Second account" /></label><details><summary>Appearance</summary><fieldset class="icon-options"><legend>Icon</legend><button v-for="(component, icon) in profileIcons" :key="icon" type="button" :aria-label="icon" :aria-pressed="newIcon === icon" :class="{ selected: newIcon === icon }" @click="newIcon = icon"><component :is="component" /></button></fieldset><fieldset class="color-options"><legend>Color</legend><button v-for="color in ['#9a6638', '#496b58', '#46658a', '#76558b', '#9a4f4f', '#76703c', '#4c777d', '#6f6258']" :key="color" type="button" :aria-label="`Use ${color}`" :aria-pressed="newColor === color" :class="{ selected: newColor === color }" :style="{ background: color }" @click="newColor = color" /><ColorControl label="Custom account color" :value="newColor" @change="newColor = $event" /></fieldset></details><div class="form-actions"><button type="button" class="secondary" @click="addOpen = false">Cancel</button><button class="primary" :disabled="!newName.trim()">Add account</button></div></form>
    </BaseModal>

    <BaseModal v-if="appearanceProfile" labelledby="appearance-title" :dismissible="!appearanceSaving" @close="appearanceProfile = null">
      <form @submit.prevent="saveAppearance"><fieldset class="account-edit-fields" :disabled="appearanceSaving"><div class="modal-head"><h2 id="appearance-title">Edit account</h2><button type="button" class="icon-button" aria-label="Close" :disabled="appearanceSaving" @click="appearanceProfile = null"><X /></button></div><p>Choose a name and appearance you can recognize at a glance.</p><label>Name<input v-model="appearanceName" maxlength="48" required :disabled="appearanceSaving" :aria-invalid="!!appearanceError" :aria-describedby="appearanceError ? 'account-edit-error' : undefined" /></label><p v-if="appearanceError" id="account-edit-error" class="account-edit-error" role="alert">{{ appearanceError }}</p><fieldset class="icon-options"><legend>Icon</legend><button v-for="(component, icon) in profileIcons" :key="icon" type="button" :aria-label="icon" :aria-pressed="appearanceIcon === icon" :class="{ selected: appearanceIcon === icon }" @click="appearanceIcon = icon"><component :is="component" /></button></fieldset><fieldset class="color-options"><legend>Color</legend><button v-for="color in ['#9a6638', '#496b58', '#46658a', '#76558b', '#9a4f4f', '#76703c', '#4c777d', '#6f6258']" :key="color" type="button" :aria-label="`Use ${color}`" :aria-pressed="appearanceColor === color" :class="{ selected: appearanceColor === color }" :style="{ background: color }" @click="appearanceColor = color" /><ColorControl label="Custom account color" :value="appearanceColor" @change="appearanceColor = $event" /></fieldset><div v-if="canArchiveAppearanceProfile" class="archive-account-row"><span><strong>Archive account</strong><small>Hide this account without deleting its data.</small></span><button type="button" class="archive-button" @click="archiveAppearanceProfile"><Archive />Archive</button></div><div class="form-actions"><button type="button" class="secondary" :disabled="appearanceSaving" @click="appearanceProfile = null">Cancel</button><button class="primary" :disabled="appearanceSaving">{{ appearanceSaving ? 'Saving…' : 'Save changes' }}</button></div></fieldset></form>
    </BaseModal>

    <div v-if="snapshot.experience.preferencesReset" class="toast"><AlertTriangle /><div><strong>Launcher preferences were reset.</strong><span>Your accounts, saved login, game files, builds, and templates were not changed.</span></div><button class="icon-button" aria-label="Dismiss" @click="dismissPreferencesReset"><X /></button></div>
    <div v-else-if="snapshot.experience.showMigrationNotice" class="toast"><Check /><div><strong>{{ snapshot.experience.installationKind === 'migrated-single' ? 'Your existing account is ready.' : 'Your accounts are ready.' }}</strong><span>We kept your saved login, settings, builds, templates, and game files.</span></div><button class="icon-button" aria-label="Dismiss" @click="dismissMigrationNotice"><X /></button></div>

    <BaseModal v-if="snapshot.experience.setup === 'pending'" labelledby="setup-title" :dismissible="false" wide>
      <div class="setup-card">
        <template v-if="setupStep === 1"><h2 id="setup-title">Welcome to Guild Wars Reforged</h2><p>Guild Wars Reforged runs Guild Wars on your Mac. It is an unofficial community project and is not affiliated with ArenaNet or NCSOFT.</p><div class="form-actions"><button class="primary" @click="setupStep = 2">Continue</button></div></template>
        <template v-else><h2 id="setup-title">Optional Tools</h2><p>Build Management saves team builds. Quick Travel opens a map search. Xunlai Storage opens storage in supported outposts.</p><p><strong>Tools apply to every account.</strong></p><p class="setup-note">If you enable Tools, the app restarts once to finish setup.</p><div class="form-actions spread"><button class="secondary" @click="setupStep = 1">Back</button><span /><button class="secondary" @click="completeSetup(false)">Not now</button><button class="primary" @click="completeSetup(true)">Enable Tools</button></div></template>
      </div>
    </BaseModal>
  </div>
</template>
