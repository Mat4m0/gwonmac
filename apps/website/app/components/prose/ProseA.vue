<script setup lang="ts">
// Overrides the docs layer's ProseA for one case: the guide pages are also the
// launcher's built-in Guide, where `settings:<section>/<control>` opens that
// setting. A browser has no such page, so the website shows the setting's name.
import { computed } from "vue";

const props = defineProps<{ href?: string; target?: string }>();
const isSetting = computed(() => props.href?.startsWith("settings:"));
const isExternal = computed(() => props.target === "_blank" || (props.href && /^https?:\/\//.test(props.href)));
</script>

<template>
  <strong v-if="isSetting"><slot /></strong>
  <NuxtLink v-else :href="props.href || ''" :target="props.target">
    <slot />
    <Icon v-if="isExternal" name="lucide:arrow-up-right" class="ml-0.5 inline size-3 align-text-top" aria-hidden="true" />
  </NuxtLink>
</template>
