<script setup lang="ts">
import { HUB_SEARCH_GLYPH } from '../../../../src/shared/ui/hub-search';
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  TRAVEL_SEARCH_QUERY_LIMIT,
  TRAVEL_SHORTCUT_LIMIT,
  highlightTravelDestinationName,
  isTravelRequest,
  normaliseTravelTerm,
  searchTravelDestinations,
  travelBrowseScope,
  travelMatchIsExact,
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
import { isHubBackKey } from "../../../../src/shared/keyboard-shortcuts";
import { createHoverSelection } from "../../../../src/shared/ui/hover-selection";
import { listIndexAfter, listKeyStep, listPage } from "../../../../src/shared/ui/list-keys";
import { hubMatch } from "../../../../src/shared/hub";
import type { HubViewFooter } from "../../../../src/shared/hub";
import { useTravelPreferences } from "../travel-preferences";
import TravelDestinationPicker from "./TravelDestinationPicker.vue";

const props = defineProps<{
  host: TravelHost;
  visible: boolean;
  nativeDialog?: boolean;
  inset?: boolean;
  /** In the Hub, whether Esc on an empty query returns to a parent page; Travel opened by its shortcut closes instead. */
  hubParent?: boolean;
  preferences?: ReturnType<typeof useTravelPreferences>;
  /** In the Hub, its footer: Travel names its trip there instead of in a footer of its own (HUB-042). */
  footer?: HubViewFooter;
  /** In the Hub, the one "Leave this area?" step before a trip out of an explorable area (D-27); it rejects when the player stays. */
  leaveArea?: (place: string, leave: () => Promise<void>) => Promise<void>;
  resume?: {
    query: string; selected: string | null; mode: "travel" | "customize";
    editingSlot: number | null; addingPhrase: boolean; phrase: string; mapId: number | null; scroll: number;
  };
}>();
/** `close` leaves Travel (Esc, Back); `travelled` ends the task after a trip started, so a host closes rather than steps back. */
const emit = defineEmits<{ close: []; travelled: []; remember: [state: NonNullable<typeof props.resume>] }>();
type PaletteMode = "travel" | "customize";
const GEAR_PATH = "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z";
const SMALL_TRAVEL_CATALOGUE_LIMIT = 10;
const GUILD_HALL_SEARCH_TERMS = Object.freeze(["guild hall", "guild", "hall", "gh"]);
/** The words that name Guild Hall itself; any other prefix ranks after exact destinations (HUB-066). */
const GUILD_HALL_EXACT_TERMS = Object.freeze(["guild hall", "guild", "gh"]);
const COMPACT_FAVORITE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "Ascalon City": "Ascalon",
  "Kaineng Center": "Kaineng",
  "Embark Beach": "Embark",
});

const palette = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const settingsButton = ref<HTMLButtonElement | null>(null);
const query = ref(props.resume?.query ?? "");
/**
 * The selection is a destination's identity, never a position (HUB-011): a game-state update
 * that reorders or removes places never moves it onto another one. `null` is the default, the
 * first destination; `NO_SELECTION` means the chosen one went away.
 */
const NO_SELECTION = "";
const activeKey = ref<string | null>(props.resume ? props.resume.selected ?? NO_SELECTION : null);
/** Hover moves `active` only on real movement and never off a clicked destination. */
const hover = createHoverSelection();
const mode = ref<PaletteMode>(props.resume?.mode ?? "travel");
const editingShortcutSlot = ref<number | null>(props.resume?.editingSlot ?? null);
const addingPhrase = ref(props.resume?.addingPhrase ?? false);
const newPhraseTerm = ref(props.resume?.phrase ?? "");
const newPhraseMapId = ref<number | null>(props.resume?.mapId ?? null);
const phraseError = ref("");
const feedback = ref("");
const feedbackLevel = ref<"info" | "success" | "warning" | "danger">("info");
const travelPreferences = props.preferences ?? useTravelPreferences(props.host);
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
  disabledReason: string | null;
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
  disabledReason: string | null;
}>;
type SearchResult = DestinationSearchResult | FriendSearchResult | GuildHallSearchResult;
const catalogueResults = computed(() => hasQuery.value
  ? searchTravelDestinations(query.value, travelPreferences.searchSynonyms(query.value))
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
/** The place the player stands in is never a trip; it says so before Enter (HUB-068). */
const alreadyHere = (destination: TravelDestination) => `You are already in ${destination.name}`;
/** A friend's location by name; a map the catalogue cannot name is an unknown location, never an ID. */
function friendLocation(mapId: number, destination: TravelDestination | null): string {
  if (destination !== null) return destination.name;
  const name = guildWarsMapName(mapId);
  return name.startsWith("Unknown map") ? "Unknown location" : name;
}
function friendDisabledReason(friend: TravelFriend, destination: TravelDestination | null): string | null {
  if (friend.status === "offline") return "Offline";
  if (friend.status === "unknown") return "Status unavailable";
  if (destination === null) return "Unavailable for travel";
  const result = availability(friend.mapId);
  if (result === "locked") return "Not unlocked by this character";
  if (result === "outside-context") return "Unavailable here";
  if (friend.mapId === currentMapId.value) return alreadyHere(destination);
  return null;
}
const friendResults = computed<FriendSearchResult[]>(() => {
  const observed = props.host.friends.value;
  if (!hasQuery.value || observed.status !== "ready") return [];
  return observed.friends.flatMap((friend) => {
    const names = normaliseTravelTerm(`${friend.alias} ${friend.character}`);
    if (hubMatch(names, normaliseTravelTerm(query.value)) === null) return [];
    const destination = travelDestination(friend.mapId);
    return [{
      kind: "friend",
      resultKey: `friend-${friend.key}`,
      generation: observed.generation,
      mapId: friend.mapId,
      destination,
      location: friendLocation(friend.mapId, destination),
      friend,
      disabledReason: friendDisabledReason(friend, destination),
    }];
  });
});
const guildHallExact = computed(() => GUILD_HALL_EXACT_TERMS.includes(normaliseTravelTerm(query.value)));
const guildHallResults = computed<GuildHallSearchResult[]>(() => {
  if (!hasQuery.value) return [];
  const term = normaliseTravelTerm(query.value);
  if (!GUILD_HALL_SEARCH_TERMS.some((candidate) => candidate.startsWith(term))) return [];
  const state = props.host.state.value;
  const disabledReason = props.host.guildHallUnavailable
    ?? (state.status !== "ready"
    ? "Unavailable right now"
    : state.guildHall || state.hasGuildHall ? null : "No Guild Hall");
  return [{
    kind: "guild-hall",
    resultKey: "guild-hall",
    disabledReason,
  }];
});
/** Why a matched destination cannot be a trip now; it stays listed with the reason (HUB-067, HUB-068). */
function destinationDisabledReason(destination: TravelDestination): string | null {
  if (destination.mapId === currentMapId.value) return alreadyHere(destination);
  return availability(destination.mapId) === "locked" ? "Not unlocked by this character" : null;
}
/**
 * Exact matches lead: Guild Hall's own words, then a destination's phrase, shortcut or name,
 * then friends, then Guild Hall by a mere prefix, then destinations by the starts of their
 * words (HUB-066). A destination outside the character's context is explained, not listed.
 */
const results = computed<SearchResult[]>(() => {
  const friendMaps = new Set(friendResults.value
    .filter(({ disabledReason }) => disabledReason === null)
    .map(({ mapId }) => mapId));
  const destinations = catalogueResults.value
    .filter((destination) => availability(destination.mapId) !== "outside-context" && !friendMaps.has(destination.mapId))
    .map((destination): DestinationSearchResult => ({
      kind: "destination",
      resultKey: `map-${destination.mapId}`,
      mapId: destination.mapId,
      destination,
      disabledReason: destinationDisabledReason(destination),
    }));
  const exact = destinations.filter(({ destination }) => travelMatchIsExact(destination, query.value, synonyms.value));
  return [
    ...(guildHallExact.value ? guildHallResults.value : []),
    ...exact,
    ...friendResults.value,
    ...(guildHallExact.value ? [] : guildHallResults.value),
    ...destinations.filter((result) => !exact.includes(result)),
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
const browseScope = computed(() => {
  const state = props.host.state.value;
  return state.status === "ready" ? travelBrowseScope(state.mapId, state.travelContext) : [];
});
const browseTravelableDestinations = computed(() =>
  browseScope.value.filter(({ mapId }) => isAvailable(mapId))
);
const browseIncludesLockedCurrent = computed(() =>
  currentMapId.value !== null
  && browseScope.value.some(({ mapId }) => mapId === currentMapId.value)
  && !browseTravelableDestinations.value.some(({ mapId }) => mapId === currentMapId.value)
);
const recentDestinations = computed(() => props.host.history.value
  .filter((mapId) => mapId !== currentMapId.value && isAvailable(mapId))
  .map((mapId) => travelDestination(mapId))
  .filter((destination): destination is TravelDestination => destination !== null)
  .slice(0, TRAVEL_HISTORY_VISIBLE_LIMIT));
const browseDestinations = computed(() => {
  const destinations = [...browseTravelableDestinations.value];
  if (browseIncludesLockedCurrent.value) {
    const current = browseScope.value.find(({ mapId }) => mapId === currentMapId.value);
    if (current !== undefined) destinations.push(current);
  }
  return destinations.length <= SMALL_TRAVEL_CATALOGUE_LIMIT
    ? destinations.sort((left, right) => left.name.localeCompare(right.name, "en"))
    : [];
});
const browseCountText = computed(() => {
  if (!browseUnlocksKnown.value) return `${browseDestinations.value.length} nearby`;
  return `${browseTravelableDestinations.value.length} unlocked${
    browseIncludesLockedCurrent.value ? " + current" : ""
  }`;
});
const browsingSmallCatalogue = computed(() => browseDestinations.value.length > 0);
const showingSmallCatalogue = computed(() =>
  browsingSmallCatalogue.value && mode.value === "travel" && !hasQuery.value
);
/** Without a query: the nearby destinations of a small catalogue, or the recents; the favourites follow either (HUB-192). */
const leadingDestinations = computed(() => showingSmallCatalogue.value
  ? browseDestinations.value.filter(({ mapId }) => mapId !== currentMapId.value)
  : recentDestinations.value);
const selectableDestinations = computed(() => hasQuery.value
  ? results.value
  : [...leadingDestinations.value, ...assignedShortcuts.value.flatMap(row => row.destination ? [row.destination] : [])]);
const hasSelectableDestination = computed(() => selectableDestinations.value.some(selectable));
const resultId = (index: number): string | null => {
  const destination = selectableDestinations.value[index];
  if (!destination) return null;
  if ("resultKey" in destination) return destination.resultKey;
  const leading = leadingDestinations.value.length;
  if (index >= leading) return `favorite-${assignedShortcuts.value[index - leading]?.index}`;
  return showingSmallCatalogue.value ? `map-${destination.mapId}` : `recent-${destination.mapId}`;
};
const selectableIds = computed(() => selectableDestinations.value.map((_, index) => resultId(index)));
/** The selected position, derived from its identity; setting it records the identity at that position. */
const active = computed({
  get: () => activeKey.value === null
    ? selectableDestinations.value.findIndex(selectable)
    : selectableIds.value.indexOf(activeKey.value),
  set: (index: number) => { activeKey.value = resultId(index) ?? NO_SELECTION; },
});
const activeDestination = computed(() => selectableDestinations.value[active.value] ?? null);
const activeResultId = computed(() => resultId(active.value));
onBeforeUnmount(() => {
  visibilityLoad++;
  emit("remember", { query: query.value, selected: activeResultId.value, mode: mode.value,
    editingSlot: editingShortcutSlot.value, addingPhrase: addingPhrase.value,
    phrase: newPhraseTerm.value, mapId: newPhraseMapId.value,
    scroll: palette.value?.querySelector<HTMLElement>(".travel-body")?.scrollTop ?? 0 });
});
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
  return "Try the start of a destination's name, an official shortcut, a friend or your own search phrase.";
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

function searchResultTitle(result: SearchResult): string {
  if (result.kind === "friend") return result.friend.alias;
  if (result.kind === "guild-hall") {
    return props.host.state.value.status === "ready" && props.host.state.value.guildHall
      ? "Leave Guild Hall"
      : "Guild Hall";
  }
  return result.destination.name;
}

function searchResultSubtitle(result: SearchResult): string {
  if (result.kind === "friend") return result.friend.character;
  return result.kind === "guild-hall" ? "Guild" : result.destination.campaign;
}

function searchResultContext(result: SearchResult): string {
  return result.kind === "destination"
    ? queryMatchLabel(result.destination)
    : searchResultLocation(result);
}

function searchResultAriaLabel(result: SearchResult): string | undefined {
  if (result.kind === "friend") {
    return `${result.friend.alias}, ${result.friend.character}, ${friendResultLabel(result)}`;
  }
  if (result.kind === "guild-hall") {
    const action = props.host.state.value.status === "ready" && props.host.state.value.guildHall
      ? "Leave"
      : "Travel to";
    return `${action} Guild Hall, ${searchResultLocation(result)}`;
  }
  return undefined;
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

/** A place the player already stands in is never a trip: its favourite shows it and refuses it, like the catalogue. */
function selectable(entry: TravelDestination | SearchResult): boolean {
  return "resultKey" in entry ? entry.disabledReason === null : entry.mapId !== currentMapId.value;
}

function resultDestination(entry: TravelDestination | SearchResult): TravelDestination | null {
  if (!("resultKey" in entry)) return entry;
  return entry.kind === "guild-hall" ? null : entry.destination;
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
  const index = selectableDestinations.value.findIndex(
    (entry) => resultDestination(entry)?.mapId === mapId,
  );
  if (index >= 0) active.value = index;
}

watch(query, () => {
  hover.release();
  activeKey.value = null;
  // A receipt or refusal belongs to what was on screen; typing starts over (HUB-188).
  feedback.value = "";
  if (hasQuery.value) mode.value = "travel";
});
/**
 * A game-state update that removes the chosen destination, or makes it one the player
 * cannot take, clears the selection and says so; it never selects its neighbour (HUB-011).
 */
let selectionQuery = query.value;
watch(selectableIds, (next, previous) => {
  const sameQuery = selectionQuery === query.value;
  selectionQuery = query.value;
  const key = activeKey.value;
  if (key === null) {
    // Publish the initial choice as an identity too: it is already visible
    // to the player, so an observation must not silently replace it.
    activeKey.value = resultId(selectableDestinations.value.findIndex(selectable));
    return;
  }
  if (!sameQuery || key === NO_SELECTION || !previous?.includes(key)) return;
  const index = next.indexOf(key);
  if (index >= 0 && selectable(selectableDestinations.value[index]!)) return;
  activeKey.value = NO_SELECTION;
  setFeedback("That destination is no longer available. Choose another destination.", "info");
}, { immediate: true });
watch(results, (next) => {
  props.host.traceSearch(query.value, next.flatMap(
    (result) => result.kind === "guild-hall" ? [] : [result.mapId],
  ));
});
watch(() => props.visible, async (visible) => {
  if (!visible) return;
  const load = ++visibilityLoad;
  hover.release();
  if (!props.resume) {
    query.value = ""; activeKey.value = null; mode.value = "travel";
    editingShortcutSlot.value = null; addingPhrase.value = false;
  }
  feedback.value = "";
  phraseError.value = "";
  await nextTick();
  if (!props.resume && load === visibilityLoad) input.value?.focus({ preventScroll: true });
  try {
    const [preferencesLoaded] = await Promise.all([
      travelPreferences.load(),
      props.host.loadHistory(),
    ]);
    if (!preferencesLoaded || load !== visibilityLoad) return;
    if (props.resume) {
      await nextTick();
      const selected = props.resume.selected;
      if (selected && !selectableIds.value.includes(selected)) {
        activeKey.value = NO_SELECTION;
        setFeedback("That destination is no longer available. Choose another destination.", "info");
      }
      const scroller = palette.value?.querySelector<HTMLElement>(".travel-body");
      if (scroller) scroller.scrollTop = props.resume.scroll;
    }
  } catch {
    setFeedback("Travel preferences could not be loaded. Reopen Travel to try again.", "danger");
  }
}, { immediate: true, flush: "post" });

async function selectMode(next: PaletteMode, focus: "search" | "settings" = "search"): Promise<void> {
  query.value = "";
  hover.release();
  activeKey.value = null;
  mode.value = next;
  await nextTick();
  if (focus === "settings") {
    settingsButton.value?.focus();
  } else if (next === "travel") {
    input.value?.focus();
  }
}

/** Clearing from the empty state removes the focused button, so the keyboard returns to search (HUB-071). */
async function clearSearch(): Promise<void> {
  query.value = "";
  await nextTick();
  input.value?.focus();
}

function toggleCustomize(): void {
  const next = mode.value === "customize" ? "travel" : "customize";
  void selectMode(next, next === "customize" ? "settings" : "search");
}

/**
 * Runs a trip; from an explorable area the Hub asks "Leave this area?" first, on its own page,
 * and closes after the player leaves (D-27). Staying returns to Travel as it was.
 */
async function leaving(place: string, trip: () => Promise<void>): Promise<void> {
  const state = props.host.state.value;
  if (props.leaveArea && state.status === "ready" && state.explorable) await props.leaveArea(place, trip);
  else await trip();
}

async function travel(request: TravelRequest): Promise<void> {
  if (travelPending.value || !isTravelRequest(request)) return;
  feedback.value = "";
  try {
    await leaving(travelDestination(request.mapId)?.name ?? "this place", () => props.host.travel(request));
    emit("travelled");
  } catch { /* The host owns the refusal notice and resets its transaction; staying is no failure. */ }
}

async function travelToResult(result: SearchResult): Promise<void> {
  if (result.kind === "guild-hall") {
    if (result.disabledReason === null) {
      try {
        await leaving("Guild Hall", () => props.host.guildHall());
        emit("travelled");
      } catch { /* The host owns the refusal notice; staying is no failure. */ }
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

/**
 * One destination holds one number: assigning it moves it from its old number, and the
 * receipt names what the number held before (HUB-188).
 */
async function saveShortcut(slot: number, destination: TravelDestination): Promise<void> {
  const held = shortcuts.value[slot];
  if (held?.mapId === destination.mapId) {
    setFeedback(`${destination.name} is already shortcut ${slot + 1}.`, "info");
    return;
  }
  const replaced = held ? travelDestination(held.mapId) : null;
  const moved = shortcuts.value.findIndex((entry) => entry?.mapId === destination.mapId);
  try {
    if (!await travelPreferences.assignShortcut(slot, destination)) return;
    const change = [
      moved >= 0 ? `moved from ${moved + 1}` : null,
      replaced ? `replaces ${replaced.name}` : null,
    ].filter((part): part is string => part !== null);
    setFeedback(`${destination.name} is now shortcut ${slot + 1}${change.length ? ` (${change.join(", ")})` : ""}.`, "success");
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

/** Choosing a number opens its destination picker and takes the keyboard there (HUB-070). */
async function editShortcut(slot: number): Promise<void> {
  editingShortcutSlot.value = editingShortcutSlot.value === slot ? null : slot;
  if (editingShortcutSlot.value === null) return;
  await nextTick();
  palette.value?.querySelector<HTMLElement>(".travel-shortcut-editor summary")?.focus();
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
  if (outcome === "unverified") return "gwonmac did not confirm that phrase was saved. Restart the app, then try again.";
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
    query.value = term;
    mode.value = "travel";
    await nextTick();
    // After the query that shows the phrase at work, which clears older receipts.
    setFeedback(`“${term}” now finds ${destination.name}. Search was verified.`, "success");
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

const canRunActive = computed(() => activeDestination.value !== null
  && selectable(activeDestination.value)
  && !travelPending.value
  && props.host.unavailable === null);
/** What Enter and the footer primary do for the selected destination, named before it runs. */
const primaryLabel = computed(() => {
  const entry = activeDestination.value;
  if (entry === null) return "Choose a destination";
  if (!("resultKey" in entry)) return entry.mapId === currentMapId.value ? `Already in ${entry.name}` : `Travel to ${entry.name} · Any district`;
  if (entry.kind === "guild-hall") return props.host.state.value.status === "ready" && props.host.state.value.guildHall ? "Leave Guild Hall" : "Travel to Guild Hall";
  return `Travel to ${entry.kind === "friend" ? entry.destination?.name ?? entry.location : entry.destination.name} · Any district`;
});
// The Hub footer names the trip, or Done while customizing, and follows the selection.
watch([primaryLabel, canRunActive, () => mode.value], () => {
  props.footer?.primary(mode.value === "customize" ? { label: "Done", run: () => void selectMode("travel") }
    : { label: primaryLabel.value, disabled: !canRunActive.value, run: runActive });
}, { immediate: true });
function runActive(): void {
  const entry = activeDestination.value;
  if (entry === null || !canRunActive.value) return;
  if ("resultKey" in entry) void travelToResult(entry);
  else {
    const favorite = !hasQuery.value
      ? assignedShortcuts.value[active.value - leadingDestinations.value.length] : undefined;
    void travel(favorite?.request ?? { mapId: entry.mapId });
  }
}
/** The destination the current click run selected; only its own double-click travels. */
let pressed: string | null = null;
/**
 * A click selects a destination; Enter, the footer primary or a double-click
 * that started on the same destination travels (D-24). A page change between
 * the clicks cancels the run in the shared surface controller (HUB-242). A
 * keyboard activation (detail 0) travels as before.
 */
function pick(event: MouseEvent, index: number): void {
  if (index < 0) return;
  const id = resultId(index);
  active.value = index;
  if (event.detail === 1) { pressed = id; hover.hold(); }
  else if (event.detail === 0 || (event.detail === 2 && pressed === id)) runActive();
}
/**
 * Right-click selects a destination like a click and runs nothing, even as part
 * of a later double-click (HUB-248). Travel offers no Actions for a destination.
 */
function selectOnly(event: MouseEvent, index: number): void {
  event.preventDefault();
  if (index < 0 || (event.currentTarget instanceof HTMLButtonElement && event.currentTarget.disabled)) return;
  active.value = index;
  pressed = null;
  hover.hold();
}
/** The pointer's route to Enter, out of the Tab order: Enter already runs it from search or a destination. */
function pickPrimary(event: MouseEvent): void {
  if (event.detail <= 1) runActive();
}
/** In the Hub a press on a destination keeps the keyboard in search, where the selection lives. */
function keepSearchFocus(event: MouseEvent): void {
  if (props.inset) event.preventDefault();
}

/**
 * Hover selects only on real pointer movement and leaves a clicked destination
 * alone until the pointer leaves the list (HUB-012, D-24): the footer keeps naming
 * what the player chose.
 */
function moved(event: PointerEvent): boolean {
  // Like the arrow keys, hover passes over a destination that cannot be chosen.
  if (event.currentTarget instanceof HTMLButtonElement && event.currentTarget.disabled) return false;
  return hover.selects(event);
}

/** The shared list move over the destinations it may choose; the ends hold. */
async function moveActive(step: number): Promise<void> {
  const entries = selectableDestinations.value;
  const next = listIndexAfter(active.value, entries.length, step, (index) => selectable(entries[index]!));
  if (next >= 0) await reveal(next);
}

/** Selects a destination by keyboard and scrolls it into view. */
async function reveal(index: number): Promise<void> {
  hover.release();
  active.value = index;
  await nextTick();
  palette.value?.querySelector<HTMLElement>(`#travel-${activeResultId.value}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** A number key selects its favourite; only Enter travels (D-5). */
function selectShortcut(slot: number): void {
  const shortcut = shortcuts.value[slot];
  if (shortcut && shortcut.mapId === currentMapId.value) {
    setFeedback(`You are already in ${travelDestination(shortcut.mapId)?.name ?? "this place"}.`, "warning");
  } else if (shortcut && isAvailable(shortcut.mapId)) {
    const index = leadingDestinations.value.length + assignedShortcuts.value.findIndex((row) => row.index === slot);
    if (index >= 0 && index < selectableDestinations.value.length) void reveal(index);
  } else if (shortcut && availability(shortcut.mapId) === "outside-context") {
    const message = travelContextRefusal(props.host.state.value, shortcut.mapId);
    if (message !== null) setFeedback(message, "warning");
  } else void openShortcutManager(slot);
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.visible || event.isComposing) return;
  const plainArrow = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  const atStart = event.target === input.value && input.value?.selectionStart === 0 && input.value.selectionEnd === 0;
  // The keyboard stays in search: the shared list keys move one selection without wrapping,
  // and in the Hub ← → step the Recent carousel while there is no query.
  const step = mode.value === "travel" && event.target === input.value
    ? listKeyStep(event, listPage(palette.value?.querySelector<HTMLElement>(".travel-body"), palette.value?.querySelector<HTMLElement>(`#travel-${activeResultId.value}`)), props.inset && !hasQuery.value)
    : null;
  if (step !== null) {
    event.preventDefault();
    // Favourites are a painted grid. Vertical arrows retain the column;
    // recents and search results keep the shared linear list movement.
    const favourites = [...(palette.value?.querySelectorAll<HTMLElement>(".travel-favorite-grid .travel-favorite") ?? [])];
    const leading = leadingDestinations.value.length;
    if (!hasQuery.value && active.value >= leading && plainArrow
      && (event.key === "ArrowDown" || event.key === "ArrowUp") && favourites.length) {
      const columns = favourites.filter(button => button.offsetTop === favourites[0]!.offsetTop).length;
      const column = (active.value - leading) % columns;
      const next = listIndexAfter(active.value, selectableDestinations.value.length, step * columns,
        index => index >= leading && (index - leading) % columns === column && selectable(selectableDestinations.value[index]!));
      if (next >= 0) void reveal(next);
    } else void moveActive(step);
    return;
  }
  // In the Hub, ⌘⌫ leaves Customize like Esc; an open picker closes first, and from the
  // destination list the press is the Hub's own Back.
  if (props.inset && mode.value === "customize" && isHubBackKey(event)
    && !(event.target instanceof Element && event.target.closest("details[open]"))) {
    event.preventDefault();
    if (!event.repeat) void selectMode("travel");
    return;
  }
  if (event.key === "Escape" || (event.key === "ArrowLeft" && plainArrow && atStart && !hasQuery.value)) {
    event.preventDefault();
    // One step per physical press: a held Esc clears the query and stops there.
    if (event.repeat) return;
    if (mode.value === "customize") void selectMode("travel");
    else if (hasQuery.value) {
      query.value = "";
      void nextTick(() => input.value?.focus());
    } else emit("close");
    return;
  }
  // Only a plain Enter travels; a modified Enter is never a second route to it.
  if (mode.value === "travel" && event.target === input.value && event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (event.repeat) { event.preventDefault(); return; }
    if (canRunActive.value) {
      event.preventDefault();
      runActive();
    }
    return;
  }
  if (/^Digit[1-9]$/u.test(event.code) && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && mode.value === "travel" && activeDestination.value) {
    const destination = resultDestination(activeDestination.value);
    if (destination === null || !selectable(activeDestination.value)) return;
    event.preventDefault();
    if (!event.repeat) void saveShortcut(Number(event.code.slice(5)) - 1, destination);
    return;
  }
  if (/^Digit[1-9]$/u.test(event.code) && mode.value === "travel" && !hasQuery.value && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    // A held digit repeats nothing and never types (HUB-003).
    if (!event.repeat) selectShortcut(Number(event.code.slice(5)) - 1);
  }
}

</script>

<template>
  <section ref="palette" v-show="visible" class="travel-palette" :class="{ 'ui-frame': !inset }" :role="nativeDialog ? undefined : 'dialog'" :aria-label="nativeDialog ? undefined : 'Quick Travel'" :aria-busy="preferenceWritePending" @keydown="onKeydown">
    <div class="travel-search">
      <label for="travel-search-input" :class="{ 'ui-hub-search': !!footer }"><svg v-if="footer" class="travel-search-icon" viewBox="0 0 24 24" aria-hidden="true" v-html="HUB_SEARCH_GLYPH"></svg><svg v-else class="travel-search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25" /><path d="m12.4 12.4 4.1 4.1" /></svg><input id="travel-search-input" ref="input" v-model="query" role="combobox" aria-label="Destination, phrase, or friend" :aria-controls="mode === 'travel' ? hasQuery ? 'travel-results' : 'travel-panel' : undefined" aria-autocomplete="list" aria-haspopup="listbox" :aria-activedescendant="mode === 'travel' && activeResultId ? `travel-${activeResultId}` : undefined" :aria-expanded="mode === 'travel' && selectableDestinations.length > 0" autocomplete="off" spellcheck="false" :maxlength="TRAVEL_SEARCH_QUERY_LIMIT" placeholder="Search destinations or friends…"></label>
    </div>

    <!-- In the Hub the cog leads Customize's controls in Tab order (HUB-070); on its own it follows the destinations. -->
    <div v-if="inset" class="travel-header-actions"><button ref="settingsButton" type="button" class="ui-button travel-close" data-icon aria-label="Customize Travel" title="Customize Travel" :aria-pressed="mode === 'customize'" aria-controls="travel-customize-panel" :disabled="preferenceControlsDisabled" @click="toggleCustomize"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="GEAR_PATH" /><circle cx="12" cy="12" r="3" /></svg></button></div>
    <span class="ui-sr-only" role="status" aria-live="polite" aria-atomic="true">{{ statusText }}</span>
    <span class="ui-sr-only" role="status" aria-live="polite" aria-atomic="true">{{ searchStatusText }}</span>
    <div v-if="urgentNoticeVisible" class="travel-notice" :data-level="statusLevel" aria-hidden="true">{{ statusText }}</div>

    <section v-if="hasQuery" id="travel-results-panel" class="ui-scroll travel-body" role="region" aria-label="Travel search results" @pointerleave="hover.release()">
      <div v-if="results.length" class="travel-result-heading">{{ results.length === 1 ? 'Best match for' : 'Matches for' }} <strong>{{ query }}</strong></div>
      <div v-if="results.length" id="travel-results" class="travel-results" role="listbox">
        <button v-for="(result, index) in results" :id="`travel-${result.resultKey}`" :key="result.resultKey" type="button" class="travel-result ui-row" role="option" tabindex="-1" :aria-selected="index === active" :aria-disabled="searchResultDisabled(result)" :aria-label="searchResultAriaLabel(result)" :disabled="searchResultDisabled(result)" @pointermove="moved($event) && (active = index)" @mousedown="keepSearchFocus" @click="pick($event, index)" @contextmenu="selectOnly($event, index)">
          <span class="travel-result-identity">
            <svg v-if="result.kind === 'friend'" class="travel-player-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6.5" r="3" /><path d="M4.5 17c.6-3.1 2.4-4.7 5.5-4.7s4.9 1.6 5.5 4.7" /></svg>
            <svg v-else-if="result.kind === 'guild-hall'" class="travel-player-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 16 5v4.4c0 3.7-2.2 6.4-6 8.1-3.8-1.7-6-4.4-6-8.1V5l6-2.5Z" /><path d="M7.2 9.7h5.6M10 6.8v5.8" /></svg>
            <svg v-if="inset" class="travel-place-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 8-8 10-8-10 8-8Z"/><circle cx="12" cy="10" r="2.5"/></svg><span><strong v-if="result.kind !== 'destination'">{{ searchResultTitle(result) }}</strong><strong v-else><template v-for="(part, partIndex) in highlightTravelDestinationName(result.destination, query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></strong><small>{{ searchResultSubtitle(result) }}</small></span>
          </span>
          <span class="travel-result-context"><span class="travel-match" :data-unavailable="result.disabledReason !== null || undefined">{{ searchResultContext(result) }}</span><small v-if="result.disabledReason !== null" class="travel-unavailable-reason">{{ result.disabledReason }}</small></span>
        </button>
      </div>
      <div v-else class="ui-empty travel-empty"><strong>{{ emptySearchTitle }}</strong><p>{{ emptySearchHelp }}</p><button type="button" class="ui-button" @click="clearSearch">Clear search</button></div>
    </section>

    <section v-else-if="mode === 'travel'" id="travel-panel" class="ui-scroll travel-body" :role="inset ? 'listbox' : 'region'" aria-label="Travel" @pointerleave="hover.release()">
      <section v-if="showingSmallCatalogue" class="travel-section travel-available" :role="inset ? 'group' : undefined" aria-labelledby="travel-available-title">
        <header class="travel-section-head"><h2 id="travel-available-title">{{ browseUnlocksKnown && !browseIncludesLockedCurrent ? 'Available destinations' : 'Destinations' }}</h2><span>{{ browseCountText }}</span></header>
        <div id="travel-available" class="travel-recent-grid">
          <button v-for="destination in browseDestinations" :id="`travel-map-${destination.mapId}`" :tabindex="inset ? -1 : undefined" :role="inset ? 'option' : undefined" :aria-selected="inset ? activeResultId === `map-${destination.mapId}` : undefined" :data-active="activeResultId === `map-${destination.mapId}` || undefined" :key="destination.mapId" type="button" class="travel-recent ui-row" :data-current="destination.mapId === currentMapId || undefined" :disabled="travelPending || host.unavailable !== null || destination.mapId === currentMapId" :aria-current="destination.mapId === currentMapId ? 'location' : undefined" :aria-label="browseDestinationLabel(destination)" @pointermove="moved($event) && activateBrowseDestination(destination.mapId)" @mousedown="keepSearchFocus" @click="pick($event, selectableDestinations.findIndex((entry) => resultDestination(entry)?.mapId === destination.mapId))" @contextmenu="selectOnly($event, selectableDestinations.findIndex((entry) => resultDestination(entry)?.mapId === destination.mapId))"><svg v-if="inset" class="travel-place-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 8-8 10-8-10 8-8Z"/><circle cx="12" cy="10" r="2.5"/></svg><span><strong>{{ destination.name }}</strong><small>{{ destination.campaign }}</small></span><span class="travel-destination-context"><span v-if="shortcutNumber(destination.mapId) !== null" class="travel-shortcut-context" :title="`Shortcut ${shortcutNumber(destination.mapId)}`" aria-hidden="true">{{ shortcutNumber(destination.mapId) }}</span><span v-if="destination.mapId === currentMapId" class="travel-current">Current</span><span v-else-if="wasRecentlyVisited(destination.mapId)" class="travel-current">Recent</span><svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></span></button>
        </div>
      </section>
      <section v-else-if="recentDestinations.length" class="travel-section travel-history" :role="inset ? 'group' : undefined" aria-labelledby="travel-history-title">
        <header class="travel-section-head"><h2 id="travel-history-title">Recent</h2></header>
        <div class="travel-recent-grid" :tabindex="inset ? -1 : undefined">
          <button v-for="(destination, index) in recentDestinations" :id="`travel-recent-${destination.mapId}`" :key="destination.mapId" :tabindex="inset ? -1 : undefined" :data-active="active === index || undefined" :role="inset ? 'option' : undefined" :aria-selected="inset ? active === index : undefined" @pointermove="moved($event) && (active = index)" type="button" class="travel-recent ui-row" :disabled="travelPending || host.unavailable !== null" :aria-label="`Travel to recent destination ${destination.name}, ${destination.campaign}`" @mousedown="keepSearchFocus" @click="pick($event, index)" @contextmenu="selectOnly($event, index)"><svg v-if="inset" class="travel-place-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 8-8 10-8-10 8-8Z"/><circle cx="12" cy="10" r="2.5"/></svg><span><strong>{{ destination.name }}</strong><small>{{ destination.campaign }}</small></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></button>
        </div>
      </section>
      <section v-if="!showingSmallCatalogue" class="travel-section travel-favorites" :role="inset ? 'group' : undefined" aria-labelledby="travel-favorites-title">
        <header class="travel-section-head"><h2 id="travel-favorites-title">Favourites</h2><span>1–9 select</span></header>
        <div v-if="assignedShortcuts.length" class="travel-favorite-grid">
          <button v-for="(row, index) in assignedShortcuts" :id="`travel-favorite-${row.index}`" :key="row.index" :tabindex="inset ? -1 : undefined" :data-active="active === leadingDestinations.length + index || undefined" :role="inset ? 'option' : undefined" :aria-selected="inset ? active === leadingDestinations.length + index : undefined" @pointermove="moved($event) && (active = leadingDestinations.length + index)" type="button" class="travel-favorite ui-raised" :title="row.destination?.mapId === currentMapId ? `${row.destination?.name} · Current location` : row.destination?.name" :data-current="row.destination?.mapId === currentMapId || undefined" :disabled="travelPending || host.unavailable !== null || row.destination?.mapId === currentMapId" :aria-label="row.destination?.mapId === currentMapId ? `${row.destination?.name}, current location, shortcut ${row.index + 1}` : `Travel to ${row.destination?.name}, shortcut ${row.index + 1}`" @mousedown="keepSearchFocus" @click="pick($event, leadingDestinations.length + index)" @contextmenu="selectOnly($event, leadingDestinations.length + index)"><svg v-if="inset" class="travel-place-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 8-8 10-8-10 8-8Z"/><circle cx="12" cy="10" r="2.5"/></svg><template v-if="inset"><span>{{ row.destination && favoriteLabel(row.destination) }}</span><b>{{ row.index + 1 }}</b></template><template v-else><b>{{ row.index + 1 }}</b><span>{{ row.destination && favoriteLabel(row.destination) }}</span></template></button>
        </div>
        <div v-else class="ui-empty"><strong>No favourites yet</strong><p>Use the cog button to assign destinations to number keys.</p></div>
      </section>
    </section>

    <section v-else id="travel-customize-panel" class="ui-scroll travel-body travel-customize" role="region" aria-label="Travel settings" data-hub-form>
      <section class="travel-customize-group" aria-labelledby="travel-shortcuts-title">
        <header class="travel-section-head"><h2 id="travel-shortcuts-title">Number shortcuts</h2><span>1–9 select</span></header>
        <div class="travel-customize-shortcuts">
          <button v-for="row in shortcutRows" :key="row.index" type="button" class="travel-favorite ui-raised" :title="row.destination?.name" :data-empty="row.destination === null" :aria-pressed="editingShortcutSlot === row.index" :aria-label="row.destination === null ? `Assign shortcut ${row.index + 1}` : `Change shortcut ${row.index + 1}, ${row.destination.name}`" :disabled="preferenceControlsDisabled" @click="editShortcut(row.index)"><b>{{ row.index + 1 }}</b><span>{{ row.destination ? favoriteLabel(row.destination) : 'Assign' }}</span></button>
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
    <footer v-if="!footer || (statusText && !urgentNoticeVisible)" class="travel-footer"><span v-if="statusText && !urgentNoticeVisible" :data-level="statusLevel" aria-hidden="true">{{ statusText }}</span><template v-if="!footer"><span v-if="hasQuery && hasSelectableDestination" class="travel-key-hints"><kbd class="ui-kbd">↑↓</kbd> choose <kbd class="ui-kbd">↵</kbd> travel <kbd class="ui-kbd">⌘1–9</kbd> save <template v-if="inset"><kbd class="ui-kbd">⌘</kbd><kbd class="ui-kbd">⌫</kbd> back</template></span><span v-else-if="showingSmallCatalogue" class="travel-key-hints"><kbd class="ui-kbd">←→ ↑↓</kbd> choose <kbd class="ui-kbd">↵</kbd> travel <kbd class="ui-kbd">⌘1–9</kbd> save <template v-if="inset"><kbd class="ui-kbd">⌘</kbd><kbd class="ui-kbd">⌫</kbd> back</template></span><span v-else-if="mode === 'travel' && !hasQuery" class="travel-key-hints"><kbd class="ui-kbd">←→ ↑↓</kbd> choose <kbd class="ui-kbd">↵</kbd> travel <kbd class="ui-kbd">Esc</kbd> {{ inset && !hubParent ? "close" : "back" }} <template v-if="inset"><kbd class="ui-kbd">⌘</kbd><kbd class="ui-kbd">⌫</kbd> back</template></span><span v-else-if="mode === 'customize'" class="travel-key-hints"><kbd class="ui-kbd">Esc</kbd> back <template v-if="inset"><kbd class="ui-kbd">⌘</kbd><kbd class="ui-kbd">⌫</kbd> back</template></span><button v-if="mode === 'travel'" type="button" class="ui-button travel-primary" data-variant="primary" tabindex="-1" :disabled="!canRunActive" @mousedown="keepSearchFocus" @click="pickPrimary">{{ primaryLabel }}<kbd v-if="canRunActive" aria-hidden="true">↵</kbd></button></template></footer>
    <div v-if="!inset" class="travel-header-actions"><button ref="settingsButton" type="button" class="ui-button travel-close" data-icon aria-label="Customize Travel" title="Customize Travel" :aria-pressed="mode === 'customize'" aria-controls="travel-customize-panel" :disabled="preferenceControlsDisabled" @click="toggleCustomize"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="GEAR_PATH" /><circle cx="12" cy="12" r="3" /></svg></button><button type="button" class="ui-button travel-close" data-icon aria-label="Close Quick Travel" @click="emit('close')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button></div>
  </section>
</template>
