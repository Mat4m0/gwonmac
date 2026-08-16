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
  isTravelRequest,
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

const palette = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const districtNumberInput = ref<HTMLInputElement | null>(null);
const query = ref("");
const active = ref(0);
const district = ref<TravelDistrictId>("international");
const districtNumber = ref<number | "">("");
const shortcuts = ref<TravelShortcuts>([]);
const feedback = ref("");
const feedbackLevel = ref<"info" | "success" | "warning" | "danger">("info");
const busyMapId = ref<number | null>(null);
let timeout = 0;

const hasQuery = computed(() => query.value.trim().length > 0);
const results = computed(() => hasQuery.value
  ? searchTravelDestinations(query.value)
  : []
);
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
const statusText = computed(() =>
  feedback.value
  || props.host.unavailable
  || (hasQuery.value
    ? "Arrow keys choose · Return travels · ⌘1–9 saves this destination"
    : "Press 1–9 for Quick Travel")
);
const statusLevel = computed(() => {
  if (feedback.value) return feedbackLevel.value;
  return props.host.unavailable === null ? undefined : "warning";
});

watch(query, () => { active.value = 0; });

watch(() => props.visible, async (visible) => {
  if (!visible) return;
  query.value = "";
  active.value = 0;
  feedback.value = "";
  busyMapId.value = null;
  window.clearTimeout(timeout);
  await nextTick();
  input.value?.focus({ preventScroll: true });
}, { immediate: true, flush: "post" });

watch(() => props.host.state.value, (state) => {
  if (busyMapId.value === null) return;
  if (
    (state.status === "waiting" && state.reason === "loading")
    || (state.status === "ready" && state.mapId === busyMapId.value)
  ) {
    window.clearTimeout(timeout);
    busyMapId.value = null;
    feedback.value = "Travel started.";
    feedbackLevel.value = "success";
    timeout = window.setTimeout(() => emit("close"), 350);
  }
});

function requestFor(destination: TravelDestination): TravelRequest {
  const requestedDistrict = typeof districtNumber.value === "number"
    && Number.isSafeInteger(districtNumber.value)
    ? districtNumber.value
    : 0;
  return {
    mapId: destination.mapId,
    district: district.value,
    districtNumber: Math.max(0, Math.min(255, requestedDistrict)),
  };
}

async function travel(request: TravelRequest): Promise<void> {
  if (busyMapId.value !== null || !isTravelRequest(request)) return;
  const destination = travelDestination(request.mapId);
  feedback.value = destination === null
    ? "Travelling…"
    : `Travelling to ${destination.name}…`;
  feedbackLevel.value = "info";
  busyMapId.value = request.mapId;
  try {
    await props.host.travel(request);
    if (busyMapId.value !== request.mapId) return;
    timeout = window.setTimeout(() => {
      busyMapId.value = null;
      feedback.value = "Travel did not start. Check that this outpost is unlocked, then try again.";
      feedbackLevel.value = "warning";
    }, 3_000);
  } catch {
    busyMapId.value = null;
    feedback.value = "Travel could not start. Check Guild Wars, then try again.";
    feedbackLevel.value = "danger";
  }
}

async function assignShortcut(slot: number): Promise<void> {
  const destination = activeDestination.value;
  if (!destination) return;
  const previous = shortcuts.value;
  const next = Array.from(shortcuts.value);
  while (next.length <= slot) next.push(null);
  next[slot] = requestFor(destination);
  try {
    shortcuts.value = await props.host.saveShortcuts(next.slice(0, 9));
    feedback.value = `${destination.name} is now shortcut ${slot + 1}.`;
    feedbackLevel.value = "success";
  } catch {
    shortcuts.value = previous;
    feedback.value = "Shortcut could not be saved. Your previous shortcut is still active.";
    feedbackLevel.value = "danger";
  }
}

async function moveActive(direction: 1 | -1): Promise<void> {
  if (results.value.length === 0) return;
  active.value = (active.value + direction + results.value.length) % results.value.length;
  await nextTick();
  palette.value
    ?.querySelector<HTMLElement>(`#travel-${activeDestination.value?.mapId}`)
    ?.scrollIntoView({ block: "nearest" });
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.visible) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  const isSearchInput = event.target === input.value;
  if (isSearchInput && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    void moveActive(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (isSearchInput && event.key === "Enter" && activeDestination.value) {
    event.preventDefault();
    void travel(requestFor(activeDestination.value));
    return;
  }
  if (
    /^Digit[1-9]$/u.test(event.code)
    && event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
  ) {
    event.preventDefault();
    void assignShortcut(Number(event.code.slice(5)) - 1);
    return;
  }
  if (
    /^[1-9]$/u.test(event.key)
    && query.value.trim() === ""
    && !event.metaKey
    && !event.ctrlKey
    && event.target !== districtNumberInput.value
  ) {
    event.preventDefault();
    const shortcut = shortcuts.value[Number(event.key) - 1];
    if (shortcut) {
      void travel(shortcut);
    } else {
      feedback.value = `Quick Travel ${event.key} is not set.`;
      feedbackLevel.value = "warning";
    }
  }
}

onMounted(() => {
  void props.host.loadShortcuts()
    .then((loaded) => { shortcuts.value = loaded; })
    .catch(() => {
      feedback.value = "Shortcuts could not be loaded. Reopen Travel to try again.";
      feedbackLevel.value = "danger";
    });
});
onBeforeUnmount(() => {
  window.clearTimeout(timeout);
});
</script>

<template>
  <section
    ref="palette"
    v-show="visible"
    class="ui-frame travel-palette"
    role="dialog"
    aria-label="Travel"
    @keydown="onKeydown"
  >
    <div class="ui-input-group travel-search">
      <svg class="travel-search-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.25" />
        <path d="m12.4 12.4 4.1 4.1" />
      </svg>
      <label class="ui-sr-only" for="travel-search-input">Search destinations</label>
      <input
        id="travel-search-input"
        ref="input"
        v-model="query"
        role="combobox"
        :aria-controls="hasQuery ? 'travel-results' : undefined"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-activedescendant="activeDestination ? `travel-${activeDestination.mapId}` : undefined"
        :aria-expanded="results.length > 0"
        autocomplete="off"
        spellcheck="false"
        placeholder="Travel to an outpost…"
      >
      <button
        type="button"
        class="ui-button travel-close"
        data-icon
        aria-label="Close Travel"
        @click="emit('close')"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m3 3 10 10M13 3 3 13" />
        </svg>
      </button>
    </div>

    <div class="travel-options">
      <span class="travel-options-label">District</span>
      <label class="travel-district-region">
        <span class="ui-sr-only">District region</span>
        <select v-model="district" class="ui-select">
          <option v-for="value in TRAVEL_DISTRICTS" :key="value.id" :value="value.id">
            {{ value.label }}
          </option>
        </select>
      </label>
      <label class="travel-district-number">
        <span class="ui-sr-only">District number</span>
        <input
          ref="districtNumberInput"
          v-model.number="districtNumber"
          class="ui-input"
          type="number"
          min="1"
          max="255"
          inputmode="numeric"
          placeholder="Any"
          title="Leave blank for any district"
        >
      </label>
    </div>

    <section
      v-if="!hasQuery && shortcutRows.length"
      class="travel-shortcuts"
      aria-labelledby="travel-shortcuts-title"
    >
      <header>
        <h2 id="travel-shortcuts-title">Quick Travel</h2>
      </header>
      <button
        v-for="row in shortcutRows"
        :key="row.index"
        type="button"
        class="ui-row"
        :aria-disabled="busyMapId !== null || host.unavailable !== null"
        :disabled="busyMapId !== null || host.unavailable !== null"
        @click="travel(row.request)"
      >
        <kbd class="ui-kbd">{{ row.index + 1 }}</kbd>
        <span>{{ row.destination.name }}</span>
      </button>
    </section>

    <p v-if="!hasQuery" class="travel-search-prompt">
      Start typing to search all outposts.
    </p>

    <div
      v-if="hasQuery"
      id="travel-results"
      class="ui-scroll travel-results"
      role="listbox"
    >
      <button
        v-for="(destination, index) in results"
        :id="`travel-${destination.mapId}`"
        :key="destination.mapId"
        type="button"
        class="ui-row"
        role="option"
        tabindex="-1"
        :aria-selected="index === active"
        :aria-disabled="busyMapId !== null || host.unavailable !== null"
        :disabled="busyMapId !== null || host.unavailable !== null"
        @mouseenter="active = index"
        @click="travel(requestFor(destination))"
      >
        <span>
          <strong>{{ destination.name }}</strong>
          <small>{{ destination.campaign }}</small>
        </span>
        <span v-if="busyMapId === destination.mapId" class="travel-progress">Travelling…</span>
        <kbd v-else-if="index === active" class="ui-kbd">return</kbd>
      </button>
      <p v-if="!results.length" class="travel-empty">No matching destination.</p>
    </div>

    <footer class="travel-footer">
      <span :data-level="statusLevel" role="status" aria-live="polite">{{ statusText }}</span>
    </footer>
  </section>
</template>
