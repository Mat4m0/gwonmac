<script setup lang="ts">
import type { Component } from "vue";
import { computed, ref, watch } from "vue";
import {
  ArrowRight,
  CalendarDays,
  Castle,
  ChevronDown,
  Clock3,
  Crosshair,
  ExternalLink,
  MapPinned,
  Newspaper,
  PackageOpen,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
} from "@lucide/vue";
import FundingProgress from "../components/FundingProgress.vue";
import { dailySchedule } from "../data/dailies";
import { newsArticles } from "../data/news";
import type {
  DailyActivityKind,
  FundingPlacement,
  HomePanel,
  LauncherSettings,
  RouteName,
  Scenario,
} from "../model";

const props = defineProps<{
  scenario: Scenario;
  fundingPlacement: FundingPlacement;
  fundingRaised: number;
  fundingGoal: number;
  settings: LauncherSettings;
}>();

const emit = defineEmits<{
  navigate: [route: RouteName];
  openArticle: [articleId: string];
  openHomeSettings: [];
  support: [];
}>();

const dailyIcons: Record<DailyActivityKind, Component> = {
  mission: ScrollText,
  bounty: Crosshair,
  combat: Swords,
  vanquish: MapPinned,
  "shining-blade": ShieldCheck,
  vanguard: Castle,
  sandford: PackageOpen,
};

const activePanel = ref<HomePanel>(
  props.settings.showDailies ? props.settings.defaultHomePanel : "news",
);
const showFullWeek = ref(false);

const homeTabs = computed<HomePanel[]>(() => {
  if (!props.settings.showDailies) return ["news"];
  return props.settings.defaultHomePanel === "dailies"
    ? ["dailies", "news"]
    : ["news", "dailies"];
});

const visibleSchedule = computed(() =>
  dailySchedule.slice(0, showFullWeek.value ? 7 : 2).map((day) => ({
    ...day,
    activities: day.activities.filter(
      (activity) => props.settings.dailyActivityVisibility[activity.kind],
    ),
  })),
);

const hasVisibleDailies = computed(() =>
  Object.values(props.settings.dailyActivityVisibility).some(Boolean),
);

const dayDetails = (dayOffset: number) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);

  const iso = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  return {
    label:
      dayOffset === 0
        ? "Today"
        : dayOffset === 1
          ? "Tomorrow"
          : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date),
    date: new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date),
    iso,
  };
};

const dailyReset = computed(() => {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setUTCHours(16, 0, 0, 0);
  if (nextReset <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);

  const minutesRemaining = Math.ceil((nextReset.getTime() - now.getTime()) / 60_000);
  const hours = Math.floor(minutesRemaining / 60);
  const minutes = minutesRemaining % 60;
  const remaining = [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""]
    .filter(Boolean)
    .join(" ");

  return {
    remaining,
    localTime: new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(nextReset),
  };
});

const feature = computed(() =>
  newsArticles.find((article) =>
    article.sourceKey === "guild-wars"
      ? props.settings.showGuildWarsNews
      : props.settings.showMacNews,
  ),
);

watch(
  () => [props.settings.showDailies, props.settings.defaultHomePanel] as const,
  ([showDailies, defaultPanel]) => {
    activePanel.value = showDailies ? defaultPanel : "news";
  },
);
</script>

<template>
  <div class="home-layout">
    <section
      class="feature-story"
      :style="{ backgroundImage: `url(${feature?.image ?? '/images/bg-reforged.jpg'})` }"
    >
      <div class="feature-overlay"></div>
      <div class="feature-copy">
        <span class="eyebrow">{{ feature ? `${feature.source} · ${feature.date}` : "Launcher status" }}</span>
        <h1>{{ feature ? `${feature.title}.` : "Ready when you are." }}</h1>
        <p>{{ feature ? feature.summary : "News is hidden. Guild Wars and your launcher settings still work normally." }}</p>
        <button
          class="text-button"
          type="button"
          @click="feature ? emit('openArticle', feature.id) : emit('openHomeSettings')"
        >
          {{ feature ? "Read update" : "Choose Home content" }}
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </section>

    <aside class="home-summary">
      <div class="home-tabs-heading">
        <div class="home-tab-control" role="group" aria-label="Home content">
          <button
            v-for="tab in homeTabs"
            :key="tab"
            type="button"
            :aria-pressed="activePanel === tab"
            :class="{ active: activePanel === tab }"
            @click="activePanel = tab"
          >
            <Newspaper v-if="tab === 'news'" aria-hidden="true" />
            <Clock3 v-else aria-hidden="true" />
            {{ tab === "news" ? "News" : "Dailies" }}
          </button>
        </div>
        <button class="home-content-settings" type="button" @click="emit('openHomeSettings')">
          <SlidersHorizontal aria-hidden="true" />
          Customize
        </button>
      </div>

      <div
        v-if="activePanel === 'news'"
        id="home-panel-news"
        class="home-panel"
        role="region"
        aria-label="News"
      >
        <div v-if="settings.showGuildWarsNews || settings.showMacNews" class="summary-list">
          <button v-if="settings.showGuildWarsNews" type="button" @click="emit('openArticle', 'client-update')">
            <span class="eyebrow">Guild Wars</span>
            <span><strong>Client stability update</strong><small>Fixed a cinematic crash and map reveal problems.</small></span>
            <span class="pill">Aug 19</span>
          </button>
          <button v-if="settings.showMacNews" type="button" @click="emit('openArticle', 'multiple-accounts')">
            <span class="eyebrow">macOS</span>
            <span><strong>Quick start added to the launcher</strong><small>Choose accounts and open them together.</small></span>
            <span class="pill">New</span>
          </button>
          <button type="button" @click="emit('navigate', 'issues')">
            <span class="eyebrow">Issues</span>
            <span><strong>{{ scenario === "degraded" ? "Some Tools are unavailable" : "Two known game issues" }}</strong><small>{{ scenario === "degraded" ? "Guild Wars still works." : "Workarounds are available." }}</small></span>
            <span class="pill" :class="scenario === 'degraded' ? 'warning' : ''">{{ scenario === "degraded" ? "Checking" : "View" }}</span>
          </button>
        </div>
        <div v-else class="home-panel-empty">
          <Newspaper aria-hidden="true" />
          <strong>News is hidden</strong>
          <button type="button" @click="emit('openHomeSettings')">Choose news sources</button>
        </div>
      </div>

      <div
        v-else
        id="home-panel-dailies"
        class="home-panel dailies-panel"
        role="region"
        aria-label="Dailies"
      >
        <div class="daily-reset">
          <div><span class="eyebrow">Next reset</span><strong>In {{ dailyReset.remaining }}</strong></div>
          <span>{{ dailyReset.localTime }} local time</span>
        </div>
        <div v-if="hasVisibleDailies" class="daily-scroll">
          <section
            v-for="day in visibleSchedule"
            :key="day.dayOffset"
            class="daily-day"
            :aria-labelledby="`daily-date-${day.dayOffset}`"
          >
            <header class="daily-date-heading">
              <div>
                <h2 :id="`daily-date-${day.dayOffset}`">{{ dayDetails(day.dayOffset).label }}</h2>
                <time :datetime="dayDetails(day.dayOffset).iso">{{ dayDetails(day.dayOffset).date }}</time>
              </div>
              <span>{{ day.activities.length }} {{ day.activities.length === 1 ? "activity" : "activities" }}</span>
            </header>
            <div class="daily-grid">
              <a
                v-for="activity in day.activities"
                :key="activity.kind"
                :href="`https://wiki.guildwars.com/wiki/${activity.wikiPath}`"
                target="_blank"
                rel="noreferrer"
              >
                <span class="daily-icon"><component :is="dailyIcons[activity.kind]" aria-hidden="true" /></span>
                <span><small>{{ activity.label }}</small><strong>{{ activity.name }}</strong></span>
                <ExternalLink aria-hidden="true" />
              </a>
            </div>
          </section>
          <button v-if="!showFullWeek" class="show-week-button" type="button" @click="showFullWeek = true">
            <CalendarDays aria-hidden="true" />
            Show full week
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
        <div v-else class="home-panel-empty">
          <Clock3 aria-hidden="true" />
          <strong>No dailies selected</strong>
          <button type="button" @click="emit('openHomeSettings')">Choose activities</button>
        </div>
        <a v-if="hasVisibleDailies" class="daily-schedule-link" href="https://wiki.guildwars.com/wiki/Daily_activities" target="_blank" rel="noreferrer">
          View the full schedule
          <ExternalLink aria-hidden="true" />
        </a>
      </div>

      <FundingProgress
        v-if="fundingPlacement === 'home'"
        compact
        :raised="fundingRaised"
        :goal="fundingGoal"
        @support="emit('support')"
      />
    </aside>
  </div>
</template>
