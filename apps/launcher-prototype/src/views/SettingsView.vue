<script setup lang="ts">
import type { Component } from "vue";
import { Command, Download, Monitor, Newspaper, Wrench } from "@lucide/vue";
import type { LauncherSettings, SettingsSection } from "../model";

defineProps<{
  activeSection: SettingsSection;
}>();

const settings = defineModel<LauncherSettings>("settings", { required: true });

const emit = defineEmits<{
  "update:active-section": [section: SettingsSection];
  save: [];
}>();

const sections: Array<{ id: SettingsSection; label: string; icon: Component }> = [
  { id: "updates", label: "Updates and game files", icon: Download },
  { id: "news", label: "News", icon: Newspaper },
  { id: "tools", label: "Optional Tools", icon: Wrench },
  { id: "display", label: "Display", icon: Monitor },
  { id: "shortcuts", label: "Shortcuts", icon: Command },
];
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
          @click="emit('update:active-section', section.id)"
        >
          <component :is="section.icon" aria-hidden="true" />
          {{ section.label }}
        </button>
      </nav>
    </aside>

    <section class="section-content settings-screen">
      <div v-if="activeSection === 'updates'">
        <div class="content-heading"><div><span class="eyebrow">Settings</span><h1>Updates and game files</h1></div></div>
        <div class="setting-groups">
          <section class="setting-group">
            <h2>App updates</h2>
            <label class="setting-row">
              <span><strong>Download app updates automatically</strong><small>Checks when you open the launcher.</small></span>
              <input v-model="settings.automaticUpdates" class="switch" type="checkbox" />
            </label>
            <label class="setting-row">
              <span><strong>Release track</strong><small>Stable is recommended for most people.</small></span>
              <select v-model="settings.releaseTrack"><option value="stable">Stable</option><option value="beta">Beta</option></select>
            </label>
          </section>
          <section class="setting-group">
            <h2>Game files</h2>
            <div class="setting-row">
              <span><strong>Complete game download</strong><small>26.4 GB downloaded · 4.8 GB left</small></span>
              <button class="secondary-button" type="button">Download now</button>
            </div>
          </section>
        </div>
      </div>

      <div v-else-if="activeSection === 'news'">
        <div class="content-heading"><div><span class="eyebrow">Settings</span><h1>News</h1><p>Choose which updates appear on Home and in News.</p></div></div>
        <div class="setting-groups">
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
          <p v-if="!settings.showGuildWarsNews && !settings.showMacNews" class="inline-notice">Home will show launcher status instead of news. You can turn either source back on here.</p>
        </div>
      </div>

      <div v-else-if="activeSection === 'tools'">
        <div class="content-heading"><div><span class="eyebrow">Settings</span><h1>Optional Tools</h1><p>Turn on only the features you want. Guild Wars works without them.</p></div></div>
        <div class="setting-groups">
          <section class="setting-group">
            <h2>Tools</h2>
            <label class="setting-row">
              <span><strong>Enable optional Tools Beta</strong><small>Adds Builds, Teams, Quick Travel, and storage shortcuts.</small></span>
              <input v-model="settings.toolsEnabled" class="switch" type="checkbox" />
            </label>
          </section>
          <section class="setting-group" :class="{ disabled: !settings.toolsEnabled }">
            <h2>Choose Tools</h2>
            <label class="setting-row"><span><strong>Quick Travel</strong><small>Search destinations and save shortcuts.</small></span><input v-model="settings.quickTravel" class="switch" type="checkbox" :disabled="!settings.toolsEnabled" /></label>
            <label class="setting-row"><span><strong>Open Xunlai storage</strong><small>Open storage in supported PvE outposts.</small></span><input v-model="settings.xunlaiStorage" class="switch" type="checkbox" :disabled="!settings.toolsEnabled" /></label>
            <label class="setting-row"><span><strong>Apply teams</strong><small>Adds an Apply button in supported PvE outposts. Nothing runs automatically.</small></span><input v-model="settings.applyTeams" class="switch" type="checkbox" :disabled="!settings.toolsEnabled" /></label>
          </section>
        </div>
      </div>

      <div v-else-if="activeSection === 'display'">
        <div class="content-heading"><div><span class="eyebrow">Settings</span><h1>Display</h1></div></div>
        <div class="setting-groups"><section class="setting-group"><h2>Rendering</h2><label class="setting-row"><span><strong>Render scale</strong><small>Lower this if the game runs slowly.</small></span><select v-model="settings.renderScale"><option value="2">Retina · 2×</option><option value="1.5">Balanced · 1.5×</option><option value="1">Performance · 1×</option></select></label><label class="setting-row"><span><strong>Interface style</strong><small>Changes the in-game Tools interface.</small></span><select v-model="settings.interfaceStyle"><option value="guild-wars">Guild Wars</option><option value="reforged">Reforged</option><option value="modern">Modern</option></select></label></section></div>
      </div>

      <div v-else>
        <div class="content-heading"><div><span class="eyebrow">Settings</span><h1>Keyboard shortcuts</h1></div></div>
        <div class="setting-groups"><section class="setting-group"><h2>While Guild Wars is active</h2><div class="setting-row"><span><strong>Show or hide Tools</strong><small>Command-B</small></span><button class="secondary-button" type="button">Change</button></div><div class="setting-row"><span><strong>Quick Travel</strong><small>Command-T</small></span><button class="secondary-button" type="button">Change</button></div><div class="setting-row"><span><strong>Open Xunlai storage</strong><small>Command-Shift-C</small></span><button class="secondary-button" type="button">Change</button></div></section></div>
      </div>

      <div class="save-row"><span>Changes apply to this prototype immediately.</span><button class="primary-button" type="button" @click="emit('save')">Save settings</button></div>
    </section>
  </div>
</template>
