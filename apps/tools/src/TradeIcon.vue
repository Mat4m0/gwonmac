<script setup lang="ts">
defineProps<{ name: "star" | "player"; filled?: boolean }>();
</script>

<template>
  <svg
    v-if="name === 'star'"
    class="trade-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    :fill="filled ? 'currentColor' : 'none'"
  >
    <path d="m12 3.4 2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.92 6.7 19.7l1.01-5.9-4.29-4.18 5.93-.86L12 3.4Z" />
  </svg>
  <svg
    v-else
    class="trade-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    :fill="filled ? 'currentColor' : 'none'"
  >
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20c.45-4.1 2.62-6.2 6.5-6.2s6.05 2.1 6.5 6.2" />
  </svg>
</template>
