<script setup lang="ts">
import { computed, ref } from "vue";
import { RefreshCw } from "@lucide/vue";
import { newsArticles } from "../data/news";

const props = defineProps<{ initialArticleId?: string }>();
const activeId = ref(props.initialArticleId ?? newsArticles[0]!.id);
const filter = ref<"all" | "guild-wars" | "macos">("all");

const visibleArticles = computed(() => {
  if (filter.value === "all") return newsArticles;
  if (filter.value === "macos") return newsArticles.filter((article) => article.source.includes("macOS"));
  return newsArticles.filter((article) => !article.source.includes("macOS"));
});

const activeArticle = computed(
  () => newsArticles.find((article) => article.id === activeId.value) ?? newsArticles[0]!,
);
</script>

<template>
  <div class="section-layout">
    <aside class="section-sidebar">
      <span class="eyebrow">Updates</span>
      <h1>News</h1>
      <nav aria-label="News filters">
        <button type="button" :class="{ active: filter === 'all' }" @click="filter = 'all'">All news</button>
        <button type="button" :class="{ active: filter === 'guild-wars' }" @click="filter = 'guild-wars'">Guild Wars</button>
        <button type="button" :class="{ active: filter === 'macos' }" @click="filter = 'macos'">Reforged for macOS</button>
      </nav>
    </aside>
    <section class="section-content news-screen">
      <div class="content-heading">
        <div>
          <span class="eyebrow">Latest</span>
          <h1>News</h1>
        </div>
        <button class="icon-button" type="button" aria-label="Refresh news">
          <RefreshCw aria-hidden="true" />
        </button>
      </div>
      <div class="news-layout">
        <div class="news-list">
          <button
            v-for="article in visibleArticles"
            :key="article.id"
            type="button"
            :class="{ active: activeId === article.id }"
            :style="{ backgroundImage: `linear-gradient(90deg, rgba(11, 10, 9, .96), rgba(11, 10, 9, .48)), url(${article.image})` }"
            @click="activeId = article.id"
          >
            <span class="eyebrow">{{ article.source }}</span>
            <strong>{{ article.title }}</strong>
            <small>{{ article.date }}</small>
          </button>
        </div>
        <article class="article-card">
          <div class="article-image" :style="{ backgroundImage: `linear-gradient(180deg, transparent, rgba(14, 12, 10, .94)), url(${activeArticle.image})` }"></div>
          <span class="eyebrow">{{ activeArticle.source }} · {{ activeArticle.date }}</span>
          <h2>{{ activeArticle.title }}</h2>
          <p>{{ activeArticle.summary }}</p>
          <p v-for="paragraph in activeArticle.paragraphs" :key="paragraph">{{ paragraph }}</p>
          <ul>
            <li v-for="bullet in activeArticle.bullets" :key="bullet">{{ bullet }}</li>
          </ul>
          <footer>Example content for this prototype. Official game news would link to its source.</footer>
        </article>
      </div>
    </section>
  </div>
</template>
