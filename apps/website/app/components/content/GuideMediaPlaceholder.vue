<script setup lang="ts">
// A screenshot or video that is still to be made. The launcher's Guide draws the
// same block from the same Markdown (src/shared/launcher-markdown.ts).
defineProps<{ type?: "image" | "video" }>();
</script>

<template>
  <figure class="my-6 flex items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
    <Icon :name="type === 'video' ? 'lucide:clapperboard' : 'lucide:image'" class="size-5 shrink-0 text-primary" aria-hidden="true" />
    <figcaption><strong class="block text-foreground">{{ type === "video" ? "Video to come" : "Screenshot to come" }}</strong><slot /></figcaption>
  </figure>
</template>
