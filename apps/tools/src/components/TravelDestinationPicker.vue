<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import {
  searchTravelDestinations,
  travelDestination,
  type TravelDestination,
} from "../../../../src/shared/travel";

const props = withDefaults(defineProps<{
  modelValue: number | null;
  label: string;
  disabled?: boolean;
  allowClear?: boolean;
}>(), {
  disabled: false,
  allowClear: false,
});
const emit = defineEmits<{ "update:modelValue": [mapId: number | null] }>();

const details = ref<HTMLDetailsElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const active = ref(0);
const open = ref(false);
const id = useId();
const selected = computed(() => props.modelValue === null
  ? null
  : travelDestination(props.modelValue)
);
const results = computed(() => query.value.trim() === ""
  ? []
  : searchTravelDestinations(query.value, 8)
);
const activeDestination = computed(() => results.value[active.value] ?? null);

watch(query, () => {
  active.value = 0;
});

async function onToggle(): Promise<void> {
  open.value = details.value?.open === true;
  if (!open.value) return;
  query.value = "";
  active.value = 0;
  await nextTick();
  input.value?.focus();
}

function close(): void {
  if (details.value !== null) details.value.open = false;
  open.value = false;
}

function choose(destination: TravelDestination): void {
  emit("update:modelValue", destination.mapId);
  close();
}

function clear(): void {
  emit("update:modelValue", null);
  close();
}

function move(direction: 1 | -1): void {
  if (results.value.length === 0) return;
  active.value = (active.value + direction + results.value.length) % results.value.length;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
    details.value?.querySelector<HTMLElement>("summary")?.focus();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Enter" && activeDestination.value !== null) {
    event.preventDefault();
    choose(activeDestination.value);
  }
}
</script>

<template>
  <details ref="details" name="travel-destination-picker" class="travel-destination-picker" :data-disabled="disabled || undefined" @toggle="onToggle">
    <summary :aria-label="label" :aria-disabled="disabled || undefined" @click="disabled && $event.preventDefault()">
      <strong>{{ selected?.name ?? "Choose a destination…" }}</strong>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </summary>
    <div class="travel-destination-chooser">
      <label :for="`${id}-query`"><span class="ui-sr-only">{{ label }}</span><input :id="`${id}-query`" ref="input" v-model="query" class="ui-input" role="combobox" :aria-controls="`${id}-results`" :aria-expanded="results.length > 0" :aria-activedescendant="activeDestination ? `${id}-${activeDestination.mapId}` : undefined" aria-autocomplete="list" autocomplete="off" spellcheck="false" maxlength="80" placeholder="Find a destination…" @keydown="onKeydown"></label>
      <div v-if="results.length" :id="`${id}-results`" class="travel-destination-results" role="listbox">
        <button v-for="(destination, index) in results" :id="`${id}-${destination.mapId}`" :key="destination.mapId" type="button" class="travel-destination-option" :data-map-id="destination.mapId" role="option" :aria-selected="index === active" @mouseenter="active = index" @click="choose(destination)"><span><strong>{{ destination.name }}</strong><small>{{ destination.campaign }}</small></span><span v-if="destination.mapId === modelValue">Selected</span></button>
      </div>
      <p v-else class="travel-destination-help">{{ query.trim() ? "No matching destination." : "Start typing a destination or abbreviation." }}</p>
      <button v-if="allowClear && modelValue !== null" type="button" class="ui-button travel-destination-clear" @click="clear">Clear selection</button>
    </div>
  </details>
</template>
