<script setup lang="ts">
import type { LauncherPreferencesPatch, LauncherSnapshot } from "@shared/launcher-contracts";

defineProps<{ content: LauncherSnapshot["preferences"]["content"]; save: (content: NonNullable<LauncherPreferencesPatch["content"]>) => Promise<void> }>();
const checked = (event: Event) => (event.currentTarget as HTMLInputElement).checked;
</script>

<template>
  <h1>Home screen</h1>
  <p class="section-intro">Choose what the launcher's Home shows. Beta release notes appear only while the Beta update channel is selected.</p>
  <div class="setting-group">
    <label data-setting="content.news"><span><strong>News</strong><small>Game, event, and GWonMac updates.</small></span><input type="checkbox" :checked="content.news" @change="save({ news: checked($event) })" /></label>
    <label data-setting="content.dailies"><span><strong>Dailies</strong><small>Daily activities and the weekly schedule.</small></span><input type="checkbox" :checked="content.dailies" @change="save({ dailies: checked($event) })" /></label>
    <label v-if="content.news && content.dailies"><span><strong>First Home tab</strong></span><select :value="content.first" @change="save({ first: ($event.currentTarget as HTMLSelectElement).value as 'news' | 'dailies' })"><option value="news">News</option><option value="dailies">Dailies</option></select></label>
  </div>
  <template v-if="content.news">
    <h2 class="settings-subheading">News sources</h2>
    <div class="setting-group">
      <label><span><strong>Guild Wars updates</strong><small>Official game update notes from the Guild Wars Wiki.</small></span><input type="checkbox" :checked="content.officialNews" @change="save({ officialNews: checked($event) })" /></label>
      <label><span><strong>Upcoming events</strong><small>Important seasonal events and their dates.</small></span><input type="checkbox" :checked="content.eventNews" @change="save({ eventNews: checked($event) })" /></label>
      <label><span><strong>GWonMac releases</strong><small>Player-focused release notes for your update channel.</small></span><input type="checkbox" :checked="content.reforgedNews" @change="save({ reforgedNews: checked($event) })" /></label>
      <label><span><strong>Rotate featured news</strong><small>Change the featured story every 12 seconds. Reduced Motion always turns rotation off.</small></span><input type="checkbox" :checked="content.autoRotateNews" @change="save({ autoRotateNews: checked($event) })" /></label>
    </div>
  </template>
</template>
