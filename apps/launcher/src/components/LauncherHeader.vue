<script setup lang="ts">
import { AlertTriangle, CircleHelp, Home, MessageSquareText, Settings, Users } from "lucide-vue-next";
import type { LauncherRoute } from "../routes";
import logoUrl from "@site/reforged-logo.webp";

defineProps<{ route: LauncherRoute }>();
const emit = defineEmits<{
  navigate: [route: LauncherRoute];
  settings: [];
  introduction: [];
}>();
</script>

<template>
  <header class="titlebar">
    <button class="brand" aria-label="Home" @click="emit('navigate', 'home')"><img :src="logoUrl" alt="Guild Wars Reforged" /></button>
    <nav aria-label="Main navigation">
      <button :class="{ active: route === 'home' }" :aria-current="route === 'home' ? 'page' : undefined" @click="emit('navigate', 'home')"><Home />Home</button>
      <button :class="{ active: route === 'accounts' }" :aria-current="route === 'accounts' ? 'page' : undefined" @click="emit('navigate', 'accounts')"><Users />Accounts</button>
      <button :class="{ active: route === 'issues' }" :aria-current="route === 'issues' ? 'page' : undefined" @click="emit('navigate', 'issues')"><AlertTriangle />Known issues</button>
      <button :class="{ active: route === 'feedback' }" :aria-current="route === 'feedback' ? 'page' : undefined" @click="emit('navigate', 'feedback')"><MessageSquareText />Feedback</button>
    </nav>
    <div class="title-actions">
      <button class="icon-button" aria-label="Settings" @click="emit('settings')"><Settings /></button>
      <button class="help-button" @click="emit('introduction')"><CircleHelp />Show introduction</button>
      <span class="unofficial">Unofficial client</span>
    </div>
  </header>
</template>
