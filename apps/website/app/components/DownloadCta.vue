<script setup lang="ts">
import type { DownloadSource } from "../composables/useTracking";

const props = withDefaults(
  defineProps<{
    size?: "compact" | "large";
    source: DownloadSource;
  }>(),
  { size: "large" },
);

const { url, version } = useLatestRelease();
const { trackDownload } = useTracking();

function handleDownload(): void {
  trackDownload(props.source, version.value);
}
</script>

<template>
  <div :class="props.size === 'large' ? 'flex flex-col items-center gap-2' : ''">
    <a
      :href="url"
      class="btn-primary"
      :class="props.size === 'large' ? 'px-8 py-4 text-lg' : 'px-4 py-2 text-sm'"
      @click="handleDownload"
    >
      Download for macOS
    </a>
    <p v-if="props.size === 'large'" class="text-sm text-parchment-300/60">
      <template v-if="version">{{ version }} · </template>Free · Open-source host (GPL-3.0) · Apple Silicon
    </p>
  </div>
</template>
