<!-- Canonical Tango artwork for profession labels across the Tools UI. -->
<script setup lang="ts">
import { computed } from 'vue';
import type { Profession } from '../../../../src/shared/builds/library';
import { buildProfessions } from '../../../../src/shared/builds/presentation';
const props = defineProps<{ profession?: Profession | null | undefined }>();
const icon = computed(() => buildProfessions([props.profession ?? null])[0]);
</script>
<template>
  <img v-if="icon" class="profession-icon" :src="icon.icon" :alt="icon.name" :title="icon.name" draggable="false" />
</template>
<style>
.profession-icon { display:inline-block; width:1.4em; height:1.4em; object-fit:contain; vertical-align:middle; flex-shrink:0; }
.profession-mark > .profession-icon, .hero-avatar > .profession-icon { width:80%; height:80%; }
</style>
