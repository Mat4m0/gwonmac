<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  TRAVEL_SEARCH_QUERY_LIMIT,
  TRAVEL_SHORTCUT_LIMIT,
  highlightTravelDestinationName,
  isTravelRequest,
  normaliseTravelTerm,
  searchTravelDestinations,
  travelDestination,
  type TravelDestination,
  type TravelRequest,
} from "../../../../src/shared/travel";
import type { TravelHost } from "../travel-host";
import { useTravelPreferences } from "../travel-preferences";
import TravelDestinationPicker from "./TravelDestinationPicker.vue";
import { isTravelMapUnlocked } from "../../../../src/shared/travel-command";
import { TRAVEL_HISTORY_VISIBLE_LIMIT } from "../../../../src/shared/travel-history";

const props = defineProps<{ host: TravelHost; visible: boolean }>();
const emit = defineEmits<{ close: [] }>();
type PaletteMode = "travel" | "customize";
const COMPACT_FAVORITE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "Ascalon City": "Ascalon",
  "Kaineng Center": "Kaineng",
  "Eye of the North": "Eye",
  "Embark Beach": "Embark",
});

const palette = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const travelTab = ref<HTMLButtonElement | null>(null);
const customizeTab = ref<HTMLButtonElement | null>(null);
const query = ref("");
const active = ref(0);
const mode = ref<PaletteMode>("travel");
const editingShortcutSlot = ref<number | null>(null);
const addingPhrase = ref(false);
const newPhraseTerm = ref("");
const newPhraseMapId = ref<number | null>(null);
const phraseError = ref("");
const feedback = ref("");
const feedbackLevel = ref<"info" | "success" | "warning" | "danger">("info");
const historyPending = ref(false);
const historyAvailable = ref(true);
const travelPreferences = useTravelPreferences(props.host);
const {
  shortcuts,
  synonyms,
  pending: preferenceWritePending,
  disabled: preferenceControlsDisabled,
} = travelPreferences;
let closeTimer = 0;
let visibilityLoad = 0;

const hasQuery = computed(() => normaliseTravelTerm(query.value).length > 0);
const travelPending = computed(() => props.host.attempt.value.status !== "idle");
const catalogueResults = computed(() => hasQuery.value
  ? searchTravelDestinations(query.value, synonyms.value)
  : []
);
const results = computed(() => catalogueResults.value.filter(
  (destination) => isTravelMapUnlocked(props.host.state.value, destination.mapId) === true,
));
const unlockStatusObserved = computed(() =>
  props.host.state.value.status === "ready"
  && props.host.state.value.unlockedMapWords !== null
);
const matchingDestinationsLocked = computed(() =>
  unlockStatusObserved.value
  && catalogueResults.value.length > 0
  && results.value.length === 0
);
const unlocked = (mapId: number) =>
  isTravelMapUnlocked(props.host.state.value, mapId) === true;
const shortcutRows = computed(() => Array.from({ length: TRAVEL_SHORTCUT_LIMIT }, (_, index) => {
  const request = shortcuts.value[index] ?? null;
  return { index, request, destination: request === null ? null : travelDestination(request.mapId) };
}));
const travelShortcutRows = computed(() => shortcutRows.value.map((row) =>
  row.request !== null && unlocked(row.request.mapId)
    ? row
    : { index: row.index, request: null, destination: null }
));
const currentMapId = computed(() =>
  props.host.state.value.status === "ready" ? props.host.state.value.mapId : null
);
const recentDestinations = computed(() => props.host.history.value
  .filter((mapId) => mapId !== currentMapId.value && unlocked(mapId))
  .map((mapId) => travelDestination(mapId))
  .filter((destination): destination is TravelDestination => destination !== null)
  .slice(0, TRAVEL_HISTORY_VISIBLE_LIMIT)
);
const backDestination = computed(() => recentDestinations.value[0] ?? null);
const additionalRecentDestinations = computed(() => recentDestinations.value.slice(1));
const activeDestination = computed(() => results.value[active.value] ?? null);
const statusText = computed(() => feedback.value || props.host.unavailable || "");
const statusLevel = computed(() => feedback.value
  ? feedbackLevel.value
  : props.host.unavailable === null ? undefined : "warning"
);
const urgentNoticeVisible = computed(() => statusLevel.value === "warning" || statusLevel.value === "danger");

function setFeedback(message: string, level: typeof feedbackLevel.value): void {
  feedback.value = message;
  feedbackLevel.value = level;
}

function inputValue(event: Event): string {
  return event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : "";
}

function queryMatchLabel(destination: TravelDestination): string {
  const normalized = normaliseTravelTerm(query.value);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return destination.campaign;
  return synonyms.value.some((entry) =>
    entry.mapId === destination.mapId
    && tokens.every((token) => normaliseTravelTerm(entry.term).includes(token))
  ) ? "Search phrase" : destination.campaign;
}

function favoriteLabel(destination: TravelDestination): string {
  const compact = COMPACT_FAVORITE_LABELS[destination.name];
  if (compact !== undefined) return compact;
  return destination.name.split(",", 1)[0] ?? destination.name;
}

watch(query, () => {
  active.value = 0;
  if (hasQuery.value) mode.value = "travel";
});
watch(results, (next) => {
  props.host.traceSearch(query.value, next.map((destination) => destination.mapId));
});
watch(() => props.visible, async (visible) => {
  if (!visible) return;
  const load = ++visibilityLoad;
  query.value = "";
  active.value = 0;
  mode.value = "travel";
  editingShortcutSlot.value = null;
  addingPhrase.value = false;
  feedback.value = "";
  phraseError.value = "";
  try {
    if (!await travelPreferences.load() || load !== visibilityLoad) return;
  } catch {
    setFeedback("Travel preferences could not be loaded. Reopen Travel to try again.", "danger");
  }
  historyPending.value = true;
  try {
    await props.host.loadHistory();
    historyAvailable.value = true;
  } catch {
    historyAvailable.value = false;
    if (!feedback.value) {
      setFeedback("Recent destinations could not be loaded. Travel and Favorites still work.", "warning");
    }
  } finally {
    historyPending.value = false;
  }
  await nextTick();
  input.value?.focus({ preventScroll: true });
}, { immediate: true, flush: "post" });

watch(() => props.host.notice.value, (notice) => {
  if (!notice) return;
  setFeedback(notice.message, notice.level);
});
watch(() => props.host.attempt.value.status, (status) => {
  if (status !== "loading") return;
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => emit("close"), 350);
});

async function selectMode(next: PaletteMode, focus: "search" | "tab" = "search"): Promise<void> {
  query.value = "";
  active.value = 0;
  mode.value = next;
  await nextTick();
  if (focus === "tab") {
    (next === "travel" ? travelTab.value : customizeTab.value)?.focus();
  } else if (next === "travel") {
    input.value?.focus();
  }
}

function onModeKeydown(event: KeyboardEvent): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const next: PaletteMode = event.key === "ArrowLeft" || event.key === "Home"
    ? "travel"
    : "customize";
  event.preventDefault();
  if (next === "customize" && preferenceControlsDisabled.value) return;
  void selectMode(next, "tab");
}

async function travel(request: TravelRequest): Promise<void> {
  if (travelPending.value || !isTravelRequest(request)) return;
  try {
    await props.host.travel(request);
  } catch { /* The host owns the refusal notice and resets its transaction. */ }
}

function activateFavorite(row: { readonly index: number; readonly request: TravelRequest | null }): void {
  if (row.request !== null) {
    void travel(row.request);
    return;
  }
  void openShortcutManager(row.index);
}

async function saveShortcut(slot: number, destination: TravelDestination): Promise<void> {
  try {
    if (!await travelPreferences.assignShortcut(slot, destination)) return;
    setFeedback(`${destination.name} is now shortcut ${slot + 1}.`, "success");
  } catch {
    setFeedback("Shortcut could not be saved. Reopen Travel to confirm the active shortcut.", "danger");
  }
}

async function removeShortcut(slot: number): Promise<void> {
  try {
    if (!await travelPreferences.removeShortcut(slot)) return;
    setFeedback(`Shortcut ${slot + 1} removed.`, "success");
  } catch {
    setFeedback("Shortcut could not be removed. Reopen Travel to confirm the active shortcut.", "danger");
  }
}

async function assignShortcut(slot: number, mapId: number | null): Promise<void> {
  if (mapId === null) {
    await removeShortcut(slot);
    return;
  }
  const destination = travelDestination(mapId);
  if (destination !== null) await saveShortcut(slot, destination);
}

async function assignEditingShortcut(mapId: number | null): Promise<void> {
  if (editingShortcutSlot.value !== null) await assignShortcut(editingShortcutSlot.value, mapId);
}

async function openShortcutManager(slot?: number): Promise<void> {
  if (preferenceControlsDisabled.value) return;
  await selectMode("customize");
  editingShortcutSlot.value = slot ?? null;
  await nextTick();
  if (slot !== undefined) {
    palette.value?.querySelector<HTMLElement>(".travel-shortcut-editor summary")?.focus();
    setFeedback(`Choose a destination for shortcut ${slot + 1}.`, "info");
  }
}

async function beginAddPhrase(): Promise<void> {
  addingPhrase.value = true;
  phraseError.value = "";
  newPhraseTerm.value = "";
  newPhraseMapId.value = null;
  await nextTick();
  palette.value?.querySelector<HTMLInputElement>("#travel-new-phrase")?.focus();
}

function cancelAddPhrase(): void {
  addingPhrase.value = false;
  phraseError.value = "";
  newPhraseTerm.value = "";
  newPhraseMapId.value = null;
}

function phraseOutcomeMessage(outcome: "limit" | "invalid" | "unverified" | "busy"): string {
  if (outcome === "limit") return "You can save up to 64 search phrases.";
  if (outcome === "unverified") return "GWonMac did not confirm that phrase was saved. Restart the app, then try again.";
  if (outcome === "busy") return "Wait for the current preference change, then try again.";
  return "Use a unique phrase of 1–40 characters that does not name another destination.";
}

async function addPhrase(): Promise<void> {
  const destination = newPhraseMapId.value === null ? null : travelDestination(newPhraseMapId.value);
  if (destination === null) {
    phraseError.value = "Choose a destination.";
    return;
  }
  const term = newPhraseTerm.value.trim();
  try {
    const outcome = await travelPreferences.addSynonym(term, destination);
    if (outcome !== "saved") {
      phraseError.value = phraseOutcomeMessage(outcome);
      return;
    }
    phraseError.value = "";
    newPhraseTerm.value = "";
    newPhraseMapId.value = null;
    addingPhrase.value = false;
    setFeedback(`“${term}” now finds ${destination.name}. Search was verified.`, "success");
    query.value = term;
    mode.value = "travel";
    await nextTick();
    input.value?.focus();
  } catch {
    phraseError.value = "The search phrase could not be saved. Reopen Travel to confirm your phrases.";
  }
}

async function updatePhraseTerm(index: number, event: Event): Promise<void> {
  const entry = synonyms.value[index];
  if (entry === undefined) return;
  const destination = travelDestination(entry.mapId);
  if (destination === null) return;
  const control = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : null;
  try {
    const term = inputValue(event).trim();
    const outcome = await travelPreferences.updateSynonym(index, term, destination);
    if (outcome !== "saved") {
      if (control !== null) control.value = entry.term;
      setFeedback(phraseOutcomeMessage(outcome), "warning");
      return;
    }
    setFeedback(`“${term}” was saved and verified.`, "success");
  } catch {
    if (control !== null) control.value = entry.term;
    setFeedback("The search phrase could not be changed. Reopen Travel to confirm its active value.", "danger");
  }
}

async function updatePhraseDestination(index: number, mapId: number | null): Promise<void> {
  const entry = synonyms.value[index];
  const destination = mapId === null ? null : travelDestination(mapId);
  if (entry === undefined || destination === null) return;
  try {
    const outcome = await travelPreferences.updateSynonym(index, entry.term, destination);
    if (outcome !== "saved") {
      setFeedback(phraseOutcomeMessage(outcome), "warning");
      return;
    }
    setFeedback(`“${entry.term}” now finds ${destination.name}.`, "success");
  } catch {
    setFeedback("The search phrase could not be changed. Reopen Travel to confirm its destination.", "danger");
  }
}

async function removePhrase(index: number): Promise<void> {
  const removed = synonyms.value[index];
  try {
    if (!await travelPreferences.removeSynonym(index)) return;
    setFeedback(removed === undefined ? "Search phrase removed." : `“${removed.term}” removed.`, "success");
  } catch {
    setFeedback("The search phrase could not be removed. Reopen Travel to confirm your phrases.", "danger");
  }
}

async function clearHistory(): Promise<void> {
  if (historyPending.value || props.host.history.value.length === 0) return;
  historyPending.value = true;
  try {
    await props.host.clearHistory();
    historyAvailable.value = true;
    setFeedback("Recent destinations cleared. Favorites and search phrases are unchanged.", "success");
  } catch {
    historyAvailable.value = false;
    setFeedback("Recent destinations could not be cleared. Reopen Travel to confirm them.", "danger");
  } finally {
    historyPending.value = false;
  }
}

async function moveActive(direction: 1 | -1): Promise<void> {
  if (results.value.length === 0) return;
  active.value = (active.value + direction + results.value.length) % results.value.length;
  await nextTick();
  palette.value?.querySelector<HTMLElement>(`#travel-${activeDestination.value?.mapId}`)?.scrollIntoView({ block: "nearest" });
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.visible) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (mode.value === "customize") void selectMode("travel");
    else if (hasQuery.value) {
      query.value = "";
      void nextTick(() => input.value?.focus());
    } else emit("close");
    return;
  }
  if (event.target === input.value && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    void moveActive(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.target === input.value && event.key === "Enter") {
    if (activeDestination.value !== null) {
      event.preventDefault();
      void travel({ mapId: activeDestination.value.mapId });
    }
    return;
  }
  if (/^Digit[1-8]$/u.test(event.code) && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && activeDestination.value) {
    event.preventDefault();
    void saveShortcut(Number(event.code.slice(5)) - 1, activeDestination.value);
    return;
  }
  if (/^Digit[1-8]$/u.test(event.code) && mode.value === "travel" && !hasQuery.value && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    const slot = Number(event.code.slice(5)) - 1;
    const shortcut = shortcuts.value[slot];
    if (shortcut && unlocked(shortcut.mapId)) void travel(shortcut);
    else void openShortcutManager(slot);
  }
}

onBeforeUnmount(() => window.clearTimeout(closeTimer));
</script>

<template>
  <section ref="palette" v-show="visible" class="ui-frame travel-palette" role="dialog" aria-label="Quick Travel" :aria-busy="preferenceWritePending || historyPending" @keydown="onKeydown">
    <div class="travel-search">
      <svg class="travel-search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25" /><path d="m12.4 12.4 4.1 4.1" /></svg>
      <label for="travel-search-input"><input id="travel-search-input" ref="input" v-model="query" role="combobox" aria-label="Destination or search phrase" :aria-controls="hasQuery ? 'travel-results' : undefined" aria-autocomplete="list" aria-haspopup="listbox" :aria-activedescendant="activeDestination ? `travel-${activeDestination.mapId}` : undefined" :aria-expanded="results.length > 0" autocomplete="off" spellcheck="false" :maxlength="TRAVEL_SEARCH_QUERY_LIMIT" placeholder="Search destinations or phrases…"></label>
      <button type="button" class="ui-button travel-close" data-icon aria-label="Close Quick Travel" @click="emit('close')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button>
    </div>

    <div class="ui-segment travel-mode" data-fill role="tablist" aria-label="Quick Travel mode" @keydown="onModeKeydown">
      <button id="travel-mode-tab" ref="travelTab" type="button" role="tab" :tabindex="mode === 'travel' ? 0 : -1" :aria-selected="mode === 'travel'" aria-controls="travel-panel" @click="selectMode('travel')">Travel</button>
      <button id="travel-customize-mode-tab" ref="customizeTab" type="button" role="tab" :tabindex="mode === 'customize' ? 0 : -1" :aria-selected="mode === 'customize'" aria-controls="travel-customize-panel" :disabled="preferenceControlsDisabled" @click="selectMode('customize')">Customize</button>
    </div>
    <div v-if="urgentNoticeVisible" class="travel-notice" :data-level="statusLevel" role="status" aria-live="polite">{{ statusText }}</div>

    <section v-if="hasQuery" id="travel-results-panel" class="ui-scroll travel-body" role="region" aria-label="Travel search results">
      <div v-if="results.length" class="travel-result-heading">{{ results.length === 1 ? 'Best match for' : 'Matches for' }} <strong>{{ query }}</strong></div>
      <div v-if="results.length" id="travel-results" class="travel-results" role="listbox">
        <button v-for="(destination, index) in results" :id="`travel-${destination.mapId}`" :key="destination.mapId" type="button" class="travel-result" role="option" :aria-selected="index === active" :disabled="travelPending || host.unavailable !== null" @mouseenter="active = index" @click="active = index; travel({ mapId: destination.mapId })"><span><strong><template v-for="(part, partIndex) in highlightTravelDestinationName(destination, query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></strong><small>{{ destination.campaign }}</small></span><span class="travel-match">{{ queryMatchLabel(destination) }}</span></button>
      </div>
      <div v-else class="ui-empty travel-empty"><strong>{{ !unlockStatusObserved ? 'Unlocked destinations unavailable' : matchingDestinationsLocked ? `No unlocked destinations for “${query}”` : `No destinations for “${query}”` }}</strong><p>{{ !unlockStatusObserved ? 'Wait for Guild Wars to finish loading the current character.' : matchingDestinationsLocked ? 'This character has not unlocked the matching destinations.' : 'Try a destination, campaign, official shortcut, or your own search phrase.' }}</p><button type="button" class="ui-button" @click="query = ''">Clear search</button></div>
    </section>

    <section v-else-if="mode === 'travel'" id="travel-panel" class="ui-scroll travel-body" role="tabpanel" aria-labelledby="travel-mode-tab">
      <section v-if="backDestination" class="travel-section travel-history" aria-labelledby="travel-history-title">
        <header class="travel-section-head"><h2 id="travel-history-title">Recent</h2><span>Observed in Guild Wars</span></header>
        <div class="travel-recent-list">
          <button type="button" class="travel-back" :disabled="travelPending || host.unavailable !== null" :aria-label="`Back to ${backDestination.name}`" @click="travel({ mapId: backDestination.mapId })">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" /></svg>
            <span><small>Back</small><strong>{{ backDestination.name }}</strong></span>
          </button>
          <button v-for="destination in additionalRecentDestinations" :key="destination.mapId" type="button" class="travel-recent" :disabled="travelPending || host.unavailable !== null" :aria-label="`Travel to recent destination ${destination.name}`" @click="travel({ mapId: destination.mapId })"><span><strong>{{ destination.name }}</strong><small>{{ destination.campaign }}</small></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></button>
        </div>
      </section>
      <section class="travel-section travel-favorites" aria-labelledby="travel-favorites-title">
        <header class="travel-section-head"><h2 id="travel-favorites-title">Favorites</h2><span>Press 1–8</span></header>
        <div class="travel-favorite-grid" aria-label="Favorite destinations">
          <button v-for="row in travelShortcutRows" :key="row.index" type="button" class="ui-slot travel-favorite" :title="row.destination?.name" :data-empty="row.destination === null ? '' : undefined" :disabled="travelPending || host.unavailable !== null || (row.request === null && preferenceControlsDisabled)" :aria-label="row.destination === null ? `Assign favorite ${row.index + 1}` : `Travel to ${row.destination.name}, shortcut ${row.index + 1}`" @click="activateFavorite(row)"><span>{{ row.destination ? favoriteLabel(row.destination) : '' }}</span><b aria-hidden="true">{{ row.index + 1 }}</b></button>
        </div>
      </section>
    </section>

    <section v-else id="travel-customize-panel" class="ui-scroll travel-body travel-customize" role="tabpanel" aria-labelledby="travel-customize-mode-tab">
      <section class="travel-customize-group" aria-labelledby="travel-shortcuts-title">
        <header class="travel-section-head"><h2 id="travel-shortcuts-title">Number shortcuts</h2><span>Press 1–8</span></header>
        <div class="travel-customize-shortcuts">
          <button v-for="row in shortcutRows" :key="row.index" type="button" class="ui-slot travel-favorite" :title="row.destination?.name" :data-empty="row.destination === null" :aria-pressed="editingShortcutSlot === row.index" :aria-label="row.destination === null ? `Assign shortcut ${row.index + 1}` : `Change shortcut ${row.index + 1}, ${row.destination.name}`" :disabled="preferenceControlsDisabled" @click="editingShortcutSlot = editingShortcutSlot === row.index ? null : row.index"><span>{{ row.destination ? favoriteLabel(row.destination) : 'Assign' }}</span><b aria-hidden="true">{{ row.index + 1 }}</b></button>
        </div>
        <div v-if="editingShortcutSlot !== null" class="travel-shortcut-editor"><span>Shortcut {{ editingShortcutSlot + 1 }}</span><TravelDestinationPicker :model-value="shortcuts[editingShortcutSlot]?.mapId ?? null" :label="`Destination for shortcut ${editingShortcutSlot + 1}`" :disabled="preferenceControlsDisabled" allow-clear @update:model-value="assignEditingShortcut" /></div>
      </section>

      <section class="travel-customize-group" aria-labelledby="travel-phrases-title">
        <header class="travel-section-head"><h2 id="travel-phrases-title">Search phrases</h2><button type="button" class="ui-button" :disabled="preferenceControlsDisabled || addingPhrase" @click="beginAddPhrase">+ Add phrase</button></header>
        <div v-if="synonyms.length" class="travel-phrase-list"><div v-for="(synonym, index) in synonyms" :key="`${synonym.term}-${synonym.mapId}`" class="travel-setting-row travel-phrase-row"><label><span class="ui-sr-only">Search phrase</span><input class="ui-input" maxlength="40" :value="synonym.term" :disabled="preferenceControlsDisabled" @change="updatePhraseTerm(index, $event)"></label><TravelDestinationPicker :model-value="synonym.mapId" :label="`Destination for ${synonym.term}`" :disabled="preferenceControlsDisabled" @update:model-value="updatePhraseDestination(index, $event)" /><button type="button" class="ui-button" :disabled="preferenceControlsDisabled" :aria-label="`Remove search phrase ${synonym.term}`" @click="removePhrase(index)">Remove</button></div></div>
        <div v-else-if="!addingPhrase" class="travel-phrases-empty">No phrases saved yet.</div>
        <form v-if="addingPhrase" class="travel-add-phrase" @submit.prevent="addPhrase"><label><span class="ui-sr-only">New search phrase</span><input id="travel-new-phrase" v-model="newPhraseTerm" class="ui-input" maxlength="40" placeholder="Phrase, e.g. daily run" :disabled="preferenceControlsDisabled" :aria-invalid="phraseError ? 'true' : undefined" :aria-describedby="phraseError ? 'travel-phrase-error' : undefined"></label><TravelDestinationPicker v-model="newPhraseMapId" label="Destination for new search phrase" :disabled="preferenceControlsDisabled" /><span class="travel-add-phrase-actions"><button type="button" class="ui-button" :disabled="preferenceControlsDisabled" @click="cancelAddPhrase">Cancel</button><button type="submit" class="ui-button" :disabled="preferenceControlsDisabled || !newPhraseTerm.trim() || newPhraseMapId === null">Save</button></span></form>
        <p v-if="phraseError" id="travel-phrase-error" class="ui-field-error travel-phrase-error">{{ phraseError }}</p>
      </section>

      <section class="travel-customize-group travel-history-settings" aria-labelledby="travel-history-settings-title">
        <span><strong id="travel-history-settings-title">Recent destinations</strong><small v-if="historyAvailable">{{ host.history.value.length ? `${host.history.value.length} locally stored` : 'No destinations stored yet' }}</small><small v-else>History is unavailable</small></span>
        <button type="button" class="ui-button" :disabled="historyPending || host.history.value.length === 0" @click="clearHistory">Clear history</button>
      </section>
    </section>
    <footer class="travel-footer"><span v-if="statusText && !urgentNoticeVisible" :data-level="statusLevel" role="status" aria-live="polite">{{ statusText }}</span><span v-if="mode === 'travel' || hasQuery" class="travel-key-hints"><kbd class="ui-kbd">↑↓</kbd> choose <kbd class="ui-kbd">return</kbd> travel <kbd class="ui-kbd">⌘1–8</kbd> save</span><span v-else class="travel-key-hints"><kbd class="ui-kbd">esc</kbd> back</span></footer>
  </section>
</template>
