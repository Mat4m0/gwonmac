<script setup lang="ts">
import { ArrowRight, Download, TriangleAlert, WifiOff } from "@lucide/vue";
import type { RouteName, Scenario } from "../model";

defineProps<{ scenario: Scenario }>();
const emit = defineEmits<{ navigate: [route: RouteName] }>();
</script>

<template>
  <section v-if="scenario !== 'ready'" class="status-banner" :class="scenario" role="status">
    <Download v-if="scenario === 'updating'" aria-hidden="true" />
    <WifiOff v-else-if="scenario === 'offline'" aria-hidden="true" />
    <TriangleAlert v-else aria-hidden="true" />
    <div>
      <strong>
        {{ scenario === "updating" ? "Downloading an update" : scenario === "offline" ? "Offline" : "Some Tools are unavailable" }}
      </strong>
      <span>
        {{ scenario === "updating" ? "You can play while it downloads." : scenario === "offline" ? "News may be out of date. Your installed game files are still available." : "Guild Wars is ready. Quick Travel and Apply teams are being checked." }}
      </span>
    </div>
    <button type="button" @click="emit('navigate', scenario === 'updating' ? 'settings' : 'issues')">
      {{ scenario === "updating" ? "View download" : "View details" }}
      <ArrowRight aria-hidden="true" />
    </button>
  </section>
</template>
