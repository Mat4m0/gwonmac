<!-- Interactive known-spawn markers; empty map space stays owned by Guild Wars. -->
<script setup lang="ts">
import { computed } from "vue";
import type { EliteLocation } from "../../../../src/shared/elite-skills";
import type { EliteMapSurface } from "../../../../src/shared/elite-map";
import type { SkillCatalogue } from "../skill-catalog";
import { skillId } from "../../../../src/shared/builds/library";
import { eliteMarkers, type EliteMarker } from "../elite-map-markers";
const props = defineProps<{
  surface: EliteMapSurface; locations: readonly EliteLocation[];
  activeLocation: string | null; previewLocationId: string | null; catalogue: SkillCatalogue; label: string;
}>();
const emit = defineEmits<{
  select: [location: EliteLocation, keyboard: boolean];
  inspect: [location: EliteLocation | null, x: number, y: number, keyboard?: boolean, nearby?: readonly EliteLocation[]];
}>();
const markers = computed(() => eliteMarkers(props.locations, props.surface, props.activeLocation));
const boxStyle = computed(() => Object.fromEntries(Object.entries(props.surface.box).map(([key, value]) => [key, `${value}px`])));
function inspect(marker: EliteMarker, keyboard = false) {
  // Use the visible, filtered positions. Alternate points of one boss need only one choice.
  const nearby = [...new Map(markers.value
    .filter(other => Math.abs(other.x - marker.x) < 28 && Math.abs(other.y - marker.y) < 28)
    .flatMap(other => other.locations.map(location => [location.id, location] as const))).values()];
  emit("inspect", marker.location, props.surface.box.left + marker.x, props.surface.box.top + marker.y, keyboard, nearby);
}
const name = (marker: EliteMarker) => `${props.catalogue.get(skillId(marker.location.skillId)).name} — ${[...new Set(marker.locations.map(location => location.boss))].join(", ")}`;
</script>
<template>
  <div class="elite-markers" :style="boxStyle" :aria-label="label">
    <button v-for="marker in markers" :key="marker.key" class="elite-marker"
      :class="{ 'elite-marker--active': marker.active, 'elite-marker--outside': marker.outside }"
      :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
      :aria-describedby="marker.locations.some(location => location.id === previewLocationId) ? 'elite-skill-preview' : undefined"
      :aria-label="`${name(marker)}${marker.outside ? '; outside this map view' : '; known spawn'}`"
      @click="emit('select', marker.location, $event.detail === 0)"
      @pointerenter="inspect(marker)"
      @pointerleave="emit('inspect', null, 0, 0)"
      @focus="inspect(marker, true)"
      @blur="emit('inspect', null, 0, 0)">
      <span class="elite-marker-art">
        <img v-if="catalogue.get(skillId(marker.location.skillId)).iconUrl"
          :src="catalogue.get(skillId(marker.location.skillId)).iconUrl!" alt="" draggable="false">
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 9-8 9-8-9Z" /></svg>
      </span>
      <span v-if="marker.active" class="elite-marker-label">{{ marker.outside ? 'Outside map view' : marker.location.boss }}</span>
    </button>
  </div>
</template>
