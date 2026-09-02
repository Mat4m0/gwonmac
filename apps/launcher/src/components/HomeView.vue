<script setup lang="ts">
/**
 * The launcher's player-facing home projection: timely news and the existing
 * daily activity surface. Network, trust, and persistence remain in main.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Castle, ChevronLeft, ChevronRight, Clock3, Crosshair, ExternalLink, MapPin,
  Newspaper, PackageOpen, Pause, Play, ScrollText, ShieldCheck, SlidersHorizontal, Swords,
} from "lucide-vue-next";
import type { LauncherNewsStory, LauncherPreferencesPatch, LauncherSnapshot } from "@shared/launcher-contracts";
import NewsArticle from "./NewsArticle.vue";
import NewsFeed from "./NewsFeed.vue";

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

const today = [
  { category: "Zaishen Mission", title: "Gate of Pain", icon: ScrollText },
  { category: "Zaishen Bounty", title: "Zoldark the Unholy", icon: Crosshair },
  { category: "Zaishen Combat", title: "Random Arena", icon: Swords },
  { category: "Zaishen Vanquish", title: "Skyward Reach", icon: MapPin },
  { category: "Shining Blade", title: "Justiciar Marron", icon: ShieldCheck },
  { category: "Vanguard Quest", title: "Footman Tate", icon: Castle },
  { category: "Nicholas Sandford", title: "Baked Husks", icon: PackageOpen },
] as const;
const week = [
  { date: "Tomorrow · Aug 30", activities: ["Ruins of Morah", "Justiciar Kimii", "Dragon's Gullet"] },
  { date: "Monday · Aug 31", activities: ["A Time for Heroes", "Royen Beastkeeper", "The Falls"] },
  { date: "Tuesday · Sep 1", activities: ["Dunes of Despair", "Mohby Windbeak", "Sacnoth Valley"] },
  { date: "Wednesday · Sep 2", activities: ["Tahnnakai Temple", "Joh the Hostile", "Mount Qinkai"] },
  { date: "Thursday · Sep 3", activities: ["Blood Washes Blood", "Baubao Wavewrath", "Grothmar Wardowns"] },
  { date: "Friday · Sep 4", activities: ["The Eternal Grove", "Jarimiya the Unmerciful", "Jaga Moraine"] },
] as const;

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
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionChanged(motionQuery);
  motionQuery.addEventListener("change", motionChanged);
  document.addEventListener("visibilitychange", visibilityChanged);
});
onBeforeUnmount(() => {
  clearInterval(rotationTimer);
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
function sourceLabel(story: LauncherNewsStory): string { return story.source === "game" ? "Guild Wars update" : story.source === "event" ? "Upcoming event" : story.channel === "beta" ? "GWonMac Beta" : "GWonMac release"; }
function dateLabel(story: LauncherNewsStory): string { return new Date(story.publishedAt).toLocaleDateString(undefined, { month: "long", day: "numeric" }); }
</script>

<template>
  <section class="hero-panel news-hero" @mouseenter="hovered = true" @mouseleave="hovered = false" @focusin="focusWithin = true" @focusout="leaveHeroFocus">
    <div v-if="contentTab === 'news' && snapshot.preferences.content.news && activeStory" class="hero-copy news-hero-copy">
      <span class="hero-kicker">{{ sourceLabel(activeStory) }}<small v-if="activeStory.channel === 'beta'">Beta</small></span>
      <Transition name="news-fade" mode="out-in"><div :key="activeStory.id"><h1>{{ activeStory.title }}</h1><time class="hero-meta" :datetime="activeStory.publishedAt">{{ dateLabel(activeStory) }}</time><p>{{ activeStory.summary }}</p><button class="text-link" @click="openStory(activeStory)">{{ activeStory.action === 'article' ? 'Read release notes' : 'Open on Guild Wars Wiki' }} <ExternalLink v-if="activeStory.action === 'external'" /></button></div></Transition>
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
    <div v-else-if="snapshot.contentAvailability.dailies === 'placeholder'" id="dailies-panel" role="tabpanel" aria-labelledby="dailies-tab" class="empty-state"><Clock3 /><h3>Daily activities are not connected yet.</h3><p>Use the Guild Wars Wiki for the current schedule.</p></div>
    <div v-else id="dailies-panel" role="tabpanel" aria-labelledby="dailies-tab" class="daily-view">
      <div class="panel-head"><h2>Dailies</h2><button class="customize" @click="emit('settings')"><SlidersHorizontal />Customize</button></div>
      <div class="daily-date"><span>Today · Aug 29</span><strong>Changes in 5h 18m</strong><small>18:00 local time</small></div>
      <div class="daily-list"><div v-for="daily in today" :key="daily.category" class="daily-item"><span class="daily-icon" aria-hidden="true"><component :is="daily.icon" /></span><span class="daily-category">{{ daily.category }}</span><strong>{{ daily.title }}</strong></div></div>
      <div v-if="weekExpanded" class="daily-week"><div v-for="day in week" :key="day.date" class="daily-week-row"><strong>{{ day.date }}</strong><span class="week-activities"><span v-for="activity in day.activities" :key="activity">{{ activity }}</span></span></div></div>
      <button class="load-more" :aria-expanded="weekExpanded" @click="weekExpanded = !weekExpanded">{{ weekExpanded ? 'Show today only' : 'Show full week' }}</button>
    </div>
  </section>
  <NewsArticle v-if="selectedArticle" :story="selectedArticle" @close="selectedArticle = null" @external="emit('news', $event)" />
</template>

<style scoped>
.home-tabs { position: sticky; top: -28px; z-index: 3; width: fit-content; margin: 0 0 18px; background: #11110e; }
.news-hero { overflow: hidden; }
.news-hero::after { position: absolute; inset: 0; content: ""; pointer-events: none; background: linear-gradient(90deg, rgba(5,5,4,.16), rgba(5,5,4,.02)); }
.news-hero-copy { z-index: 1; max-width: 570px; }
.hero-kicker { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 10px; color: #efc273; font-size: 11px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
.hero-kicker small { padding: 3px 6px; color: #180f07; background: #df9d55; font-size: 9px; }
.story-controls { display: flex; align-items: center; gap: 5px; width: fit-content; margin-top: 22px; padding: 4px; background: rgba(7,7,5,.62); border: 1px solid rgba(240,197,111,.18); backdrop-filter: blur(8px); }
.story-controls button { display: grid; place-items: center; width: 30px; height: 28px; padding: 0; color: #d2c6b0; background: transparent; }
.story-controls button:hover, .story-controls button:focus-visible { color: #fff1d5; background: rgba(255,255,255,.08); }
.story-controls button:disabled { cursor: default; opacity: .55; }
.story-controls svg { width: 15px; }
.story-controls span { min-width: 40px; color: var(--muted); font-size: 11px; text-align: center; }
.story-controls .motion-note { margin: 0 7px 0 3px; color: var(--muted); font-size: 10px; }
.news-fade-enter-active, .news-fade-leave-active { transition: opacity 160ms ease; }
.news-fade-enter-from, .news-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .news-fade-enter-active, .news-fade-leave-active { transition: none; } }
</style>
