<script lang="ts">
import type { SettingsSection as Section } from "@shared/settings-catalogue";
/** The last section shown in this launcher session; Settings reopens there. Tools comes first. */
let lastSection: Section = "tools";
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowUpRight, Contrast, FileText, FolderDown, Gamepad2, House, Image, Map as MapIcon, RefreshCw, Search, WandSparkles, X } from "lucide-vue-next";
import { SETTING_APPLIES_NOTE } from "@shared/setting-copy";
import { HUB_SECTIONS, SETTINGS, SETTINGS_GROUP_LABELS, SETTINGS_SECTIONS, searchSettings, type SettingsSection, type SettingsTarget } from "@shared/settings-catalogue";
import type { LauncherNativeApi, LauncherPreferencesPatch, LauncherSettingsPatch, LauncherSnapshot } from "@shared/launcher-contracts";
import type { InGameNative, InGamePatch, InGameSnapshot } from "../settings-host";
import type { CacheInfo } from "@shared/contracts";
import AppearanceSettings from "./AppearanceSettings.vue";
import GameFilesSettings from "./GameFilesSettings.vue";
import GameSettings from "./GameSettings.vue";
import GeneralUpdateSettings from "./GeneralUpdateSettings.vue";
import HomeScreenSettings from "./HomeScreenSettings.vue";
import MapsSettings from "./MapsSettings.vue";
import TexturePacksSettings from "./TexturePacksSettings.vue";
import ToolsSettings from "./ToolsSettings.vue";

/**
 * The one Settings page (docs/settings.md), drawn in the launcher and in the Hub. The launcher
 * passes `launcher` and shows every section; the Hub shows the in-game sections and opens the
 * launcher for the rest. Without a native bridge (fixtures, tests) changes apply to the shown
 * snapshot only.
 */
const props = defineProps<{
  snapshot: InGameSnapshot;
  native: InGameNative | undefined;
  /** The launcher's own snapshot and bridge, for its sections; absent in the Hub. */
  launcher?: Readonly<{ snapshot: LauncherSnapshot; native: LauncherNativeApi | undefined }> | undefined;
  /** Hub only: shows a launcher section, at its control when named. */
  openInLauncher?: ((target: SettingsTarget) => void) | undefined;
  /** Where to open; a new object opens it again, even at the same control. */
  target: SettingsTarget | null;
}>();
const emit = defineEmits<{
  /** Fixture mode only: the snapshot with a change applied. */
  fixture: [snapshot: LauncherSnapshot];
  section: [section: SettingsSection];
}>();
const native = props.native;
const snapshot = computed(() => props.snapshot);
const icons: Record<SettingsSection, unknown> = {
  tools: WandSparkles, maps: MapIcon, appearance: Contrast, game: Gamepad2, "texture-packs": Image,
  "game-files": FolderDown, updates: RefreshCw, home: House, advanced: FileText,
};
const groups = (["game", "app"] as const).map(group => ({ label: SETTINGS_GROUP_LABELS[group], items: SETTINGS_SECTIONS.filter(section => section.group === group) }));
/** In the Hub, the launcher's sections stay listed and open the launcher. */
const inLauncher = (id: SettingsSection) => !props.launcher && !HUB_SECTIONS.has(id);

const section = ref<SettingsSection>(lastSection);
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
  // The locked fieldset drops focus from the control being saved; it gets it back once the save settles.
  const focused = document.activeElement;
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
  } finally {
    void nextTick(() => {
      if (focused instanceof HTMLElement && focused.isConnected && !locked.value && (!document.activeElement || document.activeElement === document.body)) focused.focus({ preventScroll: true });
    });
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

const launcherNative = props.launcher?.native;
async function saveSettings(patch: InGamePatch) {
  await saveLauncherSettings(patch);
}
async function saveLauncherSettings(patch: LauncherSettingsPatch) {
  await performSave(async () => {
    if (native) await native.settings.update(patch);
    else if (props.launcher) emit("fixture", { ...props.launcher.snapshot, settings: { ...props.launcher.snapshot.settings, ...patch } });
  });
}
/** For sections that report their own failure: the status line keeps the retry. */
async function quietSave(patch: LauncherSettingsPatch) {
  try { await saveLauncherSettings(patch); } catch { /* The status line owns this failure. */ }
}
async function saveContent(content: NonNullable<LauncherPreferencesPatch["content"]>) {
  try {
    await performSave(async () => {
      if (launcherNative) await launcherNative.experience.updatePreferences({ content });
      else if (props.launcher) emit("fixture", { ...props.launcher.snapshot, preferences: { ...props.launcher.snapshot.preferences, content: { ...props.launcher.snapshot.preferences.content, ...content } } });
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
  if (!launcherNative) {
    gameFilesInfo.value = { bytes: 8_400_000_000, chunks: 4200, totalBytes: 9_100_000_000, totalChunks: 4550, freeBytes: 80_000_000_000, fullDownloadShortfall: 0 };
    return;
  }
  gameFilesLoading.value = true;
  await run("Game file details could not be loaded.", async () => { gameFilesInfo.value = await launcherNative.gameFiles.info(); });
  gameFilesLoading.value = false;
}
async function gameFilesAction(message: string, action: () => Promise<void> | undefined) {
  if (await run(message, action)) await loadGameFilesInfo();
}

async function select(next: SettingsSection) {
  if (inLauncher(next)) { props.openInLauncher?.({ section: next }); return; }
  query.value = "";
  section.value = lastSection = next;
  emit("section", next);
  actionError.value = "";
  if (next === "game-files") void loadGameFilesInfo();
  await nextTick();
  if (!content.value) return;
  content.value.scrollTop = 0;
  // A screen reader hears where it landed; Tab continues from the section's top.
  const heading = content.value.querySelector<HTMLElement>("h1");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
}

let highlightTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Shows a section and, when named, focuses its control: opens the disclosure that holds it,
 * scrolls it into view and marks it briefly. A control hidden with its tool off falls back to
 * the tool's row, then to the section heading.
 */
async function open(target: SettingsTarget) {
  if (inLauncher(target.section)) { props.openInLauncher?.(target); return; }
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

watch(() => props.target, target => { if (target) void open(target); });
onMounted(() => {
  window.addEventListener("keydown", onKey);
  void open(props.target ?? { section: section.value });
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  clearTimeout(highlightTimer);
});
</script>

<template>
  <div class="settings-view">
    <section class="settings-page">
      <aside aria-label="Settings sections">
        <label class="settings-search">
          <Search aria-hidden="true" />
          <input ref="searchField" v-model="query" type="search" placeholder="Search settings" aria-label="Search settings" aria-controls="settings-content" @keydown="onSearchKey" />
          <button v-if="query" type="button" class="icon-button" aria-label="Clear search" @click="query = ''; searchField?.focus()"><X /></button>
        </label>
        <div v-for="group in groups" :key="group.label" class="settings-nav-group" role="group" :aria-label="group.label">
          <h3>{{ group.label }}</h3>
          <button v-for="item in group.items" :key="item.id" :aria-current="!query && section === item.id ? 'page' : undefined" :class="{ active: !query && section === item.id }" @click="select(item.id)"><component :is="icons[item.id]" aria-hidden="true" />{{ item.label }}<ArrowUpRight v-if="inLauncher(item.id)" class="opens-launcher" aria-label="opens the launcher" /></button>
        </div>
      </aside>
      <div class="settings-main">
        <div id="settings-content" ref="content" class="settings-content">
          <template v-if="query">
            <h1>Results</h1>
            <p v-if="results.length" class="section-intro" role="status">{{ results.length === 1 ? "1 setting" : `${results.length} settings` }} for “{{ query }}”. Choose one to go to it.</p>
            <p v-else class="section-intro" role="status">No setting matches. Try a word like memory, keys, chat or compass.</p>
            <ul v-if="results.length" class="settings-results">
              <li v-for="entry in results" :key="entry.id"><button @click="openResult(entry.id)"><span><strong>{{ entry.label }}</strong><small v-if="entry.detail">{{ entry.detail }}</small></span><small>{{ inLauncher(entry.section) ? `${sectionLabel(entry.section)} · in the launcher` : sectionLabel(entry.section) }}</small></button></li>
            </ul>
          </template>
          <fieldset v-else :key="`${section}:${formVersion}`" class="settings-fields" :disabled="locked" :aria-busy="saveState === 'saving'" @change.capture="identifySetting" @click.capture="identifySetting">
            <legend class="visually-hidden">Settings for every account</legend>
            <ToolsSettings v-if="section === 'tools'" :snapshot="snapshot" :api="native" :profiles="launcher?.snapshot.profiles" :save="saveSettings" :perform-save="performSave" @maps="select('maps')" />
            <MapsSettings v-else-if="section === 'maps'" :settings="snapshot.settings" :shortcuts="snapshot.shortcuts" :tools="snapshot.tools" :api="native?.tools" :save="saveSettings" :perform-save="performSave" @tools="select('tools')" />
            <template v-else-if="section === 'appearance'"><h1>Appearance</h1><AppearanceSettings :settings="snapshot.settings" :save="saveSettings" /></template>
            <GameSettings v-else-if="section === 'game'" :snapshot="snapshot" :extended-memory="launcher?.snapshot.extendedMemory" :save="quietSave" />
            <TexturePacksSettings v-else-if="section === 'texture-packs' && launcher" :texture-packs="launcher.snapshot.texturePacks" />
            <GameFilesSettings
              v-else-if="section === 'game-files' && launcher"
              :readiness="launcher.snapshot.readiness"
              :info="gameFilesInfo"
              :loading="gameFilesLoading"
              :repair="() => gameFilesAction('Game files could not be repaired.', () => launcherNative?.gameFiles.repair())"
              :pause="() => gameFilesAction('The download could not be paused.', () => launcherNative?.gameFiles.pauseDownload())"
              :resume="() => gameFilesAction('The download could not be resumed.', () => launcherNative?.gameFiles.resumeDownload())"
              :reset="() => run('Game files could not be reset.', () => launcherNative?.gameFiles.resetAndRestart()).then(() => undefined)"
            />
            <GeneralUpdateSettings
              v-else-if="section === 'updates' && launcher"
              :settings="launcher.snapshot.settings"
              :update="launcher.snapshot.appUpdate"
              :save="quietSave"
              :check="() => run('Could not check for updates.', () => launcherNative?.updates.check()).then(() => undefined)"
              :restart="() => run('The update could not be installed.', () => launcherNative?.updates.restartAndInstall()).then(() => undefined)"
              :open-releases="() => run('The link could not be opened.', () => launcherNative?.external.open('releases')).then(() => undefined)"
            />
            <HomeScreenSettings v-else-if="section === 'home' && launcher" :content="launcher.snapshot.preferences.content" :save="saveContent" />
            <template v-else-if="launcher">
              <h1>Advanced</h1>
              <div class="setting-group">
                <div class="setting-row" data-setting="openLogs"><span><strong>Open logs</strong><small>Show the log folder in Finder, for a bug report.</small></span><button class="secondary" @click="run('Logs could not be opened.', () => launcherNative?.external.revealLogs())"><FileText />Open logs</button></div>
              </div>
              <details class="settings-reset" data-setting="resetAllSettings"><summary>Reset all app settings</summary><p>Restores launcher and game preferences, Tools, shortcuts, custom map styles and panel colors. Original textures will be selected. Accounts and game files are kept.</p><button class="danger-button" @click="run('Settings could not be reset.', () => launcherNative?.settings.reset())">Reset all app settings…</button></details>
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
