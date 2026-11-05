<script setup lang="ts">
/**
 * The News tab: every story in one list, and each article as a full page.
 * Feed stories link through main's opaque IDs; the bundled release notes of
 * this version link like the Guide (guide:, settings:, url:).
 */
import { computed, nextTick, ref, watch } from "vue";
import { ChevronLeft, ExternalLink, SlidersHorizontal } from "lucide-vue-next";
import type { LauncherNewsState, LauncherNewsStory } from "@shared/launcher-contracts";
import MarkdownBody from "./MarkdownBody.vue";
import NewsFeed from "./NewsFeed.vue";
import NewsSourceMark from "./NewsSourceMark.vue";

const props = defineProps<{ news: LauncherNewsState; releaseNotes?: LauncherNewsStory | null; article?: string | null }>();
const emit = defineEmits<{ "update:article": [id: string | null]; open: [id: string]; link: [actionId: string]; settings: [] }>();

const root = ref<HTMLElement | null>(null);
// The installed version's notes join the list while the feed does not carry them yet (drafts, offline).
const stories = computed(() => {
  const notes = props.releaseNotes;
  if (!notes || props.news.stories.some((story) => story.id === notes.id)) return props.news.stories;
  return [notes, ...props.news.stories].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
});
const state = computed<LauncherNewsState>(() => ({ ...props.news, stories: stories.value }));
const story = computed(() => props.article ? stories.value.find((candidate) => candidate.id === props.article) ?? null : null);
const inFeed = computed(() => !!story.value && props.news.stories.some((candidate) => candidate.id === story.value!.id));
// Only the bundled copy links like the Guide; once the feed carries these notes, it shows its own copy.
const bundled = computed(() => !!story.value && !inFeed.value);

watch(() => props.article, async () => {
  await nextTick();
  root.value?.scrollTo({ top: 0 });
});

function select(next: LauncherNewsStory) {
  if (next.action === "article") emit("update:article", next.id);
  else emit("open", next.id);
}
function follow(actionId: string) {
  if (bundled.value) emit("link", actionId);
  else emit("open", actionId);
}
function sourceLabel(item: LauncherNewsStory): string {
  return item.source === "game" ? "Guild Wars update" : item.source === "event" ? "Event" : item.channel === "beta" ? "GWonMac Beta" : "GWonMac release";
}
function dateLabel(item: LauncherNewsStory): string {
  const format = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
  if (item.startsAt && item.endsAt) return format.formatRange(new Date(item.startsAt), new Date(item.endsAt));
  return format.format(new Date(item.publishedAt));
}
</script>

<template>
  <section ref="root" class="page news-page">
    <article v-if="story" class="news-reader">
      <button class="quiet small news-back" @click="emit('update:article', null)"><ChevronLeft />All news</button>
      <header>
        <h1>{{ story.title }}</h1>
        <p class="article-meta"><NewsSourceMark :source="story.source" /><span>{{ sourceLabel(story) }}</span><span aria-hidden="true">·</span><time :datetime="story.startsAt ?? story.publishedAt">{{ dateLabel(story) }}</time></p>
      </header>
      <MarkdownBody :blocks="story.body" @link="follow" />
      <footer v-if="inFeed">
        <button class="secondary" @click="emit('open', story.id)">{{ story.source === 'launcher' ? 'Open on the website' : 'Open on Guild Wars Wiki' }} <ExternalLink /></button>
      </footer>
    </article>
    <template v-else>
      <div class="page-head">
        <div><h1>News</h1><p>Guild Wars updates from the wiki, events, and GWonMac releases.</p></div>
        <button class="quiet" @click="emit('settings')"><SlidersHorizontal />Customize</button>
      </div>
      <NewsFeed :news="state" :heading="false" @select="select" @settings="emit('settings')" />
    </template>
  </section>
</template>

<style scoped>
.news-page > * { max-width: 920px; }
.news-reader { max-width: 760px; }
.news-back { margin: 0 0 20px -10px; }
.news-back svg { width: 16px; height: 16px; }
.news-reader header { margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
.news-reader h1 { margin: 0 0 12px; font-size: clamp(28px, 3.4vw, var(--fs-page)); line-height: 1.1; text-wrap: balance; }
.article-meta { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--muted); font-size: var(--fs-sm); }
.news-reader footer { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--line); }
.news-reader footer svg { width: 15px; height: 15px; }
</style>
