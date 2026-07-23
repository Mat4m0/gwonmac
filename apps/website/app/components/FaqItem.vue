<script setup lang="ts">
const props = defineProps<{ question: string }>();
const tracked = ref(false);
const { trackFaqOpen } = useTracking();

function handleToggle(event: Event): void {
  const details = event.currentTarget as HTMLDetailsElement;
  if (!details.open || tracked.value) return;
  tracked.value = true;
  trackFaqOpen(props.question);
}
</script>

<template>
  <details class="panel group px-5 py-4" @toggle="handleToggle">
    <summary class="cursor-pointer list-none text-parchment-100 select-none marker:content-none">
      <span class="mr-2 inline-block text-gold-400 transition-transform group-open:rotate-90">›</span>
      {{ question }}
    </summary>
    <div class="mt-3 space-y-2 pl-5 text-parchment-300/90">
      <slot />
    </div>
  </details>
</template>
