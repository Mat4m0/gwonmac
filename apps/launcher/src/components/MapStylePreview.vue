<script setup lang="ts">
import type { CartographyLinePattern, CartographyPresetStyle } from "@shared/cartography-overlay";
defineProps<{ style: CartographyPresetStyle; gridOpacity: number; terrainOpacity: number }>();
const dashes: Record<CartographyLinePattern, string | undefined> = { solid: undefined, dashed: "8 5", dotted: "2 5", "dash-dot": "9 4 2 4" };
const boundary = "M0 120 L50 90 L92 104 L138 54 L190 70 L230 28 L320 40";

</script>

<template>
  <figure class="map-preview">
    <svg viewBox="0 0 320 160" role="img" aria-label="Illustrative map style: shaded terrain, border, grid lines, current cell, and unexplored marker">
      <rect width="320" height="160" fill="#343d33" />
      <g :opacity="terrainOpacity / 100">
        <path :d="`${boundary} L320 0 L0 0 Z`" :fill="style.walkability.veilColor" />
        <template v-if="style.walkability.boundaryWidth > 0">
          <path :d="boundary" fill="none" :stroke="style.walkability.boundaryCasingColor" :stroke-width="style.walkability.boundaryWidth + 2" />
          <path :d="boundary" fill="none" :stroke="style.walkability.boundaryColor" :stroke-width="style.walkability.boundaryWidth" />
        </template>
      </g>
      <g :opacity="gridOpacity / 100" fill="none">
        <template v-for="casing in [true, false]" :key="String(casing)">
          <path v-if="style.grid.lattice.width > 0" d="M40 0V160 M80 0V160 M120 0V160 M160 0V160 M200 0V160 M240 0V160 M280 0V160 M0 40H320 M0 80H320 M0 120H320" :stroke="casing ? style.grid.casingColor : style.grid.lattice.color" :stroke-width="style.grid.lattice.width + (casing ? 2 : 0)" :stroke-dasharray="dashes[style.grid.lattice.pattern]" />
          <rect x="160" y="80" width="40" height="40" :stroke="casing ? style.grid.casingColor : style.grid.current.color" :stroke-width="style.grid.current.width + (casing && style.grid.current.width > 0 ? 2 : 0)" :stroke-dasharray="dashes[style.grid.current.pattern]" />
        </template>
        <g :stroke="style.grid.unseen.color" :fill="style.grid.unseen.color">
          <path v-if="style.grid.unseen.marker === 'diamond'" d="M260 90L270 100L260 110L250 100Z" />
          <path v-else-if="style.grid.unseen.marker === 'cross'" d="M253 93L267 107M267 93L253 107" fill="none" stroke-width="3" />
          <path v-else-if="style.grid.unseen.marker === 'corners'" d="M250 96V90H256 M264 90H270V96 M270 104V110H264 M256 110H250V104" fill="none" stroke-width="2" />
          <path v-else-if="style.grid.unseen.marker === 'hatch'" d="M250 100L260 90 M250 110L270 90 M260 110L270 100" fill="none" stroke-width="2" />
          <g v-else><circle cx="255" cy="95" r="2" /><circle cx="265" cy="95" r="2" /><circle cx="255" cy="105" r="2" /><circle cx="265" cy="105" r="2" /></g>
        </g>
      </g>
    </svg>
    <figcaption>Style preview · illustrative terrain. Layer visibility is controlled above.</figcaption>
  </figure>
</template>

<style scoped>
.map-preview { display: grid; grid-template-columns: minmax(160px, 280px) minmax(0, 1fr); align-items: center; gap: 16px; margin: 0; padding: 16px; }
.map-preview svg { width: 100%; height: auto; border-radius: 8px; }
.map-preview figcaption { font-size: 13px; line-height: 1.5; color: var(--muted); }
@media (max-width: 600px) { .map-preview { grid-template-columns: 1fr; }.map-preview svg { max-width: 280px; } }
</style>
