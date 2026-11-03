<script setup lang="ts">
import { Coffee, Github, Home, LifeBuoy, Settings, Users } from "lucide-vue-next";
import type { LauncherExternalLink } from "@shared/launcher-contracts";
import type { LauncherRoute } from "../routes";
import DiscordIcon from "./DiscordIcon.vue";
import iconUrl from "../assets/gwonmac-icon.png";

defineProps<{ route: LauncherRoute }>();
const emit = defineEmits<{
  navigate: [route: LauncherRoute];
  settings: [];
  external: [kind: LauncherExternalLink];
}>();
</script>

<template>
  <header class="titlebar">
    <button class="brand" aria-label="GWonMac home" @click="emit('navigate', 'home')"><img :src="iconUrl" alt="" /><span>GWonMac</span></button>
    <nav aria-label="Main navigation">
      <button :class="{ active: route === 'home' }" :aria-current="route === 'home' ? 'page' : undefined" @click="emit('navigate', 'home')"><Home />Home</button>
      <button :class="{ active: route === 'accounts' }" :aria-current="route === 'accounts' ? 'page' : undefined" @click="emit('navigate', 'accounts')"><Users />Accounts</button>
      <button :class="{ active: route === 'help' }" :aria-current="route === 'help' ? 'page' : undefined" @click="emit('navigate', 'help')"><LifeBuoy />Help</button>
    </nav>
    <div class="title-actions">
      <button class="support-pill" aria-label="Support gwonmac on Ko-fi" title="gwonmac is free and built in spare time" @click="emit('external', 'donate')"><Coffee />Support</button>
      <button class="icon-button" aria-label="Open Discord" title="Discord" @click="emit('external', 'discord')"><DiscordIcon /></button>
      <button class="icon-button" aria-label="Open GitHub" title="GitHub" @click="emit('external', 'github')"><Github /></button>
      <button class="icon-button" aria-label="Settings" @click="emit('settings')"><Settings /></button>
    </div>
  </header>
</template>
