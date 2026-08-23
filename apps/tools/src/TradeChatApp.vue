<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  toRef,
  watch,
} from "vue";
import type { TradeHost } from "./trade-host";
import {
  TRADE_LIMITS,
  type TradeConnectionState,
  type TradeEvent,
  type TradeMessage,
  type TradeSearchMatch,
  type TradeSavedOffer,
  type TradeSavedState,
  type TradeSource,
} from "../../../src/shared/trade-chat";
import {
  insertTradeMessage,
  liveLedgerRows,
  searchLedgerRows,
  tradeMessageIntents,
  type TradeIntent,
} from "./trade-ledger";
import { useFloatingWindow } from "./use-floating-window";
import TradeIcon from "./TradeIcon.vue";

const props = defineProps<{
  host: TradeHost;
  mode: "standalone" | "embedded";
  visible: boolean;
  active: boolean;
}>();
const emit = defineEmits<{ close: []; ready: [] }>();

type SourceState = {
  status: TradeConnectionState;
  live: TradeMessage[];
  pending: TradeMessage[];
  search: TradeSearchMatch[];
  selection: number | null;
  savedSelection: number | null;
};

const source = ref<TradeSource>("kamadan");
const intent = ref<TradeIntent>("all");
const query = ref("");
const submittedQuery = ref("");
const searching = ref(false);
const searchProblem = ref("");
const notice = ref("");
const detailOpen = ref(false);
const savedOpen = ref(false);
const savedTab = ref<"offers" | "players">("offers");
const saved = ref<TradeSavedState>({ offers: [], players: [] });
const savedReady = ref(false);
const savedButton = ref<HTMLButtonElement | null>(null);
const savedClose = ref<HTMLButtonElement | null>(null);
const visibleLimit = ref(25);
const searchInput = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const states = reactive<Record<TradeSource, SourceState>>({
  kamadan: state(),
  "pre-searing": state(),
});
const { panel, resizeGrip, panelStyle, startDrag } = useFloatingWindow({
  mode: props.mode,
  visible: toRef(props, "visible"),
  initialPosition: { left: 64, top: 54 },
  minWidth: 520,
  minHeight: 400,
  viewportMargin: 32,
});

const current = computed(() => states[source.value]);
const sourceLabel = computed(() => source.value === "kamadan" ? "Kamadan" : "Pre-Searing");
const statusLabel = computed(() => ({
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  unavailable: "Unavailable",
})[current.value.status]);
const displayedRows = computed(() => submittedQuery.value
  ? searchLedgerRows(current.value.search, intent.value)
  : liveLedgerRows(current.value.live, intent.value));
const filtered = computed(() => displayedRows.value.map((row) => row.message));
const visibleMessages = computed(() => filtered.value.slice(0, visibleLimit.value));
const selected = computed(() => {
  const timestamp = current.value.selection;
  return timestamp === null
    ? null
    : current.value.savedSelection === timestamp
      ? saved.value.offers.find((offer) =>
          offer.source === source.value && offer.timestamp === timestamp
        ) ?? null
      : displayedRows.value.find((row) => row.message.timestamp === timestamp)?.message ?? null;
});
const savedCount = computed(() => saved.value.offers.length + saved.value.players.length);
const emptyHeading = computed(() => {
  if (searching.value) return "Searching the trade ledger…";
  if (searchProblem.value) return "Search could not finish";
  if (submittedQuery.value) return "No matching offers";
  if (current.value.status === "unavailable") return "Trade feed unavailable";
  return "Waiting for trade messages";
});

function groupedPostCount(message: TradeMessage): number {
  return displayedRows.value.find((row) => row.message.timestamp === message.timestamp)?.postCount ?? 1;
}

let requestRevision = 0;
let stopEvents: (() => void) | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let noticeTimer: number | null = null;
let savedRevision = 0;
let confirmedSaved: TradeSavedState = { offers: [], players: [] };
let savedWrites = Promise.resolve();
const now = ref(Date.now());

async function subscribe(next: TradeSource): Promise<void> {
  const revision = ++requestRevision;
  searchProblem.value = "";
  const target = states[next];
  target.status = target.live.length ? "reconnecting" : "connecting";
  try {
    const snapshot = await props.host.subscribe(next);
    if (revision !== requestRevision || source.value !== next || !props.visible) return;
    target.status = snapshot.status;
    target.live = [...snapshot.messages];
    ensureSelection(target, displayedRows.value.map((row) => row.message), next);
    emit("ready");
    if (submittedQuery.value) await runSearch(revision);
  } catch {
    if (revision === requestRevision) target.status = "unavailable";
  }
}

async function runSearch(existingRevision?: number): Promise<void> {
  const trimmed = query.value.trim();
  submittedQuery.value = trimmed;
  visibleLimit.value = 25;
  searchProblem.value = "";
  if (!trimmed) {
    searching.value = false;
    ensureSelection(current.value, current.value.live, source.value);
    return;
  }
  const revision = existingRevision ?? ++requestRevision;
  const requestedSource = source.value;
  searching.value = true;
  try {
    const result = await props.host.search({ source: requestedSource, query: trimmed });
    if (revision !== requestRevision || source.value !== requestedSource) return;
    current.value.search = [...result.matches];
    ensureSelection(
      current.value,
      current.value.search.map((match) => match.message),
      source.value,
    );
  } catch {
    if (revision === requestRevision) {
      current.value.search = [];
      searchProblem.value = "The feed did not answer. Check the connection and try again.";
    }
  } finally {
    if (revision === requestRevision) searching.value = false;
  }
}

function onQueryInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  if (!value.trim() && submittedQuery.value) clearSearch();
}

function clearSearch(): void {
  query.value = "";
  submittedQuery.value = "";
  searchProblem.value = "";
  searching.value = false;
  visibleLimit.value = 25;
  requestRevision += 1;
  ensureSelection(current.value, current.value.live, source.value);
}

function onTradeEvent(event: TradeEvent): void {
  const target = states[event.source];
  if (event.type === "status") {
    target.status = event.status;
    return;
  }
  removeReplacement(target, event.message.replacementTimestamp);
  if ([...target.live, ...target.pending].some(
    (candidate) => candidate.timestamp === event.message.timestamp,
  )) return;
  const nearTop = event.source !== source.value || !list.value || list.value.scrollTop < 36;
  if (nearTop) {
    target.live = insertTradeMessage(target.live, event.message);
  } else {
    target.pending = insertTradeMessage(target.pending, event.message);
  }
  ensureSelection(target, target.live, event.source);
}

function commitPending(): void {
  if (!current.value.pending.length) return;
  current.value.live = current.value.pending.reduce(
    (messages, message) => insertTradeMessage(messages, message),
    current.value.live,
  );
  current.value.pending = [];
}

function onListScroll(event: Event): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  if (target.scrollTop <= 2) commitPending();
  const remaining = target.scrollHeight - target.clientHeight - target.scrollTop;
  if (remaining <= 96 && visibleLimit.value < filtered.value.length) {
    visibleLimit.value = Math.min(visibleLimit.value + 25, TRADE_LIMITS.searchResults);
  }
}

function selectMessage(message: TradeMessage): void {
  current.value.selection = message.timestamp;
  current.value.savedSelection = null;
  detailOpen.value = true;
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await props.host.copy(value);
    showNotice(`${label} copied`);
  } catch {
    showNotice("Clipboard access was refused. Select the text and copy it manually.");
  }
}

function showNotice(message: string): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  notice.value = message;
  noticeTimer = window.setTimeout(() => { notice.value = ""; }, 3_000);
}

function offerSaved(message: TradeMessage): boolean {
  return saved.value.offers.some((offer) =>
    offer.source === message.source && offer.timestamp === message.timestamp
  );
}

function playerSaved(sender: string): boolean {
  const key = sender.toLocaleLowerCase();
  return saved.value.players.some((player) => player.sender.toLocaleLowerCase() === key);
}

function save(next: TradeSavedState, success: string): void {
  const revision = ++savedRevision;
  saved.value = next;
  savedWrites = savedWrites.then(async () => {
    try {
      confirmedSaved = await props.host.setSaved(next);
      if (revision === savedRevision) saved.value = confirmedSaved;
      showNotice(success);
    } catch {
      if (revision === savedRevision) saved.value = confirmedSaved;
      showNotice("Saved items could not be updated. Try again.");
    }
  });
}

function toggleOffer(message: TradeMessage): void {
  if (!savedReady.value) return;
  const exists = offerSaved(message);
  const offers = exists
    ? saved.value.offers.filter((offer) =>
      offer.source !== message.source || offer.timestamp !== message.timestamp
    )
    : [{ ...message, savedAt: Date.now() }, ...saved.value.offers]
      .slice(0, TRADE_LIMITS.savedOffers);
  save({ ...saved.value, offers }, exists ? "Offer removed" : "Offer saved");
}

function togglePlayer(sender: string): void {
  if (!savedReady.value) return;
  const key = sender.toLocaleLowerCase();
  const exists = playerSaved(sender);
  const players = exists
    ? saved.value.players.filter((player) => player.sender.toLocaleLowerCase() !== key)
    : [{ sender, savedAt: Date.now() }, ...saved.value.players]
      .slice(0, TRADE_LIMITS.savedPlayers);
  save({ ...saved.value, players }, exists ? "Player unfollowed" : "Player followed");
}

function openSaved(): void {
  savedOpen.value = true;
  nextTick(() => savedClose.value?.focus());
}

function closeSaved(): void {
  savedOpen.value = false;
  nextTick(() => savedButton.value?.focus());
}

async function inspectSavedOffer(offer: TradeSavedOffer): Promise<void> {
  states[offer.source].selection = offer.timestamp;
  states[offer.source].savedSelection = offer.timestamp;
  if (source.value !== offer.source) {
    source.value = offer.source;
    await nextTick();
  }
  detailOpen.value = true;
  savedOpen.value = false;
}

function findPlayer(sender: string): void {
  query.value = sender;
  savedOpen.value = false;
  void runSearch();
}

function currentOffersFor(sender: string): number {
  const key = sender.toLocaleLowerCase();
  return current.value.live.filter((message) => message.sender.toLocaleLowerCase() === key).length;
}

function onListKeydown(event: KeyboardEvent): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = visibleMessages.value;
  if (!rows.length) return;
  event.preventDefault();
  const index = rows.findIndex((message) => message.timestamp === current.value.selection);
  const next = event.key === "ArrowDown"
    ? Math.min(rows.length - 1, index + 1)
    : Math.max(0, index < 0 ? 0 : index - 1);
  selectMessage(rows[next]!);
  nextTick(() => {
    list.value?.querySelector<HTMLElement>(`[data-timestamp="${rows[next]!.timestamp}"]`)
      ?.focus({ preventScroll: false });
  });
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (!props.visible || !props.active) return;
  if (event.key === "Escape" && savedOpen.value) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeSaved();
    return;
  }
  if (
    event.key === "/"
    && !(event.target instanceof HTMLInputElement)
    && !(event.target instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault();
    searchInput.value?.focus();
  }
}

watch(source, (next) => {
  detailOpen.value = false;
  visibleLimit.value = 25;
  if (props.visible) void subscribe(next);
});
watch(displayedRows, (rows) => {
  ensureSelection(current.value, rows.map((row) => row.message), source.value);
});
watch(() => props.visible, (visible) => {
  if (visible) void subscribe(source.value);
  else {
    requestRevision += 1;
    void props.host.unsubscribe();
  }
});

onMounted(() => {
  stopEvents = props.host.onEvent(onTradeEvent);
  window.addEventListener("keydown", onWindowKeydown);
  clock = setInterval(() => { now.value = Date.now(); }, 30_000);
  if (props.visible) void subscribe(source.value);
  void props.host.getSaved().then((value) => {
    confirmedSaved = value;
    saved.value = value;
    savedReady.value = true;
  }).catch(() => {
    showNotice("Saved items are unavailable for this session.");
  });
});
onBeforeUnmount(() => {
  requestRevision += 1;
  stopEvents?.();
  window.removeEventListener("keydown", onWindowKeydown);
  if (clock) clearInterval(clock);
  if (noticeTimer) clearTimeout(noticeTimer);
  void props.host.unsubscribe();
});

function state(): SourceState {
  return {
    status: "unavailable",
    live: [],
    pending: [],
    search: [],
    selection: null,
    savedSelection: null,
  };
}
function ensureSelection(
  target: SourceState,
  messages: readonly TradeMessage[],
  targetSource: TradeSource,
): void {
  if (target.savedSelection !== null && saved.value.offers.some((offer) =>
    offer.source === targetSource && offer.timestamp === target.savedSelection
  )) return;
  target.savedSelection = null;
  if (!messages.some((message) => message.timestamp === target.selection)) {
    target.selection = messages[0]?.timestamp ?? null;
  }
}
function removeReplacement(target: SourceState, timestamp: number | undefined): void {
  if (timestamp === undefined) return;
  target.live = target.live.filter((message) => message.timestamp !== timestamp);
  target.pending = target.pending.filter((message) => message.timestamp !== timestamp);
  target.search = target.search.filter(({ message }) => message.timestamp !== timestamp);
}
function age(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((now.value - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
function exactTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" })
    .format(timestamp);
}
</script>

<template>
  <!--
    THESIS: trade discovery is a working ledger, not a chat transcript or build tab.
    OWN-WORLD: GWonMac ivory metal, recessed black wells, blue-black selection, quiet gilt.
    STORY: choose a market, scan intent and age, inspect one offer, copy what is useful.
    FIRST VIEWPORT: source and search above a full-width ledger; exact detail docks below.
    FORM: approved concept 5, production seed trade-ledger-v1.
    FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.
  -->
  <div
    v-show="visible"
    class="tools-stage trade-stage"
    :data-mode="mode"
    :data-detail-open="detailOpen ? '' : undefined"
  >
    <section
      ref="panel"
      class="ui-frame ui-panel tools-window trade-window"
      :style="panelStyle"
      role="dialog"
      aria-label="Trade Chat"
      data-design-contract="trade-ledger-v1"
    >
      <header class="ui-panel-head ui-window-head window-bar" @pointerdown="startDrag">
        <div class="window-brand trade-brand" aria-hidden="true">T</div>
        <div class="window-identity">
          <h1 class="ui-panel-title">{{ sourceLabel }} Trade</h1>
          <p class="ui-field-hint">Public trade feed · listings are posted in Guild Wars</p>
        </div>
        <span class="trade-status" :data-state="current.status" role="status">
          <i aria-hidden="true" />{{ statusLabel }}
        </span>
        <button
          v-if="mode === 'embedded'"
          class="ui-button window-close"
          data-icon
          aria-label="Close Trade Chat"
          @click="emit('close')"
        >×</button>
      </header>

      <div class="trade-toolbar">
        <div class="ui-segment source-segment" data-fill aria-label="Trade source">
          <button :aria-pressed="source === 'kamadan'" @click="source = 'kamadan'">Kamadan</button>
          <button :aria-pressed="source === 'pre-searing'" @click="source = 'pre-searing'">Pre-Searing</button>
        </div>
        <form class="trade-search" role="search" @submit.prevent="runSearch()">
          <label class="ui-input-group">
            <span class="ui-sr-only">Search offers or character names</span>
            <input
              ref="searchInput"
              v-model="query"
              @input="onQueryInput"
              type="search"
              maxlength="128"
              placeholder="Search offers or character names"
              spellcheck="false"
            >
            <kbd class="ui-kbd">/</kbd>
          </label>
          <button class="ui-button" data-variant="primary" :disabled="searching || !query.trim()">
            {{ searching ? "Searching…" : "Search" }}
          </button>
          <button v-if="submittedQuery" type="button" class="ui-button" @click="clearSearch">Live feed</button>
        </form>
        <div class="trade-toolbar-actions">
          <div class="ui-segment intent-segment" data-fill aria-label="Offer intent">
            <button :aria-pressed="intent === 'all'" @click="intent = 'all'">All</button>
            <button :aria-pressed="intent === 'selling'" @click="intent = 'selling'">Selling</button>
            <button :aria-pressed="intent === 'buying'" @click="intent = 'buying'">Buying</button>
          </div>
          <button
            ref="savedButton"
            class="ui-button saved-trigger"
            :aria-expanded="savedOpen"
            aria-controls="trade-saved-drawer"
            :disabled="!savedReady"
            @click="savedOpen ? closeSaved() : openSaved()"
          ><TradeIcon name="star" :filled="savedCount > 0" /> Saved <span class="saved-count">{{ savedCount }}</span></button>
        </div>
      </div>

      <div class="trade-summary" aria-live="polite">
        <span>
          {{ submittedQuery ? `Results for “${submittedQuery}”` : "Latest messages" }}
        </span>
        <span>
          {{ filtered.length }}
          {{ submittedQuery ? (filtered.length === 1 ? "trader" : "traders") : (filtered.length === 1 ? "offer" : "offers") }}
        </span>
      </div>

      <div class="trade-ledger ui-well">
        <div class="trade-columns" aria-hidden="true">
          <span>Intent</span><span>Character</span><span>Message</span><span>Age</span>
        </div>
        <div
          v-if="searching || (!visibleMessages.length && (current.status === 'connecting' || current.status === 'reconnecting'))"
          class="trade-state"
          role="status"
        >
          <div class="trade-skeleton" /><div class="trade-skeleton" /><div class="trade-skeleton" />
          <p>{{ current.status === "reconnecting" ? "Reconnecting — showing saved session messages when available." : emptyHeading }}</p>
        </div>
        <div v-else-if="!visibleMessages.length" class="trade-state">
          <strong>{{ emptyHeading }}</strong>
          <p v-if="searchProblem">{{ searchProblem }}</p>
          <p v-else-if="submittedQuery">Try a shorter item name, character name, or another intent.</p>
          <p v-else>Messages will appear here as soon as the public feed answers.</p>
          <button
            v-if="current.status === 'unavailable' || searchProblem"
            class="ui-button"
            @click="props.host.retry(source); subscribe(source)"
          >Try again</button>
        </div>
        <div
          v-else
          ref="list"
          class="trade-list ui-scroll"
          role="list"
          aria-label="Trade offers"
          @scroll="onListScroll"
          @keydown="onListKeydown"
        >
          <div
            v-for="message in visibleMessages"
            :key="message.timestamp"
            class="trade-row-shell"
            role="listitem"
          >
            <button
              class="trade-row"
              :data-timestamp="message.timestamp"
              :data-saved-offer="offerSaved(message) ? '' : undefined"
              :data-saved-player="playerSaved(message.sender) ? '' : undefined"
              :aria-current="current.selection === message.timestamp ? 'true' : undefined"
              @click="selectMessage(message)"
            >
              <span class="intent-cell">
                <span v-if="offerSaved(message)" class="saved-mark" aria-label="Saved offer"><TradeIcon name="star" filled /></span>
                <span v-for="tag in tradeMessageIntents(message.message)" :key="tag" class="ui-chip" :data-intent="tag">
                  {{ tag === "selling" ? "WTS" : "WTB" }}
                </span>
                <span v-if="!tradeMessageIntents(message.message).length" class="ui-chip">Other</span>
              </span>
              <span class="character-cell">
                <span v-if="playerSaved(message.sender)" class="followed-mark" aria-label="Followed player"><TradeIcon name="player" filled /></span>
                <bdi>{{ message.sender }}</bdi>
                <span
                  v-if="groupedPostCount(message) > 1"
                  class="group-count"
                  :aria-label="`Latest of ${groupedPostCount(message)} matching posts`"
                >{{ groupedPostCount(message) }} posts</span>
              </span>
              <bdi class="message-cell">{{ message.message }}</bdi>
              <time class="age-cell" :datetime="new Date(message.timestamp).toISOString()">{{ age(message.timestamp) }}</time>
            </button>
            <div class="row-quick-actions">
              <button
                class="row-quick-action"
                :aria-label="`${offerSaved(message) ? 'Remove saved' : 'Save'} offer from ${message.sender}`"
                :aria-pressed="offerSaved(message)"
                :disabled="!savedReady"
                :title="offerSaved(message) ? 'Remove saved offer' : 'Save offer'"
                @click="toggleOffer(message)"
              ><TradeIcon name="star" :filled="offerSaved(message)" /></button>
              <button
                class="row-quick-action"
                :aria-label="`${playerSaved(message.sender) ? 'Unfollow' : 'Follow'} ${message.sender}`"
                :aria-pressed="playerSaved(message.sender)"
                :disabled="!savedReady"
                :title="playerSaved(message.sender) ? 'Unfollow player' : 'Follow player'"
                @click="togglePlayer(message.sender)"
              ><TradeIcon name="player" :filled="playerSaved(message.sender)" /></button>
            </div>
          </div>
          <button
            v-if="visibleLimit < filtered.length"
            class="ui-button load-more"
            @click="visibleLimit = Math.min(visibleLimit + 25, 200)"
          >Load 25 more</button>
        </div>
      </div>

      <section class="trade-inspector ui-raised ui-scroll" :aria-label="selected ? `Offer from ${selected.sender}` : 'Offer detail'">
        <button class="ui-button mobile-back" @click="detailOpen = false">Back to offers</button>
        <template v-if="selected">
          <div class="inspector-copy">
            <div class="inspector-meta">
              <bdi>{{ selected.sender }}</bdi>
              <span>
                <small v-if="groupedPostCount(selected) > 1">
                  Latest of {{ groupedPostCount(selected) }} matching posts
                </small>
                <time :datetime="new Date(selected.timestamp).toISOString()">{{ exactTime(selected.timestamp) }}</time>
              </span>
            </div>
            <p><bdi>{{ selected.message }}</bdi></p>
          </div>
          <div class="inspector-actions">
            <button
              class="ui-button"
              :aria-pressed="offerSaved(selected)"
              :disabled="!savedReady"
              @click="toggleOffer(selected)"
            ><TradeIcon name="star" :filled="offerSaved(selected)" />{{ offerSaved(selected) ? "Saved" : "Save" }}</button>
            <button
              class="ui-button"
              :aria-pressed="playerSaved(selected.sender)"
              :disabled="!savedReady"
              @click="togglePlayer(selected.sender)"
            ><TradeIcon name="player" :filled="playerSaved(selected.sender)" />{{ playerSaved(selected.sender) ? "Following" : "Follow" }}</button>
            <button class="ui-button" data-variant="primary" @click="copy(selected.sender, 'Character name')">
              Copy name
            </button>
            <button class="ui-button" @click="copy(selected.message, 'Message')">Copy text</button>
            <button class="ui-link" @click="props.host.openSource(source)">{{ sourceLabel }} feed ↗</button>
          </div>
        </template>
        <div v-else class="ui-empty">
          <strong>Choose an offer</strong>
          <p>The complete message and copy actions will appear here.</p>
        </div>
      </section>

      <Transition name="saved-drawer">
        <aside
          v-if="savedOpen"
          id="trade-saved-drawer"
          class="trade-saved-drawer ui-drawer ui-raised"
          role="complementary"
          aria-label="Saved trade items"
          @keydown.esc.stop.prevent="closeSaved"
        >
          <header class="saved-drawer-head ui-drawer-head">
            <div>
              <strong>Saved</strong>
              <span>{{ savedCount }} {{ savedCount === 1 ? "item" : "items" }}</span>
            </div>
            <button ref="savedClose" class="ui-button" data-icon aria-label="Close Saved" @click="closeSaved">×</button>
          </header>
          <div class="ui-segment saved-tabs" data-fill aria-label="Saved item type">
            <button :aria-pressed="savedTab === 'offers'" @click="savedTab = 'offers'">Offers {{ saved.offers.length }}</button>
            <button :aria-pressed="savedTab === 'players'" @click="savedTab = 'players'">Players {{ saved.players.length }}</button>
          </div>
          <div class="saved-drawer-body ui-scroll">
            <template v-if="savedTab === 'offers'">
              <div v-if="!saved.offers.length" class="ui-empty">
                <strong>No saved offers</strong>
                <p>Save an offer from its detail panel to keep a local copy.</p>
              </div>
              <article v-for="offer in saved.offers" :key="`${offer.source}:${offer.timestamp}`" class="saved-card">
                <button class="saved-card-main" @click="inspectSavedOffer(offer)">
                  <span><bdi>{{ offer.sender }}</bdi><small>{{ offer.source === "kamadan" ? "Kamadan" : "Pre-Searing" }} · saved {{ age(offer.savedAt) }}</small></span>
                  <bdi>{{ offer.message }}</bdi>
                </button>
                <button class="saved-remove" aria-label="Remove saved offer" @click="toggleOffer(offer)"><TradeIcon name="star" filled /></button>
              </article>
            </template>
            <template v-else>
              <div v-if="!saved.players.length" class="ui-empty">
                <strong>No followed players</strong>
                <p>Follow a player to highlight every offer they post.</p>
              </div>
              <article v-for="player in saved.players" :key="player.sender.toLocaleLowerCase()" class="saved-card saved-player-card">
                <button class="saved-card-main" @click="findPlayer(player.sender)">
                  <span><bdi><TradeIcon name="player" filled />{{ player.sender }}</bdi><small>{{ currentOffersFor(player.sender) }} current {{ currentOffersFor(player.sender) === 1 ? "offer" : "offers" }} in {{ sourceLabel }}</small></span>
                </button>
                <button class="saved-remove" :aria-label="`Unfollow ${player.sender}`" @click="togglePlayer(player.sender)"><TradeIcon name="player" filled /></button>
              </article>
            </template>
          </div>
        </aside>
      </Transition>

      <Transition name="notice">
        <div v-if="notice" class="ui-toast trade-notice" role="status">{{ notice }}</div>
      </Transition>
      <button
        v-if="mode === 'embedded'"
        ref="resizeGrip"
        type="button"
        class="ui-resize-grip"
        aria-label="Resize Trade Chat"
      />
    </section>
  </div>
</template>
