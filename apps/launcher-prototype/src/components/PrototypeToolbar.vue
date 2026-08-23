<script setup lang="ts">
import { RotateCcw } from "@lucide/vue";
import packageInfo from "../../package.json";
import type { FundingPlacement, Scenario } from "../model";

defineProps<{
  scenario: Scenario;
  fundingPlacement: FundingPlacement;
}>();

const emit = defineEmits<{
  "update:scenario": [value: Scenario];
  "update:funding-placement": [value: FundingPlacement];
  reset: [];
}>();
</script>

<template>
  <aside class="prototype-toolbar" aria-label="Prototype controls">
    <div class="prototype-title">
      <span>Launcher prototype</span>
      <small>v{{ packageInfo.version }}</small>
    </div>
    <label>
      <span>App state</span>
      <select
        :value="scenario"
        @change="emit('update:scenario', ($event.target as HTMLSelectElement).value as Scenario)"
      >
        <option value="ready">Ready</option>
        <option value="updating">Updating</option>
        <option value="degraded">Known issue</option>
        <option value="offline">Offline</option>
      </select>
    </label>
    <label>
      <span>Funding layout</span>
      <select
        :value="fundingPlacement"
        @change="emit('update:funding-placement', ($event.target as HTMLSelectElement).value as FundingPlacement)"
      >
        <option value="bar">Top bar · selected</option>
        <option value="home">Home card</option>
        <option value="dock">Launch dock</option>
        <option value="hidden">Hidden</option>
      </select>
    </label>
    <button class="quiet-button" type="button" @click="emit('reset')">
      <RotateCcw aria-hidden="true" />
      Reset
    </button>
  </aside>
</template>
