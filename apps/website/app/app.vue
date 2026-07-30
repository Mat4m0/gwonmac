<script setup lang="ts">
const { siteUrl } = useRuntimeConfig().public;

useSeoMeta({
  title: "Guild Wars Reforged — Independent macOS Client",
  ogTitle: "Guild Wars Reforged — Independent macOS Client",
  description:
    "Run ArenaNet's official Guild Wars Reforged client on your Mac with this independent, open-source host.",
  ogDescription:
    "Run ArenaNet's official Guild Wars Reforged client on your Mac with this independent, open-source host.",
  ogImage: `${siteUrl}/images/og.jpg`,
  twitterCard: "summary_large_image",
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
