<script setup lang="ts">
const locked = defineModel<boolean>({ required: true });
</script>

<template>
  <button type="button" class="ui-window-lock" :aria-label="locked ? 'Unlock window position' : 'Lock window position'" :aria-pressed="locked" :title="locked ? 'Unlock to move and resize' : 'Lock position and size'" @click="locked = !locked">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path class="lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="5" y="11" width="14" height="10" rx="2"/></svg>
  </button>
</template>
