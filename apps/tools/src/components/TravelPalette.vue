<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  TRAVEL_SEARCH_QUERY_LIMIT,
  TRAVEL_SHORTCUT_LIMIT,
  highlightTravelDestinationName,
  isTravelRequest,
  normaliseTravelTerm,
  searchTravelDestinations,
  travelBrowseScope,
  travelDestination,
  type TravelDestination,
  type TravelRequest,
} from "../../../../src/shared/travel";
import type { TravelHost } from "../travel-host";
import { isTravelMapUnlocked } from "../../../../src/shared/travel-command";
import { TRAVEL_HISTORY_VISIBLE_LIMIT } from "../../../../src/shared/travel-history";
import { useTravelPreferences } from "../travel-preferences";
import TravelDestinationPicker from "./TravelDestinationPicker.vue";

const props = defineProps<{ host: TravelHost; visible: boolean }>();
const emit = defineEmits<{ close: [] }>();
type PaletteMode = "travel" | "customize";
const SMALL_TRAVEL_CATALOGUE_LIMIT = 10;
const COMPACT_FAVORITE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "Ascalon City": "Ascalon",
  "Kaineng Center": "Kaineng",
  "Eye of the North": "Eye",
  "Embark Beach": "Embark",
});

const palette = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const settingsButton = ref<HTMLButtonElement | null>(null);
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
const travelPreferences = useTravelPreferences(props.host);
const {
  shortcuts,
  synonyms,
  pending: preferenceWritePending,
  disabled: preferenceControlsDisabled,
} = travelPreferences;
let visibilityLoad = 0;

const hasQuery = computed(() => normaliseTravelTerm(query.value).length > 0);
const travelPending = computed(() => props.host.attempt.value.status !== "idle");
const catalogueResults = computed(() => hasQuery.value
  ? searchTravelDestinations(query.value, synonyms.value)
  : []
);
const isAvailable = (mapId: number) =>
  isTravelMapUnlocked(props.host.state.value, mapId) !== false;
const results = computed(() => catalogueResults.value.filter(
  (destination) => isAvailable(destination.mapId),
));
const shortcutRows = computed(() => Array.from({ length: TRAVEL_SHORTCUT_LIMIT }, (_, index) => {
  const request = shortcuts.value[index] ?? null;
  return { index, request, destination: request === null ? null : travelDestination(request.mapId) };
}));
const assignedShortcuts = computed(() => shortcutRows.value.filter(
  (row) => row.destination !== null && row.request !== null && isAvailable(row.request.mapId),
));
const currentMapId = computed(() =>
  props.host.state.value.status === "ready" ? props.host.state.value.mapId : null
);
const browseUnlocksKnown = computed(() =>
  props.host.state.value.status === "ready"
  && props.host.state.value.unlockedMapWords !== null
);
const recentDestinations = computed(() => props.host.history.value
  .filter((mapId) => mapId !== currentMapId.value && isAvailable(mapId))
  .map((mapId) => travelDestination(mapId))
  .filter((destination): destination is TravelDestination => destination !== null)
  .slice(0, TRAVEL_HISTORY_VISIBLE_LIMIT));
const browseDestinations = computed(() => {
  const state = props.host.state.value;
  if (state.status !== "ready") return [];
  const destinations = travelBrowseScope(state.mapId).filter(({ mapId }) => isAvailable(mapId));
  return destinations.length <= SMALL_TRAVEL_CATALOGUE_LIMIT
    ? [...destinations].sort((left, right) => left.name.localeCompare(right.name, "en"))
    : [];
});
const browsingSmallCatalogue = computed(() => browseDestinations.value.length > 0);
const showingSmallCatalogue = computed(() =>
  browsingSmallCatalogue.value && mode.value === "travel" && !hasQuery.value
);
const selectableDestinations = computed(() => showingSmallCatalogue.value
  ? browseDestinations.value.filter(({ mapId }) => mapId !== currentMapId.value)
  : results.value);
const activeDestination = computed(() => selectableDestinations.value[active.value] ?? null);
const statusText = computed(() =>
  feedback.value
  || props.host.notice.value?.message
  || props.host.unavailable
  || ""
);
const statusLevel = computed(() => feedback.value
  ? feedbackLevel.value
  : props.host.notice.value?.level
    ?? (props.host.unavailable === null ? undefined : "warning")
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

function shortcutNumber(mapId: number): number | null {
  const row = shortcutRows.value.find(({ request }) => request?.mapId === mapId);
  return row === undefined ? null : row.index + 1;
}

function wasRecentlyVisited(mapId: number): boolean {
  return recentDestinations.value.some((destination) => destination.mapId === mapId);
}

function browseDestinationLabel(destination: TravelDestination): string {
  if (destination.mapId === currentMapId.value) {
    return `${destination.name}, current location`;
  }
  const shortcut = shortcutNumber(destination.mapId);
  const context = [
    shortcut === null ? null : `shortcut ${shortcut}`,
    wasRecentlyVisited(destination.mapId) ? "recent" : null,
  ].filter((value): value is string => value !== null);
  return `Travel to ${destination.name}${context.length === 0 ? "" : `, ${context.join(", ")}`}`;
}

function activateBrowseDestination(mapId: number): void {
  const index = selectableDestinations.value.findIndex((destination) => destination.mapId === mapId);
  if (index >= 0) active.value = index;
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
    const [preferencesLoaded] = await Promise.all([
      travelPreferences.load(),
      props.host.loadHistory(),
    ]);
    if (!preferencesLoaded || load !== visibilityLoad) return;
  } catch {
    setFeedback("Travel preferences could not be loaded. Reopen Travel to try again.", "danger");
  }
  await nextTick();
  input.value?.focus({ preventScroll: true });
}, { immediate: true, flush: "post" });

async function selectMode(next: PaletteMode, focus: "search" | "settings" = "search"): Promise<void> {
  query.value = "";
  active.value = 0;
  mode.value = next;
  await nextTick();
  if (focus === "settings") {
    settingsButton.value?.focus();
  } else if (next === "travel") {
    input.value?.focus();
  }
}

function toggleCustomize(): void {
  const next = mode.value === "customize" ? "travel" : "customize";
  void selectMode(next, next === "customize" ? "settings" : "search");
}

async function travel(request: TravelRequest): Promise<void> {
  if (travelPending.value || !isTravelRequest(request)) return;
  feedback.value = "";
  try {
    await props.host.travel(request);
    emit("close");
  } catch { /* The host owns the refusal notice and resets its transaction. */ }
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

async function moveActive(direction: 1 | -1): Promise<void> {
  if (selectableDestinations.value.length === 0) return;
  active.value = (
    active.value + direction + selectableDestinations.value.length
  ) % selectableDestinations.value.length;
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
  if (/^Digit[1-9]$/u.test(event.code) && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && activeDestination.value) {
    event.preventDefault();
    void saveShortcut(Number(event.code.slice(5)) - 1, activeDestination.value);
    return;
  }
  if (/^Digit[1-9]$/u.test(event.code) && mode.value === "travel" && !hasQuery.value && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    const slot = Number(event.code.slice(5)) - 1;
    const shortcut = shortcuts.value[slot];
    if (shortcut && isAvailable(shortcut.mapId)) void travel(shortcut);
    else void openShortcutManager(slot);
  }
}

</script>

<template>
  <section ref="palette" v-show="visible" class="ui-frame travel-palette" :aria-busy="preferenceWritePending" @keydown="onKeydown">
    <div class="travel-search">
      <label for="travel-search-input"><svg class="travel-search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25" /><path d="m12.4 12.4 4.1 4.1" /></svg><input id="travel-search-input" ref="input" v-model="query" role="combobox" aria-label="Destination or search phrase" :aria-controls="hasQuery ? 'travel-results' : showingSmallCatalogue ? 'travel-available' : undefined" aria-autocomplete="list" aria-haspopup="listbox" :aria-activedescendant="activeDestination ? `travel-${activeDestination.mapId}` : undefined" :aria-expanded="selectableDestinations.length > 0" autocomplete="off" spellcheck="false" :maxlength="TRAVEL_SEARCH_QUERY_LIMIT" placeholder="Search destinations or phrases…"></label>
    </div>

    <div v-if="urgentNoticeVisible" class="travel-notice" :data-level="statusLevel" role="status" aria-live="polite">{{ statusText }}</div>

    <section v-if="hasQuery" id="travel-results-panel" class="ui-scroll travel-body" role="region" aria-label="Travel search results">
      <div v-if="results.length" class="travel-result-heading">{{ results.length === 1 ? 'Best match for' : 'Matches for' }} <strong>{{ query }}</strong></div>
      <div v-if="results.length" id="travel-results" class="travel-results" role="listbox">
        <button v-for="(destination, index) in results" :id="`travel-${destination.mapId}`" :key="destination.mapId" type="button" class="travel-result ui-row" role="option" tabindex="-1" :aria-selected="index === active" :disabled="travelPending || host.unavailable !== null" @mouseenter="active = index" @click="active = index; travel({ mapId: destination.mapId })"><span><strong><template v-for="(part, partIndex) in highlightTravelDestinationName(destination, query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></strong><small>{{ destination.campaign }}</small></span><span class="travel-match">{{ queryMatchLabel(destination) }}</span></button>
      </div>
      <div v-else class="ui-empty travel-empty"><strong>No destinations for “{{ query }}”</strong><p>Try a destination, campaign, official shortcut, or your own search phrase.</p><button type="button" class="ui-button" @click="query = ''">Clear search</button></div>
    </section>

    <section v-else-if="mode === 'travel'" id="travel-panel" class="ui-scroll travel-body" role="region" aria-label="Travel">
      <section v-if="showingSmallCatalogue" class="travel-section travel-available" aria-labelledby="travel-available-title">
        <header class="travel-section-head"><h2 id="travel-available-title">{{ browseUnlocksKnown ? 'Available destinations' : 'Destinations' }}</h2><span>{{ browseDestinations.length }} {{ browseUnlocksKnown ? 'unlocked' : 'nearby' }}</span></header>
        <div id="travel-available" class="travel-recent-grid" role="listbox">
          <button v-for="destination in browseDestinations" :id="`travel-${destination.mapId}`" :key="destination.mapId" type="button" class="travel-recent ui-row" role="option" :data-current="destination.mapId === currentMapId || undefined" :disabled="travelPending || host.unavailable !== null || destination.mapId === currentMapId" :aria-current="destination.mapId === currentMapId ? 'location' : undefined" :aria-selected="destination.mapId === activeDestination?.mapId" :aria-label="browseDestinationLabel(destination)" @mouseenter="activateBrowseDestination(destination.mapId)" @click="travel({ mapId: destination.mapId })"><span><strong>{{ destination.name }}</strong><small>{{ destination.campaign }}</small></span><span class="travel-destination-context"><span v-if="shortcutNumber(destination.mapId) !== null" class="travel-shortcut-context" :title="`Shortcut ${shortcutNumber(destination.mapId)}`" aria-hidden="true">{{ shortcutNumber(destination.mapId) }}</span><span v-if="destination.mapId === currentMapId" class="travel-current">Current</span><span v-else-if="wasRecentlyVisited(destination.mapId)" class="travel-current">Recent</span><svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></span></button>
        </div>
      </section>
      <section v-else-if="recentDestinations.length" class="travel-section travel-history" aria-labelledby="travel-history-title">
        <header class="travel-section-head"><h2 id="travel-history-title">Recent</h2></header>
        <div class="travel-recent-grid">
          <button v-for="destination in recentDestinations" :key="destination.mapId" type="button" class="travel-recent ui-row" :disabled="travelPending || host.unavailable !== null" :aria-label="`Travel to recent destination ${destination.name}`" @click="travel({ mapId: destination.mapId })"><span><strong>{{ destination.name }}</strong><small>{{ destination.campaign }}</small></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></button>
        </div>
      </section>
      <section v-if="!showingSmallCatalogue" class="travel-section travel-favorites" aria-labelledby="travel-favorites-title">
        <header class="travel-section-head"><h2 id="travel-favorites-title">Favorites</h2><span>Press 1–9</span></header>
        <div v-if="assignedShortcuts.length" class="travel-favorite-grid">
          <button v-for="row in assignedShortcuts" :key="row.index" type="button" class="travel-favorite ui-raised" :title="row.destination?.name" :disabled="travelPending || host.unavailable !== null" :aria-label="`Travel to ${row.destination?.name}, shortcut ${row.index + 1}`" @click="row.request && travel(row.request)"><b>{{ row.index + 1 }}</b><span>{{ row.destination && favoriteLabel(row.destination) }}</span></button>
        </div>
        <div v-else class="ui-empty"><strong>No favorites yet</strong><p>Use the cog button to assign destinations to number keys.</p></div>
      </section>
    </section>

    <section v-else id="travel-customize-panel" class="ui-scroll travel-body travel-customize" role="region" aria-label="Travel settings">
      <section class="travel-customize-group" aria-labelledby="travel-shortcuts-title">
        <header class="travel-section-head"><h2 id="travel-shortcuts-title">Number shortcuts</h2><span>Press 1–9</span></header>
        <div class="travel-customize-shortcuts">
          <button v-for="row in shortcutRows" :key="row.index" type="button" class="travel-favorite ui-raised" :title="row.destination?.name" :data-empty="row.destination === null" :aria-pressed="editingShortcutSlot === row.index" :aria-label="row.destination === null ? `Assign shortcut ${row.index + 1}` : `Change shortcut ${row.index + 1}, ${row.destination.name}`" :disabled="preferenceControlsDisabled" @click="editingShortcutSlot = editingShortcutSlot === row.index ? null : row.index"><b>{{ row.index + 1 }}</b><span>{{ row.destination ? favoriteLabel(row.destination) : 'Assign' }}</span></button>
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
    </section>
    <footer class="travel-footer"><span v-if="statusText && !urgentNoticeVisible" :data-level="statusLevel" role="status" aria-live="polite">{{ statusText }}</span><span v-if="hasQuery" class="travel-key-hints"><kbd class="ui-kbd">↑↓</kbd> choose <kbd class="ui-kbd">return</kbd> travel <kbd class="ui-kbd">⌘1–9</kbd> save</span><span v-else-if="showingSmallCatalogue" class="travel-key-hints"><kbd class="ui-kbd">↑↓</kbd> choose <kbd class="ui-kbd">return</kbd> travel <kbd class="ui-kbd">⌘1–9</kbd> save</span><span v-else-if="mode === 'travel'" class="travel-key-hints"><kbd class="ui-kbd">1–9</kbd> travel</span><span v-else class="travel-key-hints"><kbd class="ui-kbd">esc</kbd> back</span></footer>
    <div class="travel-header-actions">
      <button ref="settingsButton" type="button" class="ui-button travel-close" data-icon aria-label="Customize Travel" title="Customize Travel" :aria-pressed="mode === 'customize'" aria-controls="travel-customize-panel" :disabled="preferenceControlsDisabled" @click="toggleCustomize"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg></button>
      <button type="button" class="ui-button travel-close" data-icon aria-label="Close Quick Travel" @click="emit('close')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button>
    </div>
  </section>
</template>
