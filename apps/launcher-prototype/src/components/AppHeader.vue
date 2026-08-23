<script setup lang="ts">
import type { Component } from "vue";
import { House, Newspaper, RefreshCw, Settings2, TriangleAlert, UsersRound } from "@lucide/vue";
import type { RouteName } from "../model";

defineProps<{
  activeRoute: RouteName;
  runningCount: number;
}>();

const emit = defineEmits<{
  navigate: [route: RouteName];
  refresh: [];
}>();

const routes: Array<{ name: RouteName; label: string; icon: Component }> = [
  { name: "home", label: "Home", icon: House },
  { name: "news", label: "News", icon: Newspaper },
  { name: "settings", label: "Settings", icon: Settings2 },
  { name: "issues", label: "Known issues", icon: TriangleAlert },
  { name: "accounts", label: "Accounts", icon: UsersRound },
];
</script>

<template>
  <header class="app-header">
    <button class="brand" type="button" aria-label="Open Home" @click="emit('navigate', 'home')">
      <img src="/images/reforged-logo.webp" alt="Guild Wars Reforged" />
    </button>
    <nav class="primary-nav" aria-label="Launcher">
      <button
        v-for="item in routes"
        :key="item.name"
        type="button"
        :class="{ active: activeRoute === item.name }"
        :aria-current="activeRoute === item.name ? 'page' : undefined"
        @click="emit('navigate', item.name)"
      >
        <component :is="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
        <span v-if="item.name === 'accounts' && runningCount" class="nav-count">
          {{ runningCount }}
        </span>
      </button>
    </nav>
    <div class="header-actions">
      <button class="icon-button" type="button" aria-label="Refresh news and status" @click="emit('refresh')">
        <RefreshCw aria-hidden="true" />
      </button>
      <span class="unofficial">Unofficial client</span>
    </div>
  </header>
</template>
