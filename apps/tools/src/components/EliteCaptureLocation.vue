<!-- A capture choice keeps notes and coordinate availability beside its target action. -->
<script setup lang="ts">
import type { EliteLocation } from "../../../../src/shared/elite-skills";
import { guildWarsMapName } from "../../../../src/shared/guild-wars-map-names";
defineProps<{ location: EliteLocation; active: boolean; here: boolean; disabled: boolean }>();
const emit = defineEmits<{ target: []; wiki: [] }>();
</script>
<template>
  <div class="elite-location" :data-active="active">
    <div class="elite-location-heading"><strong>{{ location.boss }}</strong><span v-if="here">In this area</span></div>
    <p>{{ guildWarsMapName(location.mapId) }}</p>
    <p class="elite-support">{{ location.points.length === 0 ? 'Boss position unavailable. Use the notes.' : location.points.length > 1 ? `${location.points.length} possible positions` : 'Known spawn location' }}</p>
    <details v-if="location.note" class="elite-encounter-notes"><summary>Encounter notes</summary><p class="elite-location-note">{{ location.note }}</p></details>
    <div class="elite-actions"><button class="ui-button elite-target-button" :disabled="disabled || /impossible to capture/i.test(location.note ?? '')" :aria-pressed="active" @click="emit('target')">{{ /impossible to capture/i.test(location.note ?? '') ? 'Cannot capture here' : active ? 'Current target' : 'Set target' }}</button>
      <button class="ui-link" @click="emit('wiki')">Boss wiki</button></div>
  </div>
</template>
