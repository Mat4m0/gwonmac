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
  type TradeSource,
} from "../../../src/shared/trade-chat";
import { useFloatingWindow } from "./use-floating-window";

const props = defineProps<{
  host: TradeHost;
  mode: "standalone" | "embedded";
  visible: boolean;
  active: boolean;
}>();
const emit = defineEmits<{ close: []; ready: [] }>();

type Intent = "all" | "selling" | "buying";
type SourceState = {
  status: TradeConnectionState;
  live: TradeMessage[];
  pending: TradeMessage[];
  search: TradeMessage[];
  selection: number | null;
};

const source = ref<TradeSource>("kamadan");
const intent = ref<Intent>("all");
const query = ref("");
const submittedQuery = ref("");
const searching = ref(false);
const searchProblem = ref("");
const notice = ref("");
const detailOpen = ref(false);
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
});

const current = computed(() => states[source.value]);
const sourceLabel = computed(() => source.value === "kamadan" ? "Kamadan" : "Pre-Searing");
const statusLabel = computed(() => ({
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  unavailable: "Unavailable",
})[current.value.status]);
const baseMessages = computed(() => submittedQuery.value
  ? current.value.search
  : current.value.live);
const filtered = computed(() => baseMessages.value.filter((message) => {
  const tags = messageIntents(message.message);
  return intent.value === "all" || tags.includes(intent.value);
}));
const visibleMessages = computed(() => filtered.value.slice(0, visibleLimit.value));
const selected = computed(() => {
  const timestamp = current.value.selection;
  return timestamp === null
    ? null
    : [...current.value.live, ...current.value.search, ...current.value.pending]
      .find((message) => message.timestamp === timestamp) ?? null;
});
const emptyHeading = computed(() => {
  if (searching.value) return "Searching the trade ledger…";
  if (searchProblem.value) return "Search could not finish";
  if (submittedQuery.value) return "No matching offers";
  if (current.value.status === "unavailable") return "Trade feed unavailable";
  return "Waiting for trade messages";
});

let requestRevision = 0;
let stopEvents: (() => void) | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
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
    ensureSelection(target, target.live);
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
    ensureSelection(current.value, current.value.live);
    return;
  }
  const revision = existingRevision ?? ++requestRevision;
  const requestedSource = source.value;
  searching.value = true;
  try {
    const result = await props.host.search({ source: requestedSource, query: trimmed });
    if (revision !== requestRevision || source.value !== requestedSource) return;
    current.value.search = [...result.messages];
    ensureSelection(current.value, current.value.search);
  } catch {
    if (revision === requestRevision) {
      current.value.search = [];
      searchProblem.value = "The feed did not answer. Check the connection and try again.";
    }
  } finally {
    if (revision === requestRevision) searching.value = false;
  }
}

function clearSearch(): void {
  query.value = "";
  submittedQuery.value = "";
  searchProblem.value = "";
  searching.value = false;
  visibleLimit.value = 25;
  requestRevision += 1;
  ensureSelection(current.value, current.value.live);
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
    target.live = sortNewest([event.message, ...target.live]).slice(0, TRADE_LIMITS.liveMessages);
  } else {
    target.pending = sortNewest([event.message, ...target.pending]);
  }
  ensureSelection(target, target.live);
}

function revealPending(): void {
  commitPending();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  nextTick(() => list.value?.scrollTo({
    top: 0,
    behavior: reducedMotion ? "auto" : "smooth",
  }));
}

function commitPending(): void {
  if (!current.value.pending.length) return;
  current.value.live = sortNewest([
    ...current.value.pending,
    ...current.value.live,
  ]).slice(0, TRADE_LIMITS.liveMessages);
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
  detailOpen.value = true;
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await props.host.copy(value);
    notice.value = `${label} copied`;
  } catch {
    notice.value = "Clipboard access was refused. Select the text and copy it manually.";
  }
  window.setTimeout(() => {
    if (notice.value.startsWith(label) || notice.value.startsWith("Clipboard")) notice.value = "";
  }, 3_000);
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
});
onBeforeUnmount(() => {
  requestRevision += 1;
  stopEvents?.();
  window.removeEventListener("keydown", onWindowKeydown);
  if (clock) clearInterval(clock);
  void props.host.unsubscribe();
});

function state(): SourceState {
  return { status: "unavailable", live: [], pending: [], search: [], selection: null };
}
function sortNewest(messages: TradeMessage[]): TradeMessage[] {
  return messages.sort((left, right) => right.timestamp - left.timestamp);
}
function ensureSelection(target: SourceState, messages: readonly TradeMessage[]): void {
  if (!messages.some((message) => message.timestamp === target.selection)) {
    target.selection = messages[0]?.timestamp ?? null;
  }
}
function removeReplacement(target: SourceState, timestamp: number | undefined): void {
  if (timestamp === undefined) return;
  target.live = target.live.filter((message) => message.timestamp !== timestamp);
  target.pending = target.pending.filter((message) => message.timestamp !== timestamp);
  target.search = target.search.filter((message) => message.timestamp !== timestamp);
}
function messageIntents(message: string): Intent[] {
  const selling = /(?:^|[^a-z0-9])wts(?:$|[^a-z0-9])/iu.test(message);
  const buying = /(?:^|[^a-z0-9])wtb(?:$|[^a-z0-9])/iu.test(message);
  return [selling ? "selling" : null, buying ? "buying" : null]
    .filter((value): value is Intent => value !== null);
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
        <div class="ui-segment intent-segment" data-fill aria-label="Offer intent">
          <button :aria-pressed="intent === 'all'" @click="intent = 'all'">All</button>
          <button :aria-pressed="intent === 'selling'" @click="intent = 'selling'">Selling</button>
          <button :aria-pressed="intent === 'buying'" @click="intent = 'buying'">Buying</button>
        </div>
      </div>

      <div class="trade-summary" aria-live="polite">
        <span>
          {{ submittedQuery ? `Results for “${submittedQuery}”` : "Latest messages" }}
        </span>
        <span>{{ filtered.length }} {{ filtered.length === 1 ? "offer" : "offers" }}</span>
      </div>

      <div class="trade-ledger ui-well">
        <div class="trade-columns" aria-hidden="true">
          <span>Intent</span><span>Character</span><span>Message</span><span>Age</span>
        </div>
        <button
          v-if="current.pending.length"
          class="ui-button pending-messages"
          data-variant="primary"
          @click="revealPending"
        >{{ current.pending.length }} new {{ current.pending.length === 1 ? "message" : "messages" }}</button>
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
          role="listbox"
          aria-label="Trade offers"
          @scroll="onListScroll"
          @keydown="onListKeydown"
        >
          <button
            v-for="message in visibleMessages"
            :key="message.timestamp"
            class="trade-row"
            role="option"
            :data-timestamp="message.timestamp"
            :aria-selected="current.selection === message.timestamp"
            @click="selectMessage(message)"
          >
            <span class="intent-cell">
              <span v-for="tag in messageIntents(message.message)" :key="tag" class="ui-chip" :data-intent="tag">
                {{ tag === "selling" ? "WTS" : "WTB" }}
              </span>
              <span v-if="!messageIntents(message.message).length" class="ui-chip">Other</span>
            </span>
            <bdi class="character-cell">{{ message.sender }}</bdi>
            <bdi class="message-cell">{{ message.message }}</bdi>
            <time class="age-cell" :datetime="new Date(message.timestamp).toISOString()">{{ age(message.timestamp) }}</time>
          </button>
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
              <time :datetime="new Date(selected.timestamp).toISOString()">{{ exactTime(selected.timestamp) }}</time>
            </div>
            <p><bdi>{{ selected.message }}</bdi></p>
          </div>
          <div class="inspector-actions">
            <button class="ui-button" data-variant="primary" @click="copy(selected.sender, 'Character name')">
              Copy character
            </button>
            <button class="ui-button" @click="copy(selected.message, 'Message')">Copy message</button>
            <button class="ui-link" @click="props.host.openSource(source)">Open {{ sourceLabel }} feed</button>
          </div>
        </template>
        <div v-else class="ui-empty">
          <strong>Choose an offer</strong>
          <p>The complete message and copy actions will appear here.</p>
        </div>
      </section>

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
