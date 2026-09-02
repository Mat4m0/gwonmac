<script setup lang="ts">
import { computed, ref } from "vue";
import { ExternalLink, SlidersHorizontal } from "lucide-vue-next";
import type { LauncherNewsState, LauncherNewsStory, LauncherNewsSource } from "@shared/launcher-contracts";

const props = defineProps<{ news: LauncherNewsState }>();
const emit = defineEmits<{ select: [story: LauncherNewsStory]; settings: [] }>();
const filter = ref<"all" | LauncherNewsSource>("all");
const filters = [
  { id: "all", label: "All" },
  { id: "game", label: "Game" },
  { id: "event", label: "Events" },
  { id: "launcher", label: "GWonMac" },
] as const;
const visible = computed(() => filter.value === "all" ? props.news.stories : props.news.stories.filter((story) => story.source === filter.value));
const sourceLabel: Record<LauncherNewsSource, string> = { game: "Guild Wars", event: "Event", launcher: "GWonMac" };
function shortDate(value: string): string { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
</script>

<template>
  <div class="news-panel-head">
    <div><h2>Latest news</h2><span v-if="news.status === 'offline'" class="offline-note">Saved news · offline</span></div>
    <button class="customize" @click="emit('settings')"><SlidersHorizontal />Customize</button>
  </div>
  <div class="news-filters" role="group" aria-label="Filter news">
    <button v-for="item in filters" :key="item.id" :class="{ active: filter === item.id }" :aria-pressed="filter === item.id" @click="filter = item.id">{{ item.label }}</button>
  </div>
  <div v-if="news.status === 'loading' && news.stories.length === 0" class="news-status" role="status"><span class="news-spinner" />Checking for news…</div>
  <div v-else-if="visible.length === 0" class="news-status">No news matches this filter.</div>
  <div v-else class="news-feed-list">
    <button v-for="story in visible" :key="story.id" class="news-row" @click="emit('select', story)">
      <span class="story-source" :class="`source-${story.source}`">{{ sourceLabel[story.source] }}<small v-if="story.channel === 'beta'">Beta</small></span>
      <span class="story-copy"><strong>{{ story.title }}</strong><span>{{ story.summary }}</span></span>
      <time :datetime="story.publishedAt">{{ shortDate(story.publishedAt) }}</time>
      <ExternalLink v-if="story.action === 'external'" class="row-action" aria-hidden="true" />
      <span v-else class="row-action" aria-hidden="true">Read</span>
    </button>
  </div>
</template>

<style scoped>
.news-panel-head { position: sticky; top: -28px; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding-bottom: 14px; background: linear-gradient(#0c0c0a 82%, transparent); }
.news-panel-head h2 { margin: 0; font-size: 20px; }
.news-panel-head > div { display: flex; align-items: baseline; gap: 10px; }
.offline-note { color: var(--muted); font-size: 11px; }
.customize { display: flex; align-items: center; gap: 7px; padding: 8px; color: var(--muted); background: transparent; }
.customize svg { width: 15px; }
.news-filters { display: flex; gap: 5px; padding-bottom: 13px; border-bottom: 1px solid var(--line); }
.news-filters button { padding: 6px 10px; color: var(--muted); background: transparent; border: 1px solid transparent; font-size: 12px; }
.news-filters button.active { color: var(--text); background: var(--control); border-color: var(--line); }
.news-feed-list { display: grid; }
.news-row { position: relative; display: grid; grid-template-columns: 82px minmax(0, 1fr) auto; gap: 14px; width: 100%; padding: 18px 3px; color: inherit; text-align: left; background: transparent; border-bottom: 1px solid var(--line); }
.news-row:hover, .news-row:focus-visible { background: linear-gradient(90deg, rgba(230,177,84,.06), transparent); }
.story-source { align-self: start; color: var(--gold); font-size: 10px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
.story-source small { display: block; width: fit-content; margin-top: 5px; padding: 2px 5px; color: #171009; background: #df9d55; font-size: 9px; letter-spacing: .08em; }
.source-event { color: #b8c982; }
.story-copy { display: grid; gap: 5px; min-width: 0; }
.story-copy strong { color: var(--text); font-size: 15px; line-height: 1.25; }
.story-copy > span { display: -webkit-box; overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.news-row time { padding-right: 30px; color: var(--muted); font-size: 11px; white-space: nowrap; }
.row-action { position: absolute; right: 2px; top: 18px; width: 14px; color: #bd9b62; font-size: 10px; text-transform: uppercase; }
.news-status { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 180px; color: var(--muted); }
.news-spinner { width: 14px; height: 14px; border: 2px solid var(--line); border-top-color: var(--gold); border-radius: 50%; animation: news-spin .8s linear infinite; }
@keyframes news-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .news-spinner { animation: none; } }
@media (max-width: 720px) { .news-row { grid-template-columns: 72px minmax(0, 1fr); }.news-row time { display: none; } }
</style>
