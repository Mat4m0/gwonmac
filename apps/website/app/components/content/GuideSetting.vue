<script setup lang="ts">
// A setting named in a guide page. In the launcher's built-in Guide it opens
// that control; a browser has no Settings page, so here it shows the name.
defineProps<{ to: string }>();
</script>

<template>
  <strong><slot /></strong>
</template>
