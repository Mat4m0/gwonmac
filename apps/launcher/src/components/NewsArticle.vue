<script setup lang="ts">
import { ExternalLink, X } from "lucide-vue-next";
import type { LauncherNewsInline, LauncherNewsStory } from "@shared/launcher-contracts";
import BaseModal from "./BaseModal.vue";

defineProps<{ story: LauncherNewsStory }>();
const emit = defineEmits<{ close: []; external: [id: string] }>();

function label(part: LauncherNewsInline): string {
  return part.text;
}
</script>

<template>
  <BaseModal labelledby="news-article-title" wide @close="emit('close')">
    <article class="news-article">
      <header>
        <div><span class="news-kicker">GWonMac · {{ story.channel === 'beta' ? 'Beta' : 'Release' }}</span><h1 id="news-article-title">{{ story.title }}</h1><time :datetime="story.publishedAt">{{ new Date(story.publishedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) }}</time></div>
        <button class="icon-button" aria-label="Close release notes" autofocus @click="emit('close')"><X /></button>
      </header>
      <div class="article-body">
        <template v-for="(block, index) in story.body" :key="index">
          <h2 v-if="block.type === 'heading'">{{ block.text }}</h2>
          <figure v-else-if="block.type === 'image'"><img :src="block.src" :alt="block.alt" /><figcaption v-if="block.alt">{{ block.alt }}</figcaption></figure>
          <ul v-else-if="block.type === 'list'"><li v-for="(item, itemIndex) in block.items" :key="itemIndex"><template v-for="(part, partIndex) in item" :key="partIndex"><strong v-if="part.emphasis === 'strong'">{{ label(part) }}</strong><code v-else-if="part.emphasis === 'code'">{{ label(part) }}</code><button v-else-if="part.actionId" class="article-link" @click="emit('external', part.actionId)">{{ label(part) }}</button><span v-else>{{ label(part) }}</span></template></li></ul>
          <p v-else><template v-for="(part, partIndex) in block.content" :key="partIndex"><strong v-if="part.emphasis === 'strong'">{{ label(part) }}</strong><code v-else-if="part.emphasis === 'code'">{{ label(part) }}</code><button v-else-if="part.actionId" class="article-link" @click="emit('external', part.actionId)">{{ label(part) }}</button><span v-else>{{ label(part) }}</span></template></p>
        </template>
      </div>
      <footer><button class="secondary" @click="emit('external', story.id)">Read on the website <ExternalLink /></button><button class="primary" @click="emit('close')">Done</button></footer>
    </article>
  </BaseModal>
</template>

<style scoped>
.news-article { max-height: min(78vh, 760px); display: flex; flex-direction: column; }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; padding: 26px 30px 20px; border-bottom: 1px solid var(--line); }
header h1 { max-width: 720px; margin: 6px 0 5px; font-size: clamp(25px, 3vw, 34px); line-height: 1.08; }
header time, figcaption { color: var(--muted); font-size: 12px; }
.news-kicker { color: var(--gold); font-size: 11px; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; }
.icon-button { flex: 0 0 auto; padding: 8px; color: var(--muted); background: transparent; }
.icon-button svg { width: 18px; }
.article-body { overflow: auto; padding: 20px 30px 30px; color: #d6d0c4; font-size: 15px; line-height: 1.65; }
.article-body h2 { margin: 28px 0 8px; color: var(--text); font-size: 20px; }
.article-body p { max-width: 72ch; margin: 0 0 16px; }
.article-body ul { max-width: 70ch; margin: 8px 0 20px; padding-left: 22px; }
.article-body li { margin: 6px 0; }
.article-body code { padding: 2px 5px; border: 1px solid var(--line); background: #14130f; color: #f1d6a3; }
.article-link { display: inline; padding: 0; border: 0; color: var(--gold); background: transparent; font: inherit; text-decoration: underline; text-underline-offset: 3px; }
.article-link:hover, .article-link:focus-visible { color: #f6d99f; }
figure { margin: 22px 0; }
figure img { display: block; width: 100%; max-height: 460px; object-fit: cover; border: 1px solid var(--line); }
figcaption { margin-top: 7px; }
footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 30px 24px; border-top: 1px solid var(--line); }
footer button { display: inline-flex; align-items: center; gap: 8px; }
footer svg { width: 15px; }
</style>
