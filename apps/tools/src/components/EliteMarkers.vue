<!-- Interactive known-spawn markers; empty map space stays owned by Guild Wars. -->
<script setup lang="ts">
import { computed } from "vue";
import type { EliteLocation } from "../../../../src/shared/elite-skills";
import type { EliteMapSurface } from "../../../../src/shared/elite-map";
import type { SkillCatalogue } from "../skill-catalog";
import { skillId } from "../../../../src/shared/builds/library";
import { eliteMarkers } from "../elite-map-markers";
const props = defineProps<{
  surface: EliteMapSurface; locations: readonly EliteLocation[];
  activeLocation: string | null; catalogue: SkillCatalogue; label: string;
}>();
const emit = defineEmits<{
  select: [location: EliteLocation, keyboard: boolean];
  inspect: [location: EliteLocation | null, x: number, y: number];
}>();
const markers = computed(() => eliteMarkers(props.locations, props.surface, props.activeLocation));
const boxStyle = computed(() => Object.fromEntries(Object.entries(props.surface.box).map(([key, value]) => [key, `${value}px`])));
const name = (location: EliteLocation) => `${props.catalogue.get(skillId(location.skillId)).name} — ${location.boss}`;
</script>
<template>
  <div class="elite-markers" :style="boxStyle" :aria-label="label">
    <button v-for="marker in markers" :key="marker.key" class="elite-marker"
      :class="{ 'elite-marker--active': marker.active, 'elite-marker--outside': marker.outside }"
      :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
      :aria-label="`${name(marker.location)}${marker.outside ? '; outside this map view' : '; known spawn'}`"
      @click="emit('select', marker.location, $event.detail === 0)"
      @pointerenter="emit('inspect', marker.location, surface.box.left + marker.x, surface.box.top + marker.y)"
      @pointerleave="emit('inspect', null, 0, 0)"
      @focus="emit('inspect', marker.location, surface.box.left + marker.x, surface.box.top + marker.y)"
      @blur="emit('inspect', null, 0, 0)">
        <img v-if="catalogue.get(skillId(marker.location.skillId)).iconUrl"
          :src="catalogue.get(skillId(marker.location.skillId)).iconUrl!" alt="" draggable="false">
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 9-8 9-8-9Z" /></svg>
      <span v-if="marker.active" class="elite-marker-label">{{ marker.outside ? 'Outside map view' : marker.location.boss }}</span>
    </button>
  </div>
</template>
