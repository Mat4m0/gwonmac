<script setup lang="ts">
import { ArrowRight } from "@lucide/vue";
import { newsArticles } from "../data/news";
import type { FundingPlacement, RouteName, Scenario } from "../model";
import FundingProgress from "../components/FundingProgress.vue";

defineProps<{
  scenario: Scenario;
  fundingPlacement: FundingPlacement;
  fundingRaised: number;
  fundingGoal: number;
}>();

const emit = defineEmits<{
  navigate: [route: RouteName];
  openArticle: [articleId: string];
  support: [];
}>();

const feature = newsArticles[0]!;
</script>

<template>
  <div class="home-layout">
    <section class="feature-story" :style="{ backgroundImage: `url(${feature.image})` }">
      <div class="feature-overlay"></div>
      <div class="feature-copy">
        <span class="eyebrow">Guild Wars news · Aug 23</span>
        <h1>{{ feature.title }}.</h1>
        <p>{{ feature.summary }} All weekly bonuses will be active.</p>
        <button class="text-button" type="button" @click="emit('openArticle', feature.id)">
          Read update
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
        <button type="button" @click="emit('openArticle', 'client-update')">
          <span class="eyebrow">Guild Wars</span>
          <span><strong>Client stability update</strong><small>Fixed a cinematic crash and map reveal problems.</small></span>
          <span class="pill">Aug 19</span>
        </button>
        <button type="button" @click="emit('openArticle', 'multiple-accounts')">
          <span class="eyebrow">macOS</span>
          <span><strong>Version 2026.8.9 installed</strong><small>You have the latest Stable version.</small></span>
          <span class="pill good">Current</span>
        </button>
        <button type="button" @click="emit('navigate', 'issues')">
          <span class="eyebrow">Issues</span>
          <span><strong>{{ scenario === "degraded" ? "Two Tools are unavailable" : "No known issues" }}</strong><small>{{ scenario === "degraded" ? "Your saved data is safe." : "Everything you enabled is available." }}</small></span>
          <span class="pill" :class="scenario === 'degraded' ? 'warning' : 'good'">{{ scenario === "degraded" ? "Checking" : "All clear" }}</span>
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
