<script setup lang="ts">
// Shadows the layer's SiteBanner: the "unofficial" notice is a permanent
// disclaimer, so the dismiss button and its localStorage state are gone.
// The --site-banner-height writer is kept verbatim — sticky sidebar/TOC
// math depends on this component being its single writer.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useGinkoDocsConfig } from "#ginko-docs/composables/useGinkoDocsConfig";
import { useSiteNavigation } from "#ginko-docs/composables/useSiteNavigation";

const props = defineProps<{
  landing?: boolean;
}>();

const { banner } = useSiteNavigation();
const config = useGinkoDocsConfig();

const visible = computed(
  () => banner.value.show && (!props.landing || config.banner.showOnLanding),
);

// The banner scrolls away above the sticky header, so sticky consumers
// (docs sidebar/TOC heights, mobile menu top) need its *currently visible*
// height. This component is the single writer of --site-banner-height.
const bannerElement = ref<HTMLElement | null>(null);
let rafId: number | null = null;
let lastHeight = -1;

function updateBannerHeightVar() {
  rafId = null;
  const element = bannerElement.value;
  const height = element
    ? Math.max(0, Math.min(element.getBoundingClientRect().bottom, element.offsetHeight))
    : 0;
  if (height === lastHeight) return;
  lastHeight = height;
  document.documentElement.style.setProperty("--site-banner-height", `${height}px`);
}

function scheduleBannerHeightVar() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(updateBannerHeightVar);
}

watch(visible, () => {
  void nextTick(scheduleBannerHeightVar);
});

onMounted(() => {
  window.addEventListener("scroll", scheduleBannerHeightVar, { passive: true });
  window.addEventListener("resize", scheduleBannerHeightVar, { passive: true });
  scheduleBannerHeightVar();
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", scheduleBannerHeightVar);
  window.removeEventListener("resize", scheduleBannerHeightVar);
  if (rafId !== null) cancelAnimationFrame(rafId);
  document.documentElement.style.setProperty("--site-banner-height", "0px");
});
</script>

<template>
  <div
    v-if="visible"
    ref="bannerElement"
    role="region"
    :aria-label="banner.text"
    class="relative z-30 bg-linear-to-b from-[#7a2008] to-[#451104] px-10 py-2.5 text-center text-sm leading-5 font-medium text-[#ffe4c8] shadow-[inset_0_-1px_0_#0a0806]"
  >
    <span class="mx-auto block max-w-[min(100%,52rem)]">
      {{ banner.text }}
      <NuxtLink
        v-if="banner.linkHref"
        :to="banner.linkHref"
        class="ml-1.5 inline-block text-[#f3dd9d] underline underline-offset-2 opacity-90 transition-opacity hover:opacity-100"
      >
        {{ banner.linkLabel }}
      </NuxtLink>
    </span>
  </div>
</template>
