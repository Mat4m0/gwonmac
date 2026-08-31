<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Clock3, ExternalLink, Newspaper, SlidersHorizontal, Swords } from "lucide-vue-next";
import type { LauncherExternalLink, LauncherSnapshot } from "@shared/launcher-contracts";

const props = defineProps<{ snapshot: LauncherSnapshot }>();
const emit = defineEmits<{
  settings: [];
  issues: [];
  external: [kind: LauncherExternalLink];
}>();
const contentTab = ref<"news" | "dailies">(props.snapshot.preferences.content.first);
const weekExpanded = ref(false);
const fixtureContent = computed(() => props.snapshot.contentAvailability.news === "fixture");

watch(() => props.snapshot.preferences.content, (content) => {
  if (!content[contentTab.value]) contentTab.value = content.first;
});

async function moveTab(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  contentTab.value = contentTab.value === "news" ? "dailies" : "news";
  await nextTick();
  document.querySelector<HTMLElement>(`#${contentTab.value}-tab`)?.focus();
}
</script>

<template>
  <section class="hero-panel" :class="{ 'hero-placeholder': !fixtureContent }">
    <div v-if="fixtureContent" class="hero-copy"><span class="eyebrow">Guild Wars · August 29</span><h1>Wayfarer’s Reverie starts Tuesday.</h1><p>The event includes quests across Tyria, Cantha, and Elona.</p><button class="text-link" @click="contentTab = 'news'">Read update <ExternalLink /></button></div>
    <div v-else class="hero-copy"><span class="eyebrow">Guild Wars Reforged</span><h1>Your accounts. One launcher.</h1><p>Updates, game files, Tools, and every Guild Wars window are managed here.</p></div>
  </section>
  <section v-if="snapshot.preferences.content.news || snapshot.preferences.content.dailies" class="home-panel">
    <div class="panel-head">
      <div v-if="snapshot.preferences.content.news && snapshot.preferences.content.dailies" class="segmented" role="tablist" aria-label="Home content" @keydown="moveTab">
        <button id="news-tab" role="tab" :tabindex="contentTab === 'news' ? 0 : -1" :aria-selected="contentTab === 'news'" aria-controls="news-panel" @click="contentTab = 'news'"><Newspaper />News</button>
        <button id="dailies-tab" role="tab" :tabindex="contentTab === 'dailies' ? 0 : -1" :aria-selected="contentTab === 'dailies'" aria-controls="dailies-panel" @click="contentTab = 'dailies'"><Clock3 />Dailies</button>
      </div>
      <h2 v-else>{{ snapshot.preferences.content.news ? 'News' : 'Dailies' }}</h2>
      <button class="customize" @click="emit('settings')"><SlidersHorizontal />Customize</button>
    </div>
    <div v-if="contentTab === 'news' && snapshot.contentAvailability.news === 'placeholder'" id="news-panel" role="tabpanel" aria-labelledby="news-tab" class="empty-state"><Newspaper /><h3>News is not connected yet.</h3><p>You can still read Guild Wars Reforged updates on the project website.</p><button class="secondary" @click="emit('external', 'github')">Open project updates <ExternalLink /></button></div>
    <div v-else-if="contentTab === 'news'" id="news-panel" role="tabpanel" aria-labelledby="news-tab" class="news-list">
      <article v-if="snapshot.preferences.content.officialNews"><span>Guild Wars</span><div><h3>Client stability update</h3><p>Fixed a cinematic crash and map reveal problems.</p></div><time>Aug 29</time></article>
      <article v-if="snapshot.preferences.content.reforgedNews"><span>Reforged</span><div><h3>The unified launcher is coming</h3><p>Accounts, Tools, downloads, and repair now live in one place.</p></div><time>New</time></article>
      <article><span>Issues</span><div><h3>Two known game issues</h3><p>Workarounds are available.</p></div><button @click="emit('issues')">View</button></article>
    </div>
    <div v-else-if="snapshot.contentAvailability.dailies === 'placeholder'" id="dailies-panel" role="tabpanel" aria-labelledby="dailies-tab" class="empty-state"><Clock3 /><h3>Daily activities are not connected yet.</h3><p>Use the Guild Wars Wiki for the current schedule.</p></div>
    <div v-else id="dailies-panel" role="tabpanel" aria-labelledby="dailies-tab" class="daily-view">
      <div class="daily-date"><span>Today · Aug 29</span><strong>Changes in 5h 18m</strong><small>18:00 local time</small></div>
      <div class="daily-grid"><article v-for="daily in ['Gate of Pain', 'Zoldark the Unholy', 'Random Arena', 'Skyward Reach', 'Justiciar Marron', 'Footman Tate', 'Baked Husks']" :key="daily"><Swords /><div><small>Daily activity</small><strong>{{ daily }}</strong></div><ExternalLink /></article></div>
      <template v-if="weekExpanded"><div v-for="day in ['Tomorrow · Aug 30', 'Monday · Aug 31', 'Tuesday · Sep 1', 'Wednesday · Sep 2', 'Thursday · Sep 3', 'Friday · Sep 4']" :key="day" class="daily-week-row"><strong>{{ day }}</strong><span>Zaishen Mission · Zaishen Bounty · Vanguard Quest</span></div></template>
      <button class="load-more" :aria-expanded="weekExpanded" @click="weekExpanded = !weekExpanded">{{ weekExpanded ? 'Show today only' : 'Show the next 7 days' }}</button>
    </div>
  </section>
</template>
