<script setup lang="ts">
const { siteUrl } = useRuntimeConfig().public;

useSeoMeta({
  title: "Guild Wars for macOS — Native Launcher",
  ogTitle: "Guild Wars for macOS — Native Launcher",
  description:
    "Run ArenaNet's official Guild Wars client natively on your Mac. Up to 4K, 60 FPS, full graphics settings. Free and open source.",
  ogDescription:
    "Run ArenaNet's official Guild Wars client natively on your Mac. Up to 4K, 60 FPS, full graphics settings. Free and open source.",
  ogImage: `${siteUrl}/images/og.jpg`,
  twitterCard: "summary_large_image",
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
