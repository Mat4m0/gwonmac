<script setup lang="ts">
import { computed } from "vue";
import { traderItemIcon } from "../trader-assets";
import type { TraderItem } from "../../../../src/shared/trader-catalog";

const props = defineProps<{ item: TraderItem; size?: "small" | "large" }>();
const icon = computed(() => traderItemIcon(props.item));
</script>

<template>
  <span
    class="trader-item-icon"
    :class="`trader-item-icon--${size ?? 'small'}`"
    aria-hidden="true"
  >
    <img :src="icon" alt="">
  </span>
</template>
