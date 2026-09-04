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
import type { TravelFriend } from "../../../../src/shared/friends";
import {
  travelContextRefusal,
  travelDestinationAvailability,
} from "../../../../src/shared/travel-command";
import { TRAVEL_HISTORY_VISIBLE_LIMIT } from "../../../../src/shared/travel-history";
import { guildWarsMapName } from "../../../../src/shared/guild-wars-map-names";
import { useTravelPreferences } from "../travel-preferences";
import TravelDestinationPicker from "./TravelDestinationPicker.vue";

const props = defineProps<{
  host: TravelHost;
  visible: boolean;
  nativeDialog?: boolean;
}>();
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
type DestinationSearchResult = Readonly<{
  kind: "destination";
  resultKey: string;
  mapId: number;
  destination: TravelDestination;
  friend: null;
  disabledReason: null;
}>;
type FriendSearchResult = Readonly<{
  kind: "friend";
  resultKey: string;
  generation: number;
  mapId: number;
  destination: TravelDestination | null;
  location: string;
  friend: TravelFriend;
  disabledReason: string | null;
}>;
type GuildHallSearchResult = Readonly<{
  kind: "guild-hall";
  resultKey: "guild-hall";
  mapId: 0;
  destination: null;
  friend: null;
  disabledReason: string | null;
}>;
type SearchResult = DestinationSearchResult | FriendSearchResult | GuildHallSearchResult;
const catalogueResults = computed(() => hasQuery.value
  ? searchTravelDestinations(query.value, synonyms.value)
  : []
);
const availability = (mapId: number) =>
  travelDestinationAvailability(props.host.state.value, mapId);
const isAvailable = (mapId: number) => {
  const result = availability(mapId);
  return result === "available" || result === "unknown";
};
const currentMapId = computed(() =>
  props.host.state.value.status === "ready" ? props.host.state.value.mapId : null
);
function friendDisabledReason(friend: TravelFriend, destination: TravelDestination | null): string | null {
  if (friend.status === "offline") return "Offline";
  if (friend.status === "unknown") return "Status unavailable";
  if (destination === null) return "Unavailable for travel";
  const result = availability(friend.mapId);
  if (result === "locked") return "Locked";
  if (result === "outside-context") return "Unavailable here";
  if (friend.mapId === currentMapId.value) return "Current location";
  return null;
}
const friendResults = computed<FriendSearchResult[]>(() => {
  const observed = props.host.friends.value;
  if (!hasQuery.value || observed.status !== "ready") return [];
  const tokens = normaliseTravelTerm(query.value).split(" ").filter(Boolean);
  return observed.friends.flatMap((friend) => {
    const names = normaliseTravelTerm(`${friend.alias} ${friend.character}`);
    if (!tokens.every((token) => names.includes(token))) return [];
    const destination = travelDestination(friend.mapId);
    return [{
      kind: "friend",
      resultKey: `friend-${friend.key}`,
      generation: observed.generation,
      mapId: friend.mapId,
      destination,
      location: destination?.name ?? guildWarsMapName(friend.mapId),
      friend,
      disabledReason: friendDisabledReason(friend, destination),
    }];
  });
});
const guildHallResults = computed<GuildHallSearchResult[]>(() => {
  if (!hasQuery.value) return [];
  const tokens = normaliseTravelTerm(query.value).split(" ").filter(Boolean);
  if (!tokens.every((token) => "guild hall gh".includes(token))) return [];
  const state = props.host.state.value;
  const disabledReason = props.host.guildHallUnavailable
    ?? (state.status !== "ready"
    ? "Unavailable right now"
    : state.guildHall || state.hasGuildHall ? null : "No Guild Hall");
  return [{
    kind: "guild-hall",
    resultKey: "guild-hall",
    mapId: 0,
    destination: null,
    friend: null,
    disabledReason,
  }];
});
const results = computed<SearchResult[]>(() => {
  const friendMaps = new Set(friendResults.value
    .filter(({ disabledReason }) => disabledReason === null)
    .map(({ mapId }) => mapId));
  return [
    ...guildHallResults.value,
    ...friendResults.value,
    ...catalogueResults.value
      .filter((destination) => isAvailable(destination.mapId) && !friendMaps.has(destination.mapId))
      .map((destination): DestinationSearchResult => ({
        kind: "destination",
        resultKey: `map-${destination.mapId}`,
        mapId: destination.mapId,
        destination,
        friend: null,
        disabledReason: null,
      })),
  ];
});
const contextExcludedResults = computed(() => catalogueResults.value.filter(
  (destination) => availability(destination.mapId) === "outside-context",
));
const shortcutRows = computed(() => Array.from({ length: TRAVEL_SHORTCUT_LIMIT }, (_, index) => {
  const request = shortcuts.value[index] ?? null;
  return { index, request, destination: request === null ? null : travelDestination(request.mapId) };
}));
const assignedShortcuts = computed(() => shortcutRows.value.filter(
  (row) => row.destination !== null && row.request !== null && isAvailable(row.request.mapId),
));
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
  const destinations = travelBrowseScope(state.mapId, state.travelContext)
    .filter(({ mapId }) => isAvailable(mapId));
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
const hasSelectableDestination = computed(() => selectableDestinations.value.some(selectable));
const activeResultId = computed(() => activeDestination.value === null ? null
  : "resultKey" in activeDestination.value
    ? activeDestination.value.resultKey : `map-${activeDestination.value.mapId}`);
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
const searchStatusText = computed(() => {
  if (!hasQuery.value) return "";
  if (results.value.length === 0 && contextExcludedResults.value.length > 0) {
    return props.host.state.value.status === "ready"
      && props.host.state.value.travelContext === "pre-searing"
      ? "No destinations are available outside Pre-Searing."
      : "Pre-Searing destinations are unavailable after the Searing.";
  }
  if (results.value.length === 0 && props.host.friends.value.status === "waiting") {
    return props.host.friends.value.reason === "invalid"
      ? "Friend locations could not be read safely. Destination search still works."
      : "Friend locations are unavailable right now. Destination search still works.";
  }
  if (results.value.length === 0) return "No destinations or friends match your search.";
  return `${results.value.length} ${results.value.length === 1 ? "result" : "results"} found.`;
});
const emptySearchTitle = computed(() =>
  contextExcludedResults.value.length > 0
    ? "Destination unavailable here"
    : `No destinations or friends for “${query.value}”`
);
const emptySearchHelp = computed(() => {
  const excluded = contextExcludedResults.value[0];
  if (excluded !== undefined) {
    return travelContextRefusal(props.host.state.value, excluded.mapId)
      ?? "This destination is unavailable from the current location.";
  }
  if (props.host.friends.value.status === "waiting") {
    return props.host.friends.value.reason === "invalid"
      ? "Friend locations could not be read safely. You can still search for a destination."
      : "Friend locations are unavailable right now. You can still search for a destination.";
  }
  return "Try a friend, destination, campaign, official shortcut, or your own search phrase.";
});

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

function searchResultLocation(result: SearchResult): string {
  if (result.kind === "friend") return result.location;
  if (result.kind === "guild-hall") return props.host.state.value.status === "ready"
    && props.host.state.value.guildHall ? "Return to previous outpost" : "Your guild";
  return result.destination.name;
}

function friendResultLabel(result: FriendSearchResult): string {
  const location = searchResultLocation(result);
  return result.disabledReason === null
    ? location
    : `${location}, ${result.disabledReason}`;
}

function searchResultDisabled(result: SearchResult): boolean {
  return result.disabledReason !== null || travelPending.value || props.host.unavailable !== null;
}

function selectable(entry: TravelDestination | SearchResult): boolean {
  return !("resultKey" in entry) || entry.disabledReason === null;
}

function resultDestination(entry: TravelDestination | SearchResult): TravelDestination | null {
  return "resultKey" in entry ? entry.destination : entry;
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
    return `${destination.name}, ${destination.campaign}, current location`;
  }
  const shortcut = shortcutNumber(destination.mapId);
  const context = [
    shortcut === null ? null : `shortcut ${shortcut}`,
    wasRecentlyVisited(destination.mapId) ? "recent" : null,
  ].filter((value): value is string => value !== null);
  return `Travel to ${destination.name}, ${destination.campaign}${context.length === 0 ? "" : `, ${context.join(", ")}`}`;
}

function activateBrowseDestination(mapId: number): void {
  const index = selectableDestinations.value.findIndex((destination) => destination.mapId === mapId);
  if (index >= 0) active.value = index;
}

watch(query, () => {
  active.value = 0;
  if (hasQuery.value) mode.value = "travel";
});
watch(results, (next, previous) => {
  const selectedKey = previous[active.value]?.resultKey;
  const retained = selectedKey === undefined ? -1 : next.findIndex(
    (result) => result.resultKey === selectedKey && result.disabledReason === null,
  );
  const firstAvailable = next.findIndex((result) => result.disabledReason === null);
  active.value = retained >= 0 ? retained : firstAvailable;
  props.host.traceSearch(query.value, next.map((result) => result.mapId).filter((mapId) => mapId > 0));
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
  await nextTick();
  input.value?.focus({ preventScroll: true });
  try {
    const [preferencesLoaded] = await Promise.all([
      travelPreferences.load(),
      props.host.loadHistory(),
    ]);
    if (!preferencesLoaded || load !== visibilityLoad) return;
  } catch {
    setFeedback("Travel preferences could not be loaded. Reopen Travel to try again.", "danger");
  }
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

async function travelToResult(result: SearchResult): Promise<void> {
  if (result.kind === "guild-hall") {
    if (result.disabledReason === null) {
      try {
        await props.host.guildHall?.();
        emit("close");
      } catch { /* The host owns the refusal notice. */ }
    }
    return;
  }
  if (result.kind === "friend") {
    const observed = props.host.friends.value;
    const current = observed.status === "ready"
      ? observed.friends.find(({ key }) => key === result.friend.key)
      : undefined;
    const destination = current === undefined ? null : travelDestination(current.mapId);
    if (current === undefined
      || observed.status !== "ready"
      || observed.generation !== result.generation
      || current.mapId !== result.mapId
      || friendDisabledReason(current, destination) !== null) {
      setFeedback("This friend’s location changed. Select them again.", "warning");
      return;
    }
  }
  await travel({ mapId: result.mapId });
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
  const entries = selectableDestinations.value;
  if (!entries.some(selectable)) return;
  let next = active.value < 0 ? (direction === 1 ? entries.length - 1 : 0) : active.value;
  do next = (next + direction + entries.length) % entries.length;
  while (!selectable(entries[next]!));
  active.value = next;
  await nextTick();
  palette.value?.querySelector<HTMLElement>(`#travel-${activeResultId.value}`)?.scrollIntoView({ block: "nearest" });
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
    if (activeDestination.value !== null
      && selectable(activeDestination.value)
      && !travelPending.value
      && props.host.unavailable === null) {
      event.preventDefault();
      if ("resultKey" in activeDestination.value) void travelToResult(activeDestination.value);
      else void travel({ mapId: activeDestination.value.mapId });
    }
    return;
  }
  if (/^Digit[1-9]$/u.test(event.code) && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && activeDestination.value) {
    const destination = resultDestination(activeDestination.value);
    if (destination === null || !selectable(activeDestination.value)) return;
    event.preventDefault();
    void saveShortcut(Number(event.code.slice(5)) - 1, destination);
    return;
  }
  if (/^Digit[1-9]$/u.test(event.code) && mode.value === "travel" && !hasQuery.value && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    const slot = Number(event.code.slice(5)) - 1;
    const shortcut = shortcuts.value[slot];
    if (shortcut && isAvailable(shortcut.mapId)) void travel(shortcut);
    else if (shortcut && availability(shortcut.mapId) === "outside-context") {
      const message = travelContextRefusal(props.host.state.value, shortcut.mapId);
      if (message !== null) setFeedback(message, "warning");
    }
    else void openShortcutManager(slot);
  }
}

</script>

<template>
  <section ref="palette" v-show="visible" class="ui-frame travel-palette" :role="nativeDialog ? undefined : 'dialog'" :aria-label="nativeDialog ? undefined : 'Quick Travel'" :aria-busy="preferenceWritePending" @keydown="onKeydown">
    <div class="travel-search">
      <label for="travel-search-input"><svg class="travel-search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25" /><path d="m12.4 12.4 4.1 4.1" /></svg><input id="travel-search-input" ref="input" v-model="query" role="combobox" aria-label="Destination, phrase, or friend" :aria-controls="hasQuery ? 'travel-results' : undefined" aria-autocomplete="list" aria-haspopup="listbox" :aria-activedescendant="hasQuery && activeResultId ? `travel-${activeResultId}` : undefined" :aria-expanded="hasQuery && selectableDestinations.length > 0" autocomplete="off" spellcheck="false" :maxlength="TRAVEL_SEARCH_QUERY_LIMIT" placeholder="Search destinations or friends…"></label>
    </div>

    <span class="ui-sr-only" role="status" aria-live="polite" aria-atomic="true">{{ statusText }}</span>
    <span class="ui-sr-only" role="status" aria-live="polite" aria-atomic="true">{{ searchStatusText }}</span>
    <div v-if="urgentNoticeVisible" class="travel-notice" :data-level="statusLevel" aria-hidden="true">{{ statusText }}</div>

    <section v-if="hasQuery" id="travel-results-panel" class="ui-scroll travel-body" role="region" aria-label="Travel search results">
      <div v-if="results.length" class="travel-result-heading">{{ results.length === 1 ? 'Best match for' : 'Matches for' }} <strong>{{ query }}</strong></div>
      <div v-if="results.length" id="travel-results" class="travel-results" role="listbox">
        <button v-for="(result, index) in results" :id="`travel-${result.resultKey}`" :key="result.resultKey" type="button" class="travel-result ui-row" role="option" tabindex="-1" :aria-selected="index === active" :aria-disabled="searchResultDisabled(result)" :aria-label="result.kind === 'friend' ? `${result.friend.alias}, ${result.friend.character}, ${friendResultLabel(result)}` : result.kind === 'guild-hall' ? `${host.state.value.status === 'ready' && host.state.value.guildHall ? 'Leave' : 'Travel to'} Guild Hall, ${searchResultLocation(result)}` : undefined" :disabled="searchResultDisabled(result)" @mouseenter="active = index" @click="active = index; travelToResult(result)">
          <span class="travel-result-identity">
            <svg v-if="result.kind === 'friend'" class="travel-player-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6.5" r="3" /><path d="M4.5 17c.6-3.1 2.4-4.7 5.5-4.7s4.9 1.6 5.5 4.7" /></svg>
            <svg v-else-if="result.kind === 'guild-hall'" class="travel-player-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 16 5v4.4c0 3.7-2.2 6.4-6 8.1-3.8-1.7-6-4.4-6-8.1V5l6-2.5Z" /><path d="M7.2 9.7h5.6M10 6.8v5.8" /></svg>
            <span><strong v-if="result.kind === 'friend'">{{ result.friend.alias }}</strong><strong v-else-if="result.kind === 'guild-hall'">{{ host.state.value.status === 'ready' && host.state.value.guildHall ? 'Leave Guild Hall' : 'Guild Hall' }}</strong><strong v-else><template v-for="(part, partIndex) in highlightTravelDestinationName(result.destination, query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></strong><small>{{ result.kind === 'friend' ? result.friend.character : result.kind === 'guild-hall' ? 'Guild' : result.destination.campaign }}</small></span>
          </span>
          <span class="travel-result-context"><span class="travel-match" :data-unavailable="result.disabledReason !== null || undefined">{{ result.kind === 'destination' ? queryMatchLabel(result.destination) : searchResultLocation(result) }}</span><small v-if="result.disabledReason !== null" class="travel-unavailable-reason">{{ result.disabledReason }}</small></span>
        </button>
      </div>
      <div v-else class="ui-empty travel-empty"><strong>{{ emptySearchTitle }}</strong><p>{{ emptySearchHelp }}</p><button type="button" class="ui-button" @click="query = ''">Clear search</button></div>
    </section>

    <section v-else-if="mode === 'travel'" id="travel-panel" class="ui-scroll travel-body" role="region" aria-label="Travel">
      <section v-if="showingSmallCatalogue" class="travel-section travel-available" aria-labelledby="travel-available-title">
        <header class="travel-section-head"><h2 id="travel-available-title">{{ browseUnlocksKnown ? 'Available destinations' : 'Destinations' }}</h2><span>{{ browseDestinations.length }} {{ browseUnlocksKnown ? 'unlocked' : 'nearby' }}</span></header>
        <div id="travel-available" class="travel-recent-grid">
          <button v-for="destination in browseDestinations" :id="`travel-${destination.mapId}`" :key="destination.mapId" type="button" class="travel-recent ui-row" :data-current="destination.mapId === currentMapId || undefined" :disabled="travelPending || host.unavailable !== null || destination.mapId === currentMapId" :aria-current="destination.mapId === currentMapId ? 'location' : undefined" :aria-label="browseDestinationLabel(destination)" @mouseenter="activateBrowseDestination(destination.mapId)" @click="travel({ mapId: destination.mapId })"><span><strong>{{ destination.name }}</strong><small>{{ destination.campaign }}</small></span><span class="travel-destination-context"><span v-if="shortcutNumber(destination.mapId) !== null" class="travel-shortcut-context" :title="`Shortcut ${shortcutNumber(destination.mapId)}`" aria-hidden="true">{{ shortcutNumber(destination.mapId) }}</span><span v-if="destination.mapId === currentMapId" class="travel-current">Current</span><span v-else-if="wasRecentlyVisited(destination.mapId)" class="travel-current">Recent</span><svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></span></button>
        </div>
      </section>
      <section v-else-if="recentDestinations.length" class="travel-section travel-history" aria-labelledby="travel-history-title">
        <header class="travel-section-head"><h2 id="travel-history-title">Recent</h2></header>
        <div class="travel-recent-grid">
          <button v-for="destination in recentDestinations" :key="destination.mapId" type="button" class="travel-recent ui-row" :disabled="travelPending || host.unavailable !== null" :aria-label="`Travel to recent destination ${destination.name}, ${destination.campaign}`" @click="travel({ mapId: destination.mapId })"><span><strong>{{ destination.name }}</strong><small>{{ destination.campaign }}</small></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></button>
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
    <footer class="travel-footer"><span v-if="statusText && !urgentNoticeVisible" :data-level="statusLevel" aria-hidden="true">{{ statusText }}</span><span v-if="hasQuery && hasSelectableDestination" class="travel-key-hints"><kbd class="ui-kbd">↑↓</kbd> choose <kbd class="ui-kbd">return</kbd> travel <kbd class="ui-kbd">⌘1–9</kbd> save</span><span v-else-if="showingSmallCatalogue" class="travel-key-hints"><kbd class="ui-kbd">↑↓</kbd> choose <kbd class="ui-kbd">return</kbd> travel <kbd class="ui-kbd">⌘1–9</kbd> save</span><span v-else-if="mode === 'travel' && !hasQuery" class="travel-key-hints"><kbd class="ui-kbd">1–9</kbd> travel</span><span v-else-if="mode === 'customize'" class="travel-key-hints"><kbd class="ui-kbd">esc</kbd> back</span></footer>
    <div class="travel-header-actions">
      <button ref="settingsButton" type="button" class="ui-button travel-close" data-icon aria-label="Customize Travel" title="Customize Travel" :aria-pressed="mode === 'customize'" aria-controls="travel-customize-panel" :disabled="preferenceControlsDisabled" @click="toggleCustomize"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg></button>
      <button type="button" class="ui-button travel-close" data-icon aria-label="Close Quick Travel" @click="emit('close')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button>
    </div>
  </section>
</template>
