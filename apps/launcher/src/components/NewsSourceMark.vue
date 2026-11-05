<script setup lang="ts">
/**
 * The small mark that names a news source wherever a story appears: the
 * Guild Wars helmet, the gwonmac icon, or a calendar for curated events.
 */
import { CalendarDays } from "lucide-vue-next";
import type { LauncherNewsSource } from "@shared/launcher-contracts";
import helmetUrl from "../assets/guild-wars-helmet.png";
import gwonmacUrl from "../assets/gwonmac-icon.png";

defineProps<{ source: LauncherNewsSource; large?: boolean }>();
</script>

<template>
  <img v-if="source === 'game'" class="source-mark" :class="{ large }" :src="helmetUrl" alt="" />
  <img v-else-if="source === 'launcher'" class="source-mark" :class="{ large }" :src="gwonmacUrl" alt="" />
  <span v-else class="source-mark event" :class="{ large }" aria-hidden="true"><CalendarDays /></span>
</template>

<style scoped>
.source-mark { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 5px; object-fit: contain; }
.source-mark.large { width: 24px; height: 24px; border-radius: 6px; }
.event { display: grid; place-items: center; color: var(--success); background: var(--success-tint); }
.event svg { width: 12px; height: 12px; }
.event.large svg { width: 14px; height: 14px; }
</style>
