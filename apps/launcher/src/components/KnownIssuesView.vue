<script setup lang="ts">
import { AlertTriangle, Check, ExternalLink } from "lucide-vue-next";
import type { LauncherExternalLink } from "@shared/launcher-contracts";

defineProps<{ availability: "fixture" | "placeholder" }>();
const emit = defineEmits<{ external: [kind: LauncherExternalLink] }>();
</script>

<template>
  <section class="page">
    <div class="page-head"><div><span class="eyebrow">Support</span><h1>Known issues</h1><p>Current game and macOS issues, with workarounds when we have one.</p></div></div>
    <div v-if="availability === 'placeholder'" class="empty-state"><AlertTriangle /><h3>Known issues are not connected yet.</h3><p>Check GitHub or Discord for current reports and workarounds.</p><div class="form-actions"><button class="secondary" @click="emit('external', 'discord')">Open Discord</button><button class="primary" @click="emit('external', 'github')">Open GitHub</button></div></div>
    <div v-else class="issue-list">
      <article><AlertTriangle /><div><h3>Some textures may appear black</h3><p>Restart the affected game window. Your saved data is not affected.</p><button class="text-link" @click="emit('external', 'github')">View workaround <ExternalLink /></button></div><span>Game</span></article>
      <article><AlertTriangle /><div><h3>Long sessions can use too much memory</h3><p>Close and reopen the game window when macOS shows a memory warning.</p></div><span>Game</span></article>
      <article class="resolved"><Check /><div><h3>Map reveal crash</h3><p>Fixed in the current launcher version.</p></div><span>Resolved</span></article>
    </div>
  </section>
</template>
