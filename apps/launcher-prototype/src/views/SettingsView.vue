<script setup lang="ts">
import type { Component } from "vue";
import { Download, House, Monitor, RotateCcw, Wrench } from "@lucide/vue";
import ShortcutRecorder from "../components/ShortcutRecorder.vue";
import { dailyActivities } from "../data/dailies";
import type { LauncherSettings, SettingsSection } from "../model";

defineProps<{ activeSection: SettingsSection }>();
const settings = defineModel<LauncherSettings>("settings", { required: true });
const emit = defineEmits<{
  "update:active-section": [section: SettingsSection];
  redownloadGameFiles: [];
}>();

const sections: Array<{ id: SettingsSection; label: string; icon: Component }> = [
  { id: "updates", label: "Game and updates", icon: Download },
  { id: "home", label: "Home", icon: House },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "display", label: "Display", icon: Monitor },
];

type ShortcutKey = keyof LauncherSettings["shortcuts"];
const unavailableShortcuts = (current: ShortcutKey) =>
  Object.entries(settings.value.shortcuts)
    .filter(([key, shortcut]) => key !== current && shortcut)
    .map(([, shortcut]) => shortcut);
</script>

<template>
  <div class="section-layout">
    <aside class="section-sidebar">
      <span class="eyebrow">Launcher</span>
      <h1>Settings</h1>
      <nav aria-label="Settings sections">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          :class="{ active: activeSection === section.id }"
          :aria-current="activeSection === section.id ? 'page' : undefined"
          @click="emit('update:active-section', section.id)"
        >
          <component :is="section.icon" aria-hidden="true" />
          {{ section.label }}
        </button>
      </nav>
    </aside>

    <section class="section-content settings-screen">
      <div v-if="activeSection === 'updates'">
        <div class="content-heading">
          <div><span class="eyebrow">Settings</span><h1>Game and updates</h1><p>Keep the launcher and game files ready.</p></div>
        </div>
        <div class="setting-groups">
          <section class="setting-group">
            <h2>Launcher updates</h2>
            <label class="setting-row">
              <span><strong>Download updates automatically</strong><small>Checks when you open the launcher.</small></span>
              <input v-model="settings.automaticUpdates" class="switch" type="checkbox" />
            </label>
            <label class="setting-row">
              <span><strong>Release track</strong><small>Stable is recommended for most people.</small></span>
              <select v-model="settings.releaseTrack"><option value="stable">Stable</option><option value="beta">Beta</option></select>
            </label>
          </section>
          <section class="setting-group">
            <h2>Game files</h2>
            <div class="setting-row maintenance-setting-row">
              <span><strong>Redownload game files</strong><small>Replace only downloaded game data. Templates, screenshots, accounts, and settings stay in place.</small></span>
              <button class="secondary-button" type="button" @click="emit('redownloadGameFiles')">
                <RotateCcw aria-hidden="true" />
                Redownload…
              </button>
            </div>
          </section>
        </div>
      </div>

      <div v-else-if="activeSection === 'home'">
        <div class="content-heading">
          <div><span class="eyebrow">Settings</span><h1>Home</h1><p>Choose what appears beside the featured update.</p></div>
        </div>
        <div class="setting-groups">
          <section class="setting-group">
            <h2>Home tabs</h2>
            <label class="setting-row">
              <span><strong>Show dailies</strong><small>Adds daily Guild Wars activities beside News.</small></span>
              <input v-model="settings.showDailies" class="switch" type="checkbox" />
            </label>
            <label v-if="settings.showDailies" class="setting-row">
              <span><strong>Open Home with</strong><small>The selected tab also appears first.</small></span>
              <select v-model="settings.defaultHomePanel">
                <option value="news">News</option>
                <option value="dailies">Dailies</option>
              </select>
            </label>
          </section>
          <section class="setting-group">
            <h2>News sources</h2>
            <label class="setting-row">
              <span><strong>Show Guild Wars news</strong><small>Official game updates, events, and patch notes.</small></span>
              <input v-model="settings.showGuildWarsNews" class="switch" type="checkbox" />
            </label>
            <label class="setting-row">
              <span><strong>Show Reforged for macOS news</strong><small>Launcher releases, Tools updates, and project notices.</small></span>
              <input v-model="settings.showMacNews" class="switch" type="checkbox" />
            </label>
          </section>
          <section v-if="settings.showDailies" class="setting-group">
            <h2>Daily activities</h2>
            <div class="settings-check-grid">
              <label v-for="activity in dailyActivities" :key="activity.kind">
                <input v-model="settings.dailyActivityVisibility[activity.kind]" type="checkbox" />
                {{ activity.label }}
              </label>
            </div>
          </section>
          <p v-if="!settings.showGuildWarsNews && !settings.showMacNews" class="inline-notice">News will show a link back to these settings.</p>
        </div>
      </div>

      <div v-else-if="activeSection === 'tools'">
        <div class="content-heading">
          <div><span class="eyebrow">Settings</span><h1>Tools</h1><p>Turn on only the Tools you use. Guild Wars works without them.</p></div>
        </div>
        <div class="setting-groups">
          <section class="setting-group">
            <h2>General</h2>
            <label class="setting-row">
              <span><strong>Enable Tools Beta</strong><small>Adds optional in-game features.</small></span>
              <input v-model="settings.toolsEnabled" class="switch" type="checkbox" />
            </label>
            <label v-if="settings.toolsEnabled" class="setting-row">
              <span><strong>Interface style</strong><small>Changes the in-game Tools interface.</small></span>
              <select v-model="settings.interfaceStyle"><option value="guild-wars">Guild Wars</option><option value="reforged">Reforged</option><option value="modern">Modern</option></select>
            </label>
          </section>

          <section v-if="settings.toolsEnabled" class="setting-group tool-settings-group">
            <h2>Tools</h2>
            <div class="tool-setting">
              <label class="setting-row">
                <span><strong>Build management</strong><small>Save and organize character and team builds.</small></span>
                <input v-model="settings.buildManagement" class="switch" type="checkbox" />
              </label>
              <div v-if="settings.buildManagement" class="tool-shortcut-row">
                <span>Keyboard shortcut</span>
                <ShortcutRecorder
                  v-model="settings.shortcuts.buildManagement"
                  label="Build management"
                  :unavailable-shortcuts="unavailableShortcuts('buildManagement')"
                />
              </div>
            </div>
            <div class="tool-setting">
              <label class="setting-row">
                <span><strong>Quick Travel</strong><small>Search destinations and save favorites.</small></span>
                <input v-model="settings.quickTravel" class="switch" type="checkbox" />
              </label>
              <div v-if="settings.quickTravel" class="tool-shortcut-row">
                <span>Keyboard shortcut</span>
                <ShortcutRecorder
                  v-model="settings.shortcuts.quickTravel"
                  label="Quick Travel"
                  :unavailable-shortcuts="unavailableShortcuts('quickTravel')"
                />
              </div>
            </div>
            <div class="tool-setting">
              <label class="setting-row">
                <span><strong>Xunlai storage</strong><small>Open storage in supported PvE outposts.</small></span>
                <input v-model="settings.xunlaiStorage" class="switch" type="checkbox" />
              </label>
              <div v-if="settings.xunlaiStorage" class="tool-shortcut-row">
                <span>Keyboard shortcut</span>
                <ShortcutRecorder
                  v-model="settings.shortcuts.xunlaiStorage"
                  label="Xunlai storage"
                  :unavailable-shortcuts="unavailableShortcuts('xunlaiStorage')"
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <div v-else>
        <div class="content-heading">
          <div><span class="eyebrow">Settings</span><h1>Display</h1><p>Balance image quality and performance.</p></div>
        </div>
        <div class="setting-groups">
          <section class="setting-group">
            <h2>Rendering</h2>
            <label class="setting-row">
              <span><strong>Render scale</strong><small>Lower this if Guild Wars runs slowly.</small></span>
              <select v-model="settings.renderScale"><option value="2">Retina · 2×</option><option value="1.5">Balanced · 1.5×</option><option value="1">Performance · 1×</option></select>
            </label>
          </section>
        </div>
      </div>
    </section>
  </div>
</template>
