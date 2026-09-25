<!-- One capture choice: boss, area, positions, and notes beside a compact target action. -->
<script setup lang="ts">
import { computed } from "vue";
import type { EliteLocation } from "../../../../src/shared/elite-skills";
import { guildWarsMapName } from "../../../../src/shared/guild-wars-map-names";
const props = defineProps<{ location: EliteLocation; active: boolean; here: boolean; learned: boolean; disabled: boolean }>();
const emit = defineEmits<{ target: []; wiki: [] }>();
const impossible = computed(() => /impossible to capture/i.test(props.location.note ?? ""));
const meta = computed(() => [props.here ? "In this area" : guildWarsMapName(props.location.mapId),
  props.location.points.length === 0 ? "Position unknown" : props.location.points.length > 1 ? `${props.location.points.length} possible positions` : null,
].filter(Boolean).join(" · "));
</script>
<template>
  <div class="elite-location" :data-active="active">
    <div class="elite-location-text">
      <strong>{{ location.boss }}</strong>
      <small>{{ meta }}</small>
      <p v-if="location.note" class="elite-location-note">{{ location.note }}</p>
      <button class="ui-link" @click="emit('wiki')">Boss wiki</button>
    </div>
    <span v-if="learned" class="elite-tag" data-kind="captured">Learned</span>
    <span v-else-if="impossible" class="elite-tag">Cannot capture here</span>
    <span v-else-if="active" class="elite-tag" data-kind="target">✓ Target</span>
    <button v-else class="ui-button elite-target-button" :disabled="disabled" @click="emit('target')">Set target</button>
  </div>
</template>
