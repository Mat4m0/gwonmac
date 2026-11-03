<script setup lang="ts">
/**
 * The launcher's player-facing home projection: timely news and the existing
 * daily activity surface. Network, trust, and persistence remain in main.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import {
  Castle, ChevronLeft, ChevronRight, Clock3, Crosshair, ExternalLink, MapPin,
  Newspaper, PackageOpen, Pause, Play, ScrollText, ShieldCheck, SlidersHorizontal, Swords,
} from "lucide-vue-next";
import type { LauncherNewsStory, LauncherPreferencesPatch, LauncherSnapshot } from "@shared/launcher-contracts";
import { dailyDaysFrom, type DailyCategory, type DailyDay } from "@shared/daily-activities";
import NewsArticle from "./NewsArticle.vue";
import NewsFeed from "./NewsFeed.vue";
import NewsSourceMark from "./NewsSourceMark.vue";

const props = defineProps<{ snapshot: LauncherSnapshot }>();
const emit = defineEmits<{
  settings: [];
  preferences: [content: NonNullable<LauncherPreferencesPatch["content"]>];
  news: [id: string];
}>();
const contentTab = ref<"news" | "dailies">(props.snapshot.preferences.content.first);
const weekExpanded = ref(false);
const featuredIndex = ref(0);
const selectedArticle = ref<LauncherNewsStory | null>(null);
const hovered = ref(false);
const focusWithin = ref(false);
const hidden = ref(false);
const reducedMotion = ref(false);
let rotationTimer: ReturnType<typeof setInterval> | undefined;
let motionQuery: MediaQueryList | undefined;

const featured = computed(() => {
  const candidates = props.snapshot.news.stories.filter((story) => story.featured);
  return candidates.length > 0 ? candidates : props.snapshot.news.stories;
});
const activeStory = computed(() => featured.value[featuredIndex.value % Math.max(featured.value.length, 1)] ?? null);
const rotationEnabled = computed(() => props.snapshot.preferences.content.autoRotateNews && !reducedMotion.value && !hovered.value && !focusWithin.value && !hidden.value && featured.value.length > 1);
const rotationPaused = computed(() => !props.snapshot.preferences.content.autoRotateNews || reducedMotion.value);
const rotationLabel = computed(() => reducedMotion.value ? "Automatic story rotation paused for Reduced Motion" : props.snapshot.preferences.content.autoRotateNews ? "Pause automatic story rotation" : "Resume automatic story rotation");

// Dailies are computed locally from the published rotations, so they work offline.
const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | undefined;
const dailyDays = computed(() => dailyDaysFrom(now.value, 7));
const today = computed(() => dailyDays.value[0]!);
const week = computed(() => dailyDays.value.slice(1));
const dailyIcons: Record<DailyCategory, Component> = {
  zaishenMission: ScrollText, zaishenBounty: Crosshair, zaishenCombat: Swords, zaishenVanquish: MapPin,
  shiningBlade: ShieldCheck, vanguardQuest: Castle, nicholasSandford: PackageOpen,
};
// The full week shows the three activities players plan around most.
const weekCategories = ["zaishenMission", "zaishenVanquish", "shiningBlade"] as const satisfies readonly DailyCategory[];
const weekColumns = computed(() => weekCategories.filter((category) => today.value.activities.some((activity) => activity.category === category)));
function weekEntry(day: DailyDay, category: DailyCategory): string { return day.activities.find((activity) => activity.category === category)?.title ?? "—"; }
function columnLabel(category: DailyCategory): string { return today.value.activities.find((activity) => activity.category === category)?.label ?? category; }
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const changesIn = computed(() => {
  const minutes = Math.max(0, Math.ceil((today.value.endsAt.getTime() - now.value.getTime()) / 60_000));
  return minutes >= 60 ? `Changes in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : `Changes in ${minutes}m`;
});

function restartRotation() {
  clearInterval(rotationTimer);
  rotationTimer = undefined;
  if (!rotationEnabled.value) return;
  rotationTimer = setInterval(() => { featuredIndex.value = (featuredIndex.value + 1) % featured.value.length; }, 12_000);
}
function motionChanged(event: MediaQueryListEvent | MediaQueryList) { reducedMotion.value = event.matches; restartRotation(); }
function visibilityChanged() { hidden.value = document.hidden; }
function leaveHeroFocus(event: FocusEvent) {
  const next = event.relatedTarget;
  focusWithin.value = next instanceof Node && (event.currentTarget as HTMLElement).contains(next);
}
onMounted(() => {
  clockTimer = setInterval(() => { now.value = new Date(); }, 30_000);
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionChanged(motionQuery);
  motionQuery.addEventListener("change", motionChanged);
  document.addEventListener("visibilitychange", visibilityChanged);
});
onBeforeUnmount(() => {
  clearInterval(rotationTimer);
  clearInterval(clockTimer);
  motionQuery?.removeEventListener("change", motionChanged);
  document.removeEventListener("visibilitychange", visibilityChanged);
});
watch(rotationEnabled, restartRotation);
watch(featured, () => { featuredIndex.value = 0; restartRotation(); });
watch(() => props.snapshot.preferences.content, (content) => {
  if (!content[contentTab.value]) contentTab.value = content.first;
});

function moveFeatured(direction: number) {
  if (!featured.value.length) return;
  featuredIndex.value = (featured.value.length + featuredIndex.value + direction) % featured.value.length;
  restartRotation();
}
function openStory(story: LauncherNewsStory) {
  if (story.action === "article") selectedArticle.value = story;
  else emit("news", story.id);
}
async function moveTab(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  contentTab.value = contentTab.value === "news" ? "dailies" : "news";
  await nextTick();
  document.querySelector<HTMLElement>(`#${contentTab.value}-tab`)?.focus();
}
function sourceLabel(story: LauncherNewsStory): string { return story.source === "game" ? "Guild Wars update" : story.source === "event" ? "Event" : story.channel === "beta" ? "GWonMac Beta" : "GWonMac release"; }
// An event shows when it runs; everything else shows when it was published.
function dateLabel(story: LauncherNewsStory): string {
  const format = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
  if (story.startsAt && story.endsAt) return format.formatRange(new Date(story.startsAt), new Date(story.endsAt));
  return format.format(new Date(story.publishedAt));
}
</script>

<template>
  <section class="hero-panel news-hero" @mouseenter="hovered = true" @mouseleave="hovered = false" @focusin="focusWithin = true" @focusout="leaveHeroFocus">
    <div v-if="contentTab === 'news' && snapshot.preferences.content.news && activeStory" class="hero-copy news-hero-copy">
      <Transition name="news-fade" mode="out-in"><div :key="activeStory.id"><h1>{{ activeStory.title }}</h1><div class="hero-source"><NewsSourceMark :source="activeStory.source" large /><span>{{ sourceLabel(activeStory) }}</span><span aria-hidden="true">·</span><time :datetime="activeStory.startsAt ?? activeStory.publishedAt">{{ dateLabel(activeStory) }}</time></div><p>{{ activeStory.summary }}</p><button class="text-link" @click="openStory(activeStory)">{{ activeStory.action === 'article' ? 'Read release notes' : 'Open on Guild Wars Wiki' }} <ExternalLink v-if="activeStory.action === 'external'" /></button></div></Transition>
      <div v-if="featured.length > 1" class="story-controls" aria-label="Featured news controls">
        <button aria-label="Previous story" @click="moveFeatured(-1)"><ChevronLeft /></button>
        <span>{{ featuredIndex + 1 }} / {{ featured.length }}</span>
        <button :aria-label="rotationLabel" :aria-pressed="rotationPaused" :disabled="reducedMotion" @click="emit('preferences', { autoRotateNews: !snapshot.preferences.content.autoRotateNews })"><Pause v-if="snapshot.preferences.content.autoRotateNews || reducedMotion" /><Play v-else /></button>
        <button aria-label="Next story" @click="moveFeatured(1)"><ChevronRight /></button>
        <small v-if="reducedMotion" class="motion-note">Reduced Motion</small>
      </div>
    </div>
    <div v-else-if="contentTab === 'news' && snapshot.preferences.content.news" class="hero-copy"><h1>News will appear here.</h1><p v-if="snapshot.news.status === 'loading'">Checking Guild Wars and GWonMac for updates…</p><p v-else>Connect to the internet to refresh your news.</p></div>
    <div v-else-if="snapshot.preferences.content.dailies" class="hero-copy"><h1>Plan today’s adventure.</h1><p>See daily activities now and the week ahead.</p></div>
    <div v-else class="hero-copy"><h1>Your accounts. One launcher.</h1><p>Choose an account below when you are ready to play.</p></div>
  </section>

  <section v-if="snapshot.preferences.content.news || snapshot.preferences.content.dailies" class="home-panel">
    <div v-if="snapshot.preferences.content.news && snapshot.preferences.content.dailies" class="segmented home-tabs" role="tablist" aria-label="Home content" @keydown="moveTab">
      <button id="news-tab" role="tab" :tabindex="contentTab === 'news' ? 0 : -1" :aria-selected="contentTab === 'news'" aria-controls="news-panel" @click="contentTab = 'news'"><Newspaper />News</button>
      <button id="dailies-tab" role="tab" :tabindex="contentTab === 'dailies' ? 0 : -1" :aria-selected="contentTab === 'dailies'" aria-controls="dailies-panel" @click="contentTab = 'dailies'"><Clock3 />Dailies</button>
    </div>
    <div v-if="contentTab === 'news'" id="news-panel" role="tabpanel" aria-labelledby="news-tab"><NewsFeed :news="snapshot.news" @select="openStory" @settings="emit('settings')" /></div>
    <div v-else id="dailies-panel" role="tabpanel" aria-labelledby="dailies-tab" class="daily-view">
      <div class="panel-head"><h2>Dailies</h2><button class="customize" @click="emit('settings')"><SlidersHorizontal />Customize</button></div>
      <div class="daily-date"><span>Today · {{ dayFormat.format(now) }}</span><strong>{{ changesIn }}</strong><small>{{ timeFormat.format(today.endsAt) }} local time</small></div>
      <ul class="daily-list"><li v-for="daily in today.activities" :key="daily.category" class="daily-item"><span class="daily-icon" aria-hidden="true"><component :is="dailyIcons[daily.category]" /></span><span class="daily-category">{{ daily.label }}</span><strong>{{ daily.title }}</strong></li></ul>
      <table v-if="weekExpanded" class="daily-week">
        <thead><tr><th scope="col">Starts</th><th v-for="category in weekColumns" :key="category" scope="col">{{ columnLabel(category) }}</th></tr></thead>
        <tbody><tr v-for="(day, index) in week" :key="day.startsAt.toISOString()"><th scope="row">{{ index === 0 ? `Next · ${timeFormat.format(day.startsAt)}` : dayFormat.format(day.startsAt) }}</th><td v-for="category in weekColumns" :key="category">{{ weekEntry(day, category) }}</td></tr></tbody>
      </table>
      <button class="secondary load-more" :aria-expanded="weekExpanded" @click="weekExpanded = !weekExpanded">{{ weekExpanded ? 'Show today only' : 'Show full week' }}</button>
    </div>
  </section>
  <NewsArticle v-if="selectedArticle" :story="selectedArticle" @close="selectedArticle = null" @external="emit('news', $event)" />
</template>

<style scoped>
.home-tabs { position: sticky; top: -28px; z-index: 3; width: fit-content; margin: 0 0 18px; background: var(--sunken); }
.news-hero { overflow: hidden; }
.news-hero::after { position: absolute; inset: 0; content: ""; pointer-events: none; background: linear-gradient(90deg, var(--art-shade), transparent); }
.news-hero-copy { z-index: 1; max-width: 570px; }
.hero-source { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; color: var(--text-soft); font-size: var(--fs-md); font-weight: 500; }
.story-controls { display: flex; align-items: center; gap: 5px; width: fit-content; margin-top: 22px; padding: 4px; border: 1px solid var(--gold-line); border-radius: var(--radius-md); background: var(--chrome); backdrop-filter: blur(8px); }
.story-controls button { display: grid; place-items: center; width: 30px; height: 28px; padding: 0; border-radius: 6px; color: var(--text-soft); background: transparent; }
.story-controls button:hover, .story-controls button:focus-visible { color: var(--text); background: var(--surface-hover); }
.story-controls button:disabled { cursor: default; opacity: .55; }
.story-controls svg { width: 15px; }
.story-controls span { min-width: 40px; color: var(--muted); font-size: var(--fs-2xs); text-align: center; }
.story-controls .motion-note { margin: 0 7px 0 3px; color: var(--muted); font-size: 10px; }
.news-fade-enter-active, .news-fade-leave-active { transition: opacity 160ms ease; }
.news-fade-enter-from, .news-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .news-fade-enter-active, .news-fade-leave-active { transition: none; } }
</style>
