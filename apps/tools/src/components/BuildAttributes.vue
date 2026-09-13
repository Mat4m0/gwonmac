<!-- Compact read-only attribute ranks, with full names available on each label. -->
<script setup lang="ts">
import { computed } from 'vue';
import type { Build } from '../../../../src/shared/builds/library';
import { buildAttributes } from '../../../../src/shared/builds/presentation';
const props = defineProps<{ attributes: Build['attributes'] }>();
const attributes = computed(() => buildAttributes(props.attributes));
</script>
<template>
  <span class="build-attributes">
    <span v-for="group in attributes" :key="group.name" class="build-attribute-group">
      <img :src="group.icon" :alt="group.name" :title="group.name" draggable="false" />
      <span v-for="attribute in group.attributes" :key="attribute.name" class="build-attribute"
        role="img" :aria-label="`${attribute.name} ${attribute.rank}`" :title="`${attribute.name} ${attribute.rank}`">
        {{ attribute.label }} <b>{{ attribute.rank }}</b>
      </span>
    </span>
  </span>
</template>
<style>
.build-attributes { display:flex; flex-wrap:wrap; align-items:center; gap:5px 10px; color:var(--ui-text-muted); font-size:12px; }
.build-attribute { display:inline-flex; align-items:center; gap:3px; white-space:nowrap; }
.build-attribute-group > img { width:18px; height:18px; object-fit:contain; }
.build-attribute b { color:var(--ui-text); font-variant-numeric:tabular-nums; }
.build-attribute-group { display:inline-flex; align-items:center; flex-wrap:wrap; gap:5px; max-width:100%; }
.build-attribute + .build-attribute::before { content:""; height:10px; border-left:1px solid var(--ui-edge); margin-inline:2px 3px; }
</style>
