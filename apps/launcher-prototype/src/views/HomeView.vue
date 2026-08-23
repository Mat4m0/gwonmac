<script setup lang="ts">
import { ArrowRight } from "@lucide/vue";
import { computed } from "vue";
import { newsArticles } from "../data/news";
import type { FundingPlacement, LauncherSettings, RouteName, Scenario } from "../model";
import FundingProgress from "../components/FundingProgress.vue";

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
  openNewsSettings: [];
  support: [];
}>();

const feature = computed(() =>
  newsArticles.find((article) =>
    article.sourceKey === "guild-wars" ? props.settings.showGuildWarsNews : props.settings.showMacNews,
  ),
);
</script>

<template>
  <div class="home-layout">
    <section class="feature-story" :style="{ backgroundImage: `url(${feature?.image ?? '/images/bg-reforged.jpg'})` }">
      <div class="feature-overlay"></div>
      <div class="feature-copy">
        <span class="eyebrow">{{ feature ? `${feature.source} · ${feature.date}` : "Launcher status" }}</span>
        <h1>{{ feature ? `${feature.title}.` : "Ready when you are." }}</h1>
        <p>{{ feature ? feature.summary : "News is hidden. Guild Wars and your launcher settings still work normally." }}</p>
        <button class="text-button" type="button" @click="feature ? emit('openArticle', feature.id) : emit('openNewsSettings')">
          {{ feature ? "Read update" : "Choose news" }}
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </section>

    <aside class="home-summary">
      <div class="section-heading">
        <h1>News and status</h1>
        <span>Updated 10:52</span>
      </div>

      <section class="readiness-card" :class="scenario">
        <span class="status-dot" :class="scenario"></span>
        <div>
          <strong>
            {{ scenario === "updating" ? "Updating Guild Wars" : scenario === "degraded" ? "Guild Wars is ready" : scenario === "offline" ? "Offline" : "Ready to play" }}
          </strong>
          <p>
            {{ scenario === "updating" ? "Downloading the latest game files" : scenario === "degraded" ? "Two optional Tools are being checked" : scenario === "offline" ? "Using the files already on this Mac" : "Guild Wars and your enabled Tools are available" }}
          </p>
        </div>
      </section>

      <div class="summary-list">
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
