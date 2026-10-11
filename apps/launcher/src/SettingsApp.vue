<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { AlertTriangle, Contrast, FileText, FolderDown, Gamepad2, House, Image, Map as MapIcon, RefreshCw, Search, WandSparkles, X } from "lucide-vue-next";
import { SETTING_APPLIES_NOTE } from "@shared/setting-copy";
import { SETTINGS, SETTINGS_GROUP_LABELS, SETTINGS_SECTIONS, searchSettings, type SettingsSection, type SettingsTarget } from "@shared/settings-catalogue";
import type { LauncherPreferencesPatch, LauncherSettingsPatch, LauncherSnapshot } from "@shared/launcher-contracts";
import type { CacheInfo } from "@shared/contracts";
import { fixtureSnapshotFor } from "./fixtures";
import AppearanceSettings from "./components/AppearanceSettings.vue";
import GameFilesSettings from "./components/GameFilesSettings.vue";
import GameSettings from "./components/GameSettings.vue";
import GeneralUpdateSettings from "./components/GeneralUpdateSettings.vue";
import HomeScreenSettings from "./components/HomeScreenSettings.vue";
import MapsSettings from "./components/MapsSettings.vue";
import TexturePacksSettings from "./components/TexturePacksSettings.vue";
import ToolsSettings from "./components/ToolsSettings.vue";

const native = window.settingsNative;
// Native snapshots are replaced as a whole. Deep Vue proxies cannot cross
// Electron's context bridge when a saved preset is reused in an edit.
const snapshot = shallowRef<LauncherSnapshot>(fixtureSnapshotFor(window.location.search));
const synchronized = ref(!native);
const startupError = ref(false);
const icons: Record<SettingsSection, unknown> = {
  tools: WandSparkles, maps: MapIcon, appearance: Contrast, game: Gamepad2, "texture-packs": Image,
  "game-files": FolderDown, updates: RefreshCw, home: House, advanced: FileText,
};
const groups = (["game", "app"] as const).map(group => ({ label: SETTINGS_GROUP_LABELS[group], items: SETTINGS_SECTIONS.filter(section => section.group === group) }));

/** Opens on Tools, the most frequent change; afterwards on the last section in this session. */
const section = ref<SettingsSection>("tools");
const query = ref("");
const results = computed(() => searchSettings(query.value));
const content = ref<HTMLElement | null>(null);
const searchField = ref<HTMLInputElement | null>(null);
const sectionLabel = (id: SettingsSection) => SETTINGS_SECTIONS.find(candidate => candidate.id === id)!.label;

// One pending save prevents stale whole-preset edits. On failure, keep the visible
// draft and the exact operation until the player retries or reverts.
const saveState = ref<"idle" | "saving" | "failed" | "saved">("idle");
const savedNote = ref("");
const formVersion = ref(0);
const editedSetting = ref<{ label: string; note: string }>({ label: "Settings", note: "" });
let retrySave: (() => Promise<unknown>) | undefined;
const locked = computed(() => saveState.value === "saving" || saveState.value === "failed");

/** Names the control being changed, so the status line can say what was saved and when it applies. */
function identifySetting(event: Event) {
  const control = event.target;
  if (!(control instanceof HTMLElement) || locked.value) return;
  const id = control.closest<HTMLElement>("[data-setting]")?.dataset.setting;
  const entry = SETTINGS.find(candidate => candidate.id === id);
  const label = entry?.label ?? control.getAttribute("aria-label") ?? control.closest("label")?.querySelector("strong")?.textContent ?? "Settings";
  editedSetting.value = { label, note: entry?.applies ? SETTING_APPLIES_NOTE[entry.applies] : "" };
}

async function performSave(action: () => Promise<unknown>) {
  if (locked.value) throw new Error("Finish the pending settings change first.");
  saveState.value = "saving";
  retrySave = action;
  try {
    await action();
    saveState.value = "saved";
    savedNote.value = [`Saved: ${editedSetting.value.label}.`, editedSetting.value.note].filter(Boolean).join(" ");
    retrySave = undefined;
  } catch (error) {
    saveState.value = "failed";
    throw error;
  }
}
async function retry() {
  const action = retrySave;
  if (!action) return;
  saveState.value = "idle";
  try { await performSave(action); formVersion.value += 1; }
  catch { /* The status line owns this failure. */ }
}
function revert() {
  retrySave = undefined;
  saveState.value = "idle";
  formVersion.value += 1;
}

async function saveSettings(patch: LauncherSettingsPatch) {
  await performSave(async () => {
    if (native) await native.settings.update(patch);
    else snapshot.value = { ...snapshot.value, settings: { ...snapshot.value.settings, ...patch } };
  });
}
/** For sections that report their own failure: the status line keeps the retry. */
async function quietSave(patch: LauncherSettingsPatch) {
  try { await saveSettings(patch); } catch { /* The status line owns this failure. */ }
}
async function saveContent(content: NonNullable<LauncherPreferencesPatch["content"]>) {
  try {
    await performSave(async () => {
      if (native) await native.experience.updatePreferences({ content });
      else snapshot.value = { ...snapshot.value, preferences: { ...snapshot.value.preferences, content: { ...snapshot.value.preferences.content, ...content } } };
    });
  } catch { /* The status line owns this failure. */ }
}

const actionError = ref("");
async function run(message: string, action: () => Promise<unknown> | undefined) {
  actionError.value = "";
  try { await action(); return true; }
  catch { actionError.value = message; return false; }
}
const gameFilesInfo = ref<CacheInfo | null>(null);
const gameFilesLoading = ref(false);
async function loadGameFilesInfo() {
  if (!native) {
    gameFilesInfo.value = { bytes: 8_400_000_000, chunks: 4200, totalBytes: 9_100_000_000, totalChunks: 4550, freeBytes: 80_000_000_000, fullDownloadShortfall: 0 };
    return;
  }
  gameFilesLoading.value = true;
  await run("Game file details could not be loaded.", async () => { gameFilesInfo.value = await native.gameFiles.info(); });
  gameFilesLoading.value = false;
}
async function gameFilesAction(message: string, action: () => Promise<void> | undefined) {
  if (await run(message, action)) await loadGameFilesInfo();
}

async function select(next: SettingsSection) {
  query.value = "";
  section.value = next;
  actionError.value = "";
  if (next === "game-files") void loadGameFilesInfo();
  await nextTick();
  if (content.value) content.value.scrollTop = 0;
}

let highlightTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Shows a section and, when named, focuses its control: opens the disclosure that holds it,
 * scrolls it into view and marks it briefly. A control hidden with its tool off falls back to
 * the tool's row, then to the section heading.
 */
async function open(target: SettingsTarget) {
  await select(target.section);
  const root = content.value;
  if (!root) return;
  const entry = SETTINGS.find(candidate => candidate.id === target.control);
  const find = (id: string | undefined) => id ? root.querySelector<HTMLElement>(`[data-setting="${CSS.escape(id)}"]`) : null;
  const row = find(entry?.id) ?? find(entry?.tool && `tool:${entry.tool}`);
  if (!row) { root.querySelector<HTMLElement>("h1")?.focus(); return; }
  for (let parent = row.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  await nextTick();
  row.scrollIntoView({ block: "center" });
  const control = row.matches("input, select, button, textarea") ? row : row.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea");
  (control ?? row).focus({ preventScroll: true });
  root.querySelectorAll(".setting-focus").forEach(element => element.classList.remove("setting-focus"));
  row.classList.add("setting-focus");
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => row.classList.remove("setting-focus"), 2400);
}

function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Escape" && query.value) { event.preventDefault(); query.value = ""; }
  else if (event.key === "Enter" && results.value[0]) { event.preventDefault(); void openResult(results.value[0].id); }
}
async function openResult(id: string) {
  const entry = SETTINGS.find(candidate => candidate.id === id)!;
  await open({ section: entry.section, control: entry.id });
}

/** Command-F finds a setting, as in macOS Settings. */
function onKey(event: KeyboardEvent) {
  if (event.key === "f" && event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); searchField.value?.focus(); searchField.value?.select(); }
}

let unsubscribe: (() => void) | undefined;
let unsubscribeTarget: (() => void) | undefined;
onMounted(async () => {
  window.addEventListener("keydown", onKey);
  if (!native) { void open({ section: "tools" }); return; }
  let receivedRevision = -1;
  const apply = (next: LauncherSnapshot) => {
    if (next.revision < receivedRevision) return;
    receivedRevision = next.revision;
    snapshot.value = next;
  };
  unsubscribe = native.state.onChange(apply);
  unsubscribeTarget = native.target.onRequest(target => void open(target));
  try {
    apply(await native.state.get());
    const target = await native.target.take();
    synchronized.value = true;
    await nextTick();
    await open(target ?? { section: section.value });
  } catch {
    startupError.value = true;
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  unsubscribe?.();
  unsubscribeTarget?.();
  clearTimeout(highlightTimer);
});
</script>

<template>
  <div v-if="startupError" class="launcher-boot launcher-error" role="alert"><AlertTriangle /><h1>Settings could not open</h1><p>Your settings were not changed. Close this window and try again.</p></div>
  <div v-else-if="!synchronized" class="launcher-boot" role="status">Opening Settings…</div>
  <div v-else class="settings-window settings-shell">
    <section class="settings-page">
      <aside aria-label="Settings sections">
        <label class="settings-search">
          <Search aria-hidden="true" />
          <input ref="searchField" v-model="query" type="search" placeholder="Search settings" aria-label="Search settings" aria-controls="settings-content" @keydown="onSearchKey" />
          <button v-if="query" type="button" class="icon-button" aria-label="Clear search" @click="query = ''; searchField?.focus()"><X /></button>
        </label>
        <div v-for="group in groups" :key="group.label" class="settings-nav-group" role="group" :aria-label="group.label">
          <h3>{{ group.label }}</h3>
          <button v-for="item in group.items" :key="item.id" :aria-current="!query && section === item.id ? 'page' : undefined" :class="{ active: !query && section === item.id }" @click="select(item.id)"><component :is="icons[item.id]" aria-hidden="true" />{{ item.label }}</button>
        </div>
      </aside>
      <div class="settings-main">
        <div id="settings-content" ref="content" class="settings-content">
          <template v-if="query">
            <h1>Results</h1>
            <p v-if="results.length" class="section-intro" role="status">{{ results.length === 1 ? "1 setting" : `${results.length} settings` }} for “{{ query }}”. Choose one to go to it.</p>
            <p v-else class="section-intro" role="status">No setting matches. Try a word like memory, keys, chat or compass.</p>
            <ul v-if="results.length" class="settings-results">
              <li v-for="entry in results" :key="entry.id"><button @click="openResult(entry.id)"><span><strong>{{ entry.label }}</strong><small v-if="entry.detail">{{ entry.detail }}</small></span><small>{{ sectionLabel(entry.section) }}</small></button></li>
            </ul>
          </template>
          <fieldset v-else :key="`${section}:${formVersion}`" class="settings-fields" :disabled="locked" :aria-busy="saveState === 'saving'" @change.capture="identifySetting" @click.capture="identifySetting">
            <legend class="visually-hidden">Settings for every account</legend>
            <ToolsSettings v-if="section === 'tools'" :snapshot="snapshot" :api="native" :save="saveSettings" :perform-save="performSave" @maps="select('maps')" />
            <MapsSettings v-else-if="section === 'maps'" :settings="snapshot.settings" :shortcuts="snapshot.shortcuts" :tools="snapshot.tools" :api="native?.tools" :save="saveSettings" :perform-save="performSave" @tools="select('tools')" />
            <template v-else-if="section === 'appearance'"><h1>Appearance</h1><AppearanceSettings :settings="snapshot.settings" :save="saveSettings" /></template>
            <GameSettings v-else-if="section === 'game'" :snapshot="snapshot" :save="quietSave" />
            <TexturePacksSettings v-else-if="section === 'texture-packs'" :texture-packs="snapshot.texturePacks" />
            <GameFilesSettings
              v-else-if="section === 'game-files'"
              :readiness="snapshot.readiness"
              :info="gameFilesInfo"
              :loading="gameFilesLoading"
              :repair="() => gameFilesAction('Game files could not be repaired.', () => native?.gameFiles.repair())"
              :pause="() => gameFilesAction('The download could not be paused.', () => native?.gameFiles.pauseDownload())"
              :resume="() => gameFilesAction('The download could not be resumed.', () => native?.gameFiles.resumeDownload())"
              :reset="() => run('Game files could not be reset.', () => native?.gameFiles.resetAndRestart()).then(() => undefined)"
            />
            <GeneralUpdateSettings
              v-else-if="section === 'updates'"
              :settings="snapshot.settings"
              :update="snapshot.appUpdate"
              :save="quietSave"
              :check="() => run('Could not check for updates.', () => native?.updates.check()).then(() => undefined)"
              :restart="() => run('The update could not be installed.', () => native?.updates.restartAndInstall()).then(() => undefined)"
              :open-releases="() => run('The link could not be opened.', () => native?.external.open('releases')).then(() => undefined)"
            />
            <HomeScreenSettings v-else-if="section === 'home'" :content="snapshot.preferences.content" :save="saveContent" />
            <template v-else>
              <h1>Advanced</h1>
              <div class="setting-group">
                <div class="setting-row" data-setting="openLogs"><span><strong>Open logs</strong><small>Show the log folder in Finder, for a bug report.</small></span><button class="secondary" @click="run('Logs could not be opened.', () => native?.external.revealLogs())"><FileText />Open logs</button></div>
              </div>
              <details class="settings-reset" data-setting="resetAllSettings"><summary>Reset all app settings</summary><p>Restores launcher and game preferences, Tools, shortcuts, custom map styles and panel colors. Original textures will be selected. Accounts and game files are kept.</p><button class="danger-button" @click="run('Settings could not be reset.', () => native?.settings.reset())">Reset all app settings…</button></details>
            </template>
            <p v-if="actionError" role="alert" class="inline-message">{{ actionError }}</p>
          </fieldset>
        </div>
        <footer class="settings-status" :class="{ 'save-failed': saveState === 'failed' }" :role="saveState === 'failed' ? 'alert' : 'status'">
          <template v-if="saveState === 'saving'">Saving…</template>
          <template v-else-if="saveState === 'failed'"><span><strong>{{ editedSetting.label }} could not be saved.</strong> The change shown is not saved.</span><span class="save-actions"><button class="secondary" @click="retry">Retry</button><button class="secondary" @click="revert">Revert</button></span></template>
          <template v-else-if="saveState === 'saved'">{{ savedNote }}</template>
          <template v-else>Changes save right away and apply in every game window.</template>
        </footer>
      </div>
    </section>
  </div>
</template>
