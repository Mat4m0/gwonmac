<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  TRAVEL_DISTRICTS,
  searchTravelDestinations,
  travelDestination,
  type TravelDestination,
  type TravelDistrictId,
  type TravelRequest,
  type TravelShortcuts,
} from "../../../../src/shared/travel";
import type { TravelHost } from "../travel-host";

const props = defineProps<{
  host: TravelHost;
  visible: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const active = ref(0);
const district = ref<TravelDistrictId>("international");
const districtNumber = ref(0);
const shortcuts = ref<TravelShortcuts>([]);
const problem = ref("");
const busyMapId = ref<number | null>(null);
let timeout = 0;

const results = computed(() => searchTravelDestinations(query.value));
const shortcutRows = computed(() => shortcuts.value
  .map((request, index) => ({
    index,
    request,
    destination: request === null ? null : travelDestination(request.mapId),
  }))
  .filter((row): row is typeof row & { request: TravelRequest; destination: TravelDestination } =>
    row.request !== null && row.destination !== null
  ));
const activeDestination = computed(() => results.value[active.value] ?? null);

watch(results, (next) => {
  if (active.value >= next.length) active.value = Math.max(0, next.length - 1);
});

watch(() => props.visible, async (visible) => {
  if (!visible) return;
  query.value = "";
  active.value = 0;
  problem.value = "";
  busyMapId.value = null;
  window.clearTimeout(timeout);
  await nextTick();
  input.value?.focus({ preventScroll: true });
});

watch(() => props.host.state.value, (state) => {
  if (busyMapId.value === null) return;
  if (state.status === "waiting" && state.reason === "loading") emit("close");
  else if (state.status === "ready" && state.mapId === busyMapId.value) emit("close");
});

function requestFor(destination: TravelDestination): TravelRequest {
  const requestedDistrict = Number.isSafeInteger(districtNumber.value)
    ? districtNumber.value
    : 0;
  return {
    mapId: destination.mapId,
    district: district.value,
    districtNumber: Math.max(0, Math.min(255, requestedDistrict)),
  };
}

async function travel(request: TravelRequest): Promise<void> {
  if (busyMapId.value !== null) return;
  problem.value = "";
  busyMapId.value = request.mapId;
  try {
    await props.host.travel(request);
    timeout = window.setTimeout(() => {
      busyMapId.value = null;
      problem.value = "Guild Wars did not start travelling. Check that this outpost is unlocked.";
    }, 3_000);
  } catch (cause) {
    busyMapId.value = null;
    problem.value = cause instanceof Error ? cause.message : "Travel could not start.";
  }
}

async function assignShortcut(slot: number): Promise<void> {
  const destination = activeDestination.value;
  if (!destination) return;
  const next = Array.from(shortcuts.value);
  while (next.length <= slot) next.push(null);
  next[slot] = requestFor(destination);
  shortcuts.value = await props.host.saveShortcuts(next.slice(0, 9));
  problem.value = `${destination.name} is now shortcut ${slot + 1}.`;
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.visible) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    active.value = (active.value + direction + results.value.length) % results.value.length;
    return;
  }
  if (event.key === "Enter" && activeDestination.value) {
    event.preventDefault();
    void travel(requestFor(activeDestination.value));
    return;
  }
  if (/^[1-9]$/u.test(event.key) && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void assignShortcut(Number(event.key) - 1);
    return;
  }
  if (/^[1-9]$/u.test(event.key) && query.value === "" && !event.metaKey && !event.ctrlKey) {
    const shortcut = shortcuts.value[Number(event.key) - 1];
    if (shortcut) {
      event.preventDefault();
      void travel(shortcut);
    }
  }
}

onMounted(() => {
  void props.host.loadShortcuts()
    .then((loaded) => { shortcuts.value = loaded; })
    .catch((cause: unknown) => {
      problem.value = cause instanceof Error ? cause.message : "Shortcuts could not be loaded.";
    });
});
onBeforeUnmount(() => {
  window.clearTimeout(timeout);
});
</script>

<template>
  <section
    v-show="visible"
    class="ui-frame travel-palette"
    role="dialog"
    aria-modal="true"
    aria-label="Travel"
    @keydown="onKeydown"
  >
    <label class="travel-search">
      <span aria-hidden="true">⌕</span>
      <span class="ui-sr-only">Search destinations</span>
      <input
        ref="input"
        v-model="query"
        role="combobox"
        aria-controls="travel-results"
        :aria-activedescendant="activeDestination ? `travel-${activeDestination.mapId}` : undefined"
        :aria-expanded="results.length > 0"
        autocomplete="off"
        spellcheck="false"
        placeholder="Travel to an outpost…"
      >
      <kbd class="ui-kbd">esc</kbd>
    </label>

    <div class="travel-options">
      <label>
        <span class="ui-sr-only">District</span>
        <select v-model="district">
          <option v-for="value in TRAVEL_DISTRICTS" :key="value.id" :value="value.id">
            {{ value.label }}
          </option>
        </select>
      </label>
      <label class="travel-district-number">
        <span>District</span>
        <input v-model.number="districtNumber" type="number" min="0" max="255" inputmode="numeric">
      </label>
    </div>

    <div v-if="!query && shortcutRows.length" class="travel-shortcuts" aria-label="Quick Travel">
      <button
        v-for="row in shortcutRows"
        :key="row.index"
        type="button"
        :disabled="busyMapId !== null || host.unavailable !== null"
        @click="travel(row.request)"
      >
        <kbd>{{ row.index + 1 }}</kbd>
        <span>{{ row.destination.name }}</span>
      </button>
    </div>

    <div id="travel-results" class="travel-results" role="listbox">
      <button
        v-for="(destination, index) in results"
        :id="`travel-${destination.mapId}`"
        :key="destination.mapId"
        type="button"
        role="option"
        :aria-selected="index === active"
        :disabled="busyMapId !== null || host.unavailable !== null"
        @mouseenter="active = index"
        @click="travel(requestFor(destination))"
      >
        <span>
          <strong>{{ destination.name }}</strong>
          <small>{{ destination.campaign }}</small>
        </span>
        <span v-if="busyMapId === destination.mapId" class="travel-progress">Travelling…</span>
        <kbd v-else-if="index === active">↵</kbd>
      </button>
      <p v-if="!results.length" class="travel-empty">No matching destination.</p>
    </div>

    <footer class="travel-footer">
      <span :data-problem="problem ? '' : undefined" role="status">{{ problem || host.unavailable || "↑↓ choose · ⌘1–9 sets the selected shortcut" }}</span>
      <span><kbd>1–9</kbd> Quick Travel</span>
    </footer>
  </section>
</template>
