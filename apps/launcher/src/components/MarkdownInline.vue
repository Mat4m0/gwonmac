<script setup lang="ts">
import type { MarkdownInline } from "@shared/launcher-markdown";

defineProps<{ parts: readonly MarkdownInline[] }>();
const emit = defineEmits<{ link: [actionId: string] }>();
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <button v-if="part.actionId" type="button" class="markdown-link" @click="emit('link', part.actionId)"><strong v-if="part.emphasis === 'strong'">{{ part.text }}</strong><template v-else>{{ part.text }}</template></button>
    <strong v-else-if="part.emphasis === 'strong'">{{ part.text }}</strong>
    <code v-else-if="part.emphasis === 'code'">{{ part.text }}</code>
    <kbd v-else-if="part.emphasis === 'kbd'">{{ part.text }}</kbd>
    <template v-else>{{ part.text }}</template>
  </template>
</template>

<style scoped>
/* A quiet underline: links stay findable without striking through every line they sit on. */
.markdown-link { display: inline; padding: 0; border: 0; color: var(--gold-text); background: transparent; font: inherit; text-decoration: underline 1px color-mix(in srgb, currentColor 40%, transparent); text-underline-offset: 4px; cursor: pointer; }
.markdown-link:hover, .markdown-link:focus-visible { color: var(--focus); text-decoration-color: currentColor; }
strong { color: var(--text); font-weight: 600; }
code, kbd { padding: 1px 5px; border: 1px solid var(--line); border-radius: 5px; background: var(--field); font-size: .85em; }
code { color: var(--gold-text); }
kbd { display: inline-block; min-width: 1.7em; color: var(--text); font-family: inherit; line-height: 1.35; text-align: center; }
</style>
