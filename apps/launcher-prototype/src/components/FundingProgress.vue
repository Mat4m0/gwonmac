<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  raised: number;
  goal: number;
  compact?: boolean;
}>();

defineEmits<{ support: [] }>();

const percentage = computed(() => Math.min(100, Math.round((props.raised / props.goal) * 100)));
</script>

<template>
  <section class="funding" :class="{ compact }" aria-labelledby="funding-title">
    <div class="funding-copy">
      <strong id="funding-title">Help cover the yearly costs</strong>
      <span>Apple Developer Program, domain, and hosting</span>
    </div>
    <div class="funding-meter">
      <div class="funding-values">
        <span>€{{ raised }} raised</span>
        <span>€{{ goal }} goal</span>
      </div>
      <div
        class="progress-track"
        role="progressbar"
        :aria-valuenow="raised"
        aria-valuemin="0"
        :aria-valuemax="goal"
        :aria-label="`€${raised} of €${goal} raised`"
      >
        <span :style="{ width: `${percentage}%` }"></span>
      </div>
    </div>
    <button class="secondary-button" type="button" @click="$emit('support')">Support project</button>
  </section>
</template>
