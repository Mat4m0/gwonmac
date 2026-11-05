<script setup lang="ts">
/** Draws parsed Markdown blocks. Links only emit their action ID; the parent decides what it opens. */
import { Clapperboard, ImageIcon, Info } from "lucide-vue-next";
import type { MarkdownBlock } from "@shared/launcher-markdown";
import MarkdownInline from "./MarkdownInline.vue";

defineProps<{ blocks: readonly MarkdownBlock[] }>();
const emit = defineEmits<{ link: [actionId: string] }>();
</script>

<template>
  <div class="markdown-body">
    <template v-for="(block, index) in blocks" :key="index">
      <h3 v-if="block.type === 'heading' && block.level === 3" :id="block.anchor">{{ block.text }}</h3>
      <h2 v-else-if="block.type === 'heading'" :id="block.anchor">{{ block.text }}</h2>
      <figure v-else-if="block.type === 'image'"><img :src="block.src" :alt="block.alt" loading="lazy" /><figcaption v-if="block.alt">{{ block.alt }}</figcaption></figure>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'"><li v-for="(item, itemIndex) in block.items" :key="itemIndex"><MarkdownInline :parts="item" @link="emit('link', $event)" /></li></component>
      <div v-else-if="block.type === 'table'" class="markdown-table"><table>
        <thead><tr><th v-for="(cell, cellIndex) in block.head" :key="cellIndex" scope="col"><MarkdownInline :parts="cell" @link="emit('link', $event)" /></th></tr></thead>
        <tbody><tr v-for="(row, rowIndex) in block.rows" :key="rowIndex"><td v-for="(cell, cellIndex) in row" :key="cellIndex"><MarkdownInline :parts="cell" @link="emit('link', $event)" /></td></tr></tbody>
      </table></div>
      <aside v-else-if="block.type === 'note'" class="markdown-note"><Info /><p><MarkdownInline :parts="block.content" @link="emit('link', $event)" /></p></aside>
      <figure v-else-if="block.type === 'placeholder'" class="media-placeholder"><component :is="block.media === 'video' ? Clapperboard : ImageIcon" aria-hidden="true" /><figcaption><strong>{{ block.media === 'video' ? 'Video to come' : 'Screenshot to come' }}</strong><span><MarkdownInline :parts="block.content" @link="emit('link', $event)" /></span></figcaption></figure>
      <p v-else><MarkdownInline :parts="block.content" @link="emit('link', $event)" /></p>
    </template>
  </div>
</template>

<style scoped>
.markdown-body { color: var(--text-soft); font-size: var(--fs-body); line-height: 1.65; }
.markdown-body > :first-child { margin-top: 0; }
/* `ch` is the width of a zero, wider than average text: 36rem keeps a line near 75 characters, and every block shares that edge. */
h2 { margin: 40px 0 10px; color: var(--text); font-size: var(--fs-xl); font-weight: 600; line-height: 1.25; scroll-margin-top: 16px; }
h3 { max-width: 36rem; margin: 28px 0 6px; color: var(--text); font-size: var(--fs-lg); font-weight: 600; line-height: 1.35; scroll-margin-top: 16px; }
h2 + h3 { margin-top: 16px; }
p { max-width: 36rem; margin: 0 0 14px; }
ul, ol { max-width: 36rem; margin: 8px 0 20px; padding-left: 22px; }
li { margin: 6px 0; }
figure { margin: 22px 0; }
figure img { display: block; width: 100%; height: auto; max-width: 880px; border: 1px solid var(--line); border-radius: var(--radius-md); }
figcaption { margin-top: 7px; color: var(--muted); font-size: var(--fs-xs); }
.markdown-table { max-width: 100%; overflow-x: auto; margin: 16px 0 24px; border: 1px solid var(--line); border-radius: var(--radius-md); }
table { width: 100%; border-collapse: collapse; font-size: var(--fs-md); line-height: 1.45; }
th, td { padding: 10px 14px; text-align: left; vertical-align: top; }
th { color: var(--text); background: var(--control); font-weight: 600; }
tbody td { border-top: 1px solid var(--line); }
.markdown-note { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; max-width: 36rem; margin: 18px 0 22px; padding: 14px 16px; border-radius: var(--radius-md); background: var(--control); }
.markdown-note > svg { width: 18px; height: 18px; margin-top: 3px; color: var(--gold); }
.markdown-note p { margin: 0; font-size: var(--fs-md); }
.media-placeholder { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 14px; max-width: 36rem; min-height: 96px; margin: 18px 0 24px; padding: 16px 18px; border: 1px dashed var(--line-strong); border-radius: var(--radius-md); color: var(--muted); }
.media-placeholder > svg { width: 22px; height: 22px; color: var(--gold); }
.media-placeholder figcaption { display: grid; gap: 3px; margin: 0; font-size: var(--fs-md); }
.media-placeholder strong { color: var(--text-soft); font-size: var(--fs-sm); }
</style>
