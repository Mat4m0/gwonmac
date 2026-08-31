<script setup lang="ts">
import { AlertTriangle, Github, Home, MessageSquareText, Settings, Users } from "lucide-vue-next";
import type { LauncherExternalLink } from "@shared/launcher-contracts";
import type { LauncherRoute } from "../routes";
import DiscordIcon from "./DiscordIcon.vue";
import logoUrl from "@site/reforged-logo.webp";

defineProps<{ route: LauncherRoute }>();
const emit = defineEmits<{
  navigate: [route: LauncherRoute];
  settings: [];
  external: [kind: LauncherExternalLink];
}>();
</script>

<template>
  <header class="titlebar">
    <button class="brand" aria-label="Home" @click="emit('navigate', 'home')"><img :src="logoUrl" alt="Guild Wars Reforged" /></button>
    <nav aria-label="Main navigation">
      <button :class="{ active: route === 'home' }" :aria-current="route === 'home' ? 'page' : undefined" @click="emit('navigate', 'home')"><Home />Home</button>
      <button :class="{ active: route === 'accounts' }" :aria-current="route === 'accounts' ? 'page' : undefined" @click="emit('navigate', 'accounts')"><Users />Accounts</button>
      <button class="issues-nav" :class="{ active: route === 'issues' }" :aria-current="route === 'issues' ? 'page' : undefined" @click="emit('navigate', 'issues')"><AlertTriangle />Known issues</button>
      <button class="feedback-nav" :class="{ active: route === 'feedback' }" :aria-current="route === 'feedback' ? 'page' : undefined" @click="emit('navigate', 'feedback')"><MessageSquareText />Feedback</button>
    </nav>
    <div class="title-actions">
      <button class="icon-button" aria-label="Open Discord" title="Discord" @click="emit('external', 'discord')"><DiscordIcon /></button>
      <button class="icon-button" aria-label="Open GitHub" title="GitHub" @click="emit('external', 'github')"><Github /></button>
      <button class="icon-button" aria-label="Settings" @click="emit('settings')"><Settings /></button>
    </div>
  </header>
</template>
