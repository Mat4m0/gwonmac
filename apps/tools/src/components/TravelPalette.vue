<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  TRAVEL_DESTINATIONS,
  TRAVEL_SEARCH_QUERY_LIMIT,
  TRAVEL_SHORTCUT_LIMIT,
  highlightTravelDestinationName,
  isTravelRequest,
  searchTravelDestinations,
  travelDestination,
  type TravelDestination,
  type TravelRequest,
} from "../../../../src/shared/travel";
import type { TravelHost } from "../travel-host";
import { useTravelPreferences } from "../travel-preferences";

const props = defineProps<{ host: TravelHost; visible: boolean }>();
const emit = defineEmits<{ close: [] }>();
type PaletteMode = Readonly<{ type: "browse" | "synonyms" }>
  | Readonly<{ type: "assign"; slot: number }>;

const palette = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const synonymDone = ref<HTMLButtonElement | null>(null);
const query = ref("");
const active = ref(0);
const travelPreferences = useTravelPreferences(props.host);
const {
  shortcuts,
  synonyms,
  recentLimit,
  recentMapIds,
  pending: preferenceWritePending,
  disabled: preferenceControlsDisabled,
} = travelPreferences;
const mode = ref<PaletteMode>({ type: "browse" });
const editingShortcuts = ref(false);
const synonymTerm = ref("");
const feedback = ref("");
const feedbackLevel = ref<"info" | "success" | "warning" | "danger">("info");
let closeTimer = 0;
let visibilityLoad = 0;

const hasQuery = computed(() => query.value.trim().length > 0);
const assignmentSlot = computed(() => mode.value.type === "assign" ? mode.value.slot : null);
const managingSynonyms = computed(() => mode.value.type === "synonyms");
const travelPending = computed(() => props.host.attempt.value.status !== "idle");
const busyMapId = computed(() =>
  props.host.attempt.value.status === "idle" ? null : props.host.attempt.value.mapId
);
const results = computed(() => hasQuery.value
  ? searchTravelDestinations(query.value, synonyms.value)
  : []
);
const shortcutRows = computed(() => Array.from({ length: TRAVEL_SHORTCUT_LIMIT }, (_, index) => {
  const request = shortcuts.value[index] ?? null;
  return { index, request, destination: request === null ? null : travelDestination(request.mapId) };
}));
const recentRows = computed(() => recentMapIds.value
  .slice(0, recentLimit.value)
  .map((mapId) => travelDestination(mapId))
  .filter((destination): destination is TravelDestination => destination !== null)
);
const activeDestination = computed(() => results.value[active.value] ?? null);
const statusText = computed(() => feedback.value || props.host.unavailable || (
  hasQuery.value ? "Arrow keys choose · Return travels · ⌘1–9 saves" : "Press 1–9 to travel"
));
const statusLevel = computed(() => feedback.value
  ? feedbackLevel.value
  : props.host.unavailable === null ? undefined : "warning"
);

watch(query, () => { active.value = 0; });
watch(results, (next) => {
  props.host.traceSearch(query.value, next.map((destination) => destination.mapId));
});
watch(() => props.visible, async (visible) => {
  if (!visible) return;
  const load = ++visibilityLoad;
  query.value = "";
  active.value = 0;
  mode.value = { type: "browse" };
  editingShortcuts.value = false;
  feedback.value = "";
  try {
    if (!await travelPreferences.load() || load !== visibilityLoad) return;
  } catch {
    feedback.value = "Travel preferences could not be loaded. Reopen Travel to try again.";
    feedbackLevel.value = "danger";
  }
  await nextTick();
  input.value?.focus({ preventScroll: true });
}, { immediate: true, flush: "post" });

watch(() => props.host.notice.value, (notice) => {
  if (!notice) return;
  feedback.value = notice.message;
  feedbackLevel.value = notice.level;
});
watch(() => props.host.attempt.value.status, (status) => {
  if (status !== "loading") return;
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => emit("close"), 350);
});

async function travel(request: TravelRequest): Promise<void> {
  if (travelPending.value || !isTravelRequest(request)) return;
  try {
    await props.host.travel(request);
  } catch { /* The host owns the refusal notice and resets its transaction. */ }
}

async function saveShortcut(slot: number, destination: TravelDestination): Promise<void> {
  try {
    if (!await travelPreferences.assignShortcut(slot, destination)) return;
    mode.value = { type: "browse" };
    editingShortcuts.value = false;
    feedback.value = `${destination.name} is now shortcut ${slot + 1}.`;
    feedbackLevel.value = "success";
  } catch {
    feedback.value = "Shortcut could not be saved. Your previous shortcut is still active.";
    feedbackLevel.value = "danger";
  }
}

async function removeShortcut(slot: number): Promise<void> {
  try {
    if (!await travelPreferences.removeShortcut(slot)) return;
    feedback.value = `Shortcut ${slot + 1} removed.`;
    feedbackLevel.value = "success";
  } catch {
    feedback.value = "Shortcut could not be removed. Your previous shortcut is still active.";
    feedbackLevel.value = "danger";
  }
}

async function beginAssignment(slot: number): Promise<void> {
  if (preferenceControlsDisabled.value) return;
  mode.value = { type: "assign", slot };
  query.value = "";
  feedback.value = `Search for a destination to assign to shortcut ${slot + 1}.`;
  await nextTick();
  input.value?.focus();
}

async function addSynonym(): Promise<void> {
  const destination = activeDestination.value;
  if (destination === null) return;
  const term = synonymTerm.value.trim();
  try {
    const outcome = await travelPreferences.addSynonym(term, destination);
    if (outcome === "limit" || outcome === "invalid") {
      feedback.value = outcome === "limit"
        ? "You can save up to 64 synonyms."
        : "Use a unique term of 1–40 characters that does not name another destination.";
      feedbackLevel.value = "warning";
      return;
    }
    if (outcome !== "saved") return;
    synonymTerm.value = "";
    feedback.value = `“${term}” now finds ${destination.name}.`;
    feedbackLevel.value = "success";
  } catch {
    feedback.value = "Synonym could not be saved. Your previous synonyms are unchanged.";
    feedbackLevel.value = "danger";
  }
}

async function removeSynonym(index: number): Promise<void> {
  try {
    if (!await travelPreferences.removeSynonym(index)) return;
    feedback.value = "Synonym removed.";
    feedbackLevel.value = "success";
  } catch {
    feedback.value = "Synonym could not be removed. Your previous synonyms are unchanged.";
    feedbackLevel.value = "danger";
  }
}

async function openSynonymManager(): Promise<void> {
  if (preferenceControlsDisabled.value) return;
  mode.value = { type: "synonyms" };
  await nextTick();
  synonymDone.value?.focus();
}

async function returnToBrowse(): Promise<void> {
  mode.value = { type: "browse" };
  query.value = "";
  await nextTick();
  input.value?.focus();
}

async function moveActive(direction: 1 | -1): Promise<void> {
  if (results.value.length === 0) return;
  active.value = (active.value + direction + results.value.length) % results.value.length;
  await nextTick();
  palette.value?.querySelector<HTMLElement>(`#travel-${activeDestination.value?.mapId}`)
    ?.scrollIntoView({ block: "nearest" });
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.visible) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (managingSynonyms.value || assignmentSlot.value !== null) void returnToBrowse();
    else if (editingShortcuts.value) editingShortcuts.value = false;
    else emit("close");
    return;
  }
  if (managingSynonyms.value) return;
  if (event.target === input.value && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    void moveActive(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.target === input.value && event.key === "Enter" && activeDestination.value) {
    event.preventDefault();
    if (assignmentSlot.value === null) void travel({ mapId: activeDestination.value.mapId });
    else void saveShortcut(assignmentSlot.value, activeDestination.value);
    return;
  }
  if (
    /^Digit[1-9]$/u.test(event.code)
    && event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && activeDestination.value
  ) {
    event.preventDefault();
    void saveShortcut(Number(event.code.slice(5)) - 1, activeDestination.value);
    return;
  }
  if (
    /^Digit[1-9]$/u.test(event.code)
    && !hasQuery.value
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
  ) {
    event.preventDefault();
    const slot = Number(event.code.slice(5)) - 1;
    const shortcut = shortcuts.value[slot];
    if (shortcut && !editingShortcuts.value) void travel(shortcut);
    else void beginAssignment(slot);
  }
}

onBeforeUnmount(() => window.clearTimeout(closeTimer));
</script>

<template>
  <section ref="palette" v-show="visible" class="ui-frame travel-palette" role="dialog" aria-label="Travel" :aria-busy="preferenceWritePending" @keydown="onKeydown">
    <div class="ui-input-group travel-search">
      <svg class="travel-search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25" /><path d="m12.4 12.4 4.1 4.1" /></svg>
      <label class="ui-sr-only" for="travel-search-input">Search destinations</label>
      <input
        id="travel-search-input"
        ref="input"
        v-model="query"
        role="combobox"
        :aria-controls="hasQuery ? 'travel-results' : undefined"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :disabled="managingSynonyms"
        :aria-activedescendant="activeDestination ? `travel-${activeDestination.mapId}` : undefined"
        :aria-expanded="results.length > 0"
        autocomplete="off"
        spellcheck="false"
        :maxlength="TRAVEL_SEARCH_QUERY_LIMIT"
        :placeholder="assignmentSlot === null ? 'Travel to an outpost…' : `Assign shortcut ${assignmentSlot + 1}…`"
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

    <div v-if="!hasQuery && !managingSynonyms" class="ui-scroll travel-home">
      <section v-if="recentRows.length" class="travel-recents" aria-labelledby="travel-recents-title">
        <header><h2 id="travel-recents-title">Recent</h2></header>
        <button v-for="destination in recentRows" :key="destination.mapId" type="button" class="ui-row" :disabled="travelPending || host.unavailable !== null" @click="travel({ mapId: destination.mapId })">
          <span>{{ destination.name }}</span><span class="travel-row-hint">Travel</span>
        </button>
      </section>

      <section class="travel-shortcuts" aria-labelledby="travel-shortcuts-title">
        <header>
          <h2 id="travel-shortcuts-title">Quick Travel</h2>
          <span class="travel-header-actions">
            <button type="button" class="ui-button" :disabled="preferenceControlsDisabled" @click="editingShortcuts = !editingShortcuts">{{ editingShortcuts ? "Done" : "Edit" }}</button>
            <button type="button" class="ui-button" :disabled="preferenceControlsDisabled" @click="openSynonymManager">Synonyms</button>
          </span>
        </header>
        <div class="travel-shortcut-grid">
          <div v-for="row in shortcutRows" :key="row.index" class="travel-shortcut-tile" :data-empty="row.destination === null">
            <button type="button" class="travel-shortcut-primary" :disabled="preferenceControlsDisabled || (!editingShortcuts && (travelPending || host.unavailable !== null))" :aria-label="row.destination ? `${editingShortcuts ? 'Replace' : 'Travel to'} ${row.destination.name}, shortcut ${row.index + 1}` : `Assign shortcut ${row.index + 1}`" @click="row.request && !editingShortcuts ? travel(row.request) : beginAssignment(row.index)">
              <kbd class="ui-kbd">{{ row.index + 1 }}</kbd>
              <span>{{ row.destination?.name ?? "Set shortcut" }}</span>
            </button>
            <button v-if="editingShortcuts && row.destination" type="button" class="travel-shortcut-remove" :disabled="preferenceControlsDisabled" :aria-label="`Remove shortcut ${row.index + 1}`" @click="removeShortcut(row.index)">×</button>
          </div>
        </div>
      </section>
      <p class="travel-search-prompt">Start typing to search all {{ TRAVEL_DESTINATIONS.length }} direct-travel destinations.</p>
    </div>

    <section v-else-if="managingSynonyms" class="ui-scroll travel-synonyms" aria-labelledby="travel-synonyms-title">
      <header><h2 id="travel-synonyms-title">Custom synonyms</h2><button ref="synonymDone" type="button" class="ui-button" @click="returnToBrowse">Done</button></header>
      <div v-for="(synonym, index) in synonyms" :key="`${synonym.term}-${synonym.mapId}`" class="ui-row">
        <span><strong>{{ synonym.term }}</strong><small>{{ travelDestination(synonym.mapId)?.name }}</small></span>
        <button type="button" class="ui-button" :disabled="preferenceControlsDisabled" :aria-label="`Remove synonym ${synonym.term}`" @click="removeSynonym(index)">Remove</button>
      </div>
      <p v-if="synonyms.length === 0" class="travel-empty">No custom synonyms yet. Search for a destination, then add one below the results.</p>
    </section>

    <section v-else class="travel-search-view">
      <div v-if="results.length" id="travel-results" class="ui-scroll travel-results" role="listbox">
        <div v-for="(destination, index) in results" :key="destination.mapId" role="presentation" class="ui-row travel-result" :data-active="index === active" @mouseenter="active = index">
          <button :id="`travel-${destination.mapId}`" type="button" class="travel-row-primary" role="option" :aria-selected="index === active" :disabled="travelPending || host.unavailable !== null" @click="assignmentSlot === null ? travel({ mapId: destination.mapId }) : saveShortcut(assignmentSlot, destination)">
            <strong><template v-for="(part, partIndex) in highlightTravelDestinationName(destination, query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></strong>
            <small>{{ destination.campaign }}</small>
          </button>
          <span v-if="busyMapId === destination.mapId" class="travel-progress">Travelling…</span><kbd v-else-if="index === active" class="ui-kbd">return</kbd>
        </div>
      </div>
      <p v-else class="travel-empty">No matching destination. Locked destinations are included, so try another name.</p>
      <section v-if="activeDestination" class="travel-result-tools" :aria-label="`Actions for ${activeDestination.name}`">
        <span class="travel-save-group"><span>Save to</span><button v-for="slot in 9" :key="slot" type="button" class="ui-button" :disabled="preferenceControlsDisabled" :aria-label="`Save ${activeDestination.name} to shortcut ${slot}`" @click="saveShortcut(slot - 1, activeDestination)">{{ slot }}</button></span>
        <span class="travel-synonym-group"><label><span>Synonym</span><input v-model="synonymTerm" class="ui-input" maxlength="40" placeholder="e.g. daily run" @keydown.enter.prevent="addSynonym"></label><button type="button" class="ui-button" :disabled="preferenceControlsDisabled || !synonymTerm.trim()" @click="addSynonym">Add</button><button type="button" class="ui-button" :disabled="preferenceControlsDisabled" @click="openSynonymManager">Manage</button></span>
      </section>
    </section>

    <footer class="travel-footer"><span :data-level="statusLevel" role="status" aria-live="polite">{{ statusText }}</span></footer>
  </section>
</template>
