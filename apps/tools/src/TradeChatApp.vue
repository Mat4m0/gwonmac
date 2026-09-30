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
  type TradeSavedOffer,
  type TradeSavedState,
  type TradeSource,
} from "../../../src/shared/trade-chat";
import {
  insertTradeMessage,
  tradeLedgerRows,
  tradeMatchSegments,
  tradeMessageIntents,
  tradeTextMatches,
  type TradeIntent,
} from "./trade-ledger";
import { useClassicFrame } from "./ui/use-classic-frame";
import { listIndexAfter, listKeyStep, listPage } from "../../../src/shared/ui/list-keys";
import { isHubBackKey } from "../../../src/shared/keyboard-shortcuts";
import { useFloatingWindow } from "./use-floating-window";
import TradeIcon from "./TradeIcon.vue";
import TraderPrices from "./components/TraderPrices.vue";


const props = defineProps<{
  host: TradeHost;
  mode: "standalone" | "embedded";
  visible: boolean;
}>();
const emit = defineEmits<{ close: []; ready: [] }>();

type SourceState = {
  status: TradeConnectionState;
  live: TradeMessage[];
  pending: TradeMessage[];
  search: TradeMessage[];
  selection: number | null;
  savedSelection: number | null;
};

type PlayerReturnState = {
  scrollTop: number;
  selection: number | null;
  visibleLimit: number;
  focusTimestamp: number | null;
};

defineExpose({
  search(value: string) { query.value = value; view.value = "listings"; void runSearch(); },
  /** Escape's step: Trade's inner levels, then a typed search. */
  stepBack: () => stepBack(true),
});

const source = ref<TradeSource>("kamadan");
const view = ref<"listings" | "prices">("listings");
const pricesOpened = ref(false);
const intent = ref<TradeIntent>("all");
const query = ref("");
const submittedQuery = ref("");
const searching = ref(false);
const searchProblem = ref("");
const playerName = ref("");
const playerMessages = ref<TradeMessage[]>([]);
const playerSearching = ref(false);
const playerProblem = ref("");
const playerReturn = ref<PlayerReturnState | null>(null);
const notice = ref<{ text: string; tone: "success" | "warning" | "error"; copyFor?: "Character name" | "Offer" } | null>(null);
const detailOpen = ref(false);
const savedOpen = ref(false);
const savedTab = ref<"offers" | "players">("offers");
const saved = ref<TradeSavedState>({ offers: [], players: [] });
const savedReady = ref(false);
const savedButton = ref<HTMLButtonElement | null>(null);
const pricesButton = ref<HTMLButtonElement | null>(null);
const savedClose = ref<HTMLButtonElement | null>(null);
const playerBack = ref<HTMLButtonElement | null>(null);
const offerActions = ref<HTMLDetailsElement | null>(null);
const visibleLimit = ref(25);
const searchInput = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
/** A ledger row holds the keyboard, so ↵ and ⌘↵ act on the selected offer. */
const rowFocused = ref(false);
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
  placementStorageKey: "gwonmac.trade-window-placement",
});

const whispersEnabled = ref(false);
const updateWhispersEnabled = () => { whispersEnabled.value = !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().whispersEnabled; };

const current = computed(() => states[source.value]);
const sourceLabel = computed(() => source.value === "kamadan" ? "Kamadan" : "Pre-Searing");
const statusLabel = computed(() => ({
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  unavailable: "Unavailable",
})[current.value.status]);
const sourceMessages = computed(() => playerName.value
  ? playerMessages.value
  : submittedQuery.value
    ? current.value.search
    : current.value.live);
/**
 * Typed words narrow the loaded rows on every keystroke; ↵ searches the whole feed
 * (D-10). Once submitted, the same words are the search itself, not a second filter.
 */
const typedFilter = computed(() => {
  const text = query.value.trim();
  return text === submittedQuery.value ? "" : text;
});
const textMatches = computed(() => tradeTextMatches(sourceMessages.value, typedFilter.value));
const filtered = computed(() => tradeLedgerRows(textMatches.value, intent.value));
const hiddenByIntent = computed(() => textMatches.value.length - filtered.value.length);
const highlight = computed(() => typedFilter.value || (playerName.value ? "" : submittedQuery.value));
const visibleMessages = computed(() => filtered.value.slice(0, visibleLimit.value));
/**
 * The offer the inspector and ↵ address: the selected row while it is shown, or the
 * saved offer the player opened. Never another seller in its place (HUB-013).
 */
const selected = computed(() => {
  const timestamp = current.value.selection;
  return timestamp === null
    ? null
    : current.value.savedSelection === timestamp
      ? saved.value.offers.find((offer) =>
          offer.source === source.value && offer.timestamp === timestamp
        ) ?? null
      : filtered.value.find((message) => message.timestamp === timestamp) ?? null;
});
/** The one ledger row in the Tab order: the selected row, else the first. */
const tabStop = computed(() => visibleMessages.value.some((message) => message.timestamp === current.value.selection)
  ? current.value.selection
  : visibleMessages.value[0]?.timestamp ?? null);
const savedCount = computed(() => saved.value.offers.length + saved.value.players.length);
const intentLabel = computed(() => intent.value === "selling" ? "Selling" : "Buying");
const summaryLabel = computed(() => {
  const base = submittedQuery.value ? `Results for “${submittedQuery.value}”` : "Latest messages";
  return typedFilter.value ? `${base} with “${typedFilter.value}”` : base;
});
const emptyHeading = computed(() => {
  if (playerProblem.value) return "Player listings could not load";
  if (searchProblem.value) return "Search could not finish";
  if (hiddenByIntent.value) return `${hiddenByIntent.value} ${hiddenByIntent.value === 1 ? "offer" : "offers"} hidden by ${intentLabel.value}`;
  if (typedFilter.value) return `No loaded offers match “${typedFilter.value}”`;
  if (playerName.value) return `No listings from ${playerName.value}`;
  if (submittedQuery.value) return "No matching offers";
  if (current.value.status === "unavailable") return "Trade feed unavailable";
  return "Waiting for trade messages";
});
const loadingLabel = computed(() => {
  if (playerSearching.value) return `Finding listings from ${playerName.value}…`;
  if (searching.value) return `Searching ${sourceLabel.value} history…`;
  return current.value.status === "reconnecting"
    ? `Reconnecting to ${sourceLabel.value}…`
    : `Connecting to ${sourceLabel.value}…`;
});

let requestRevision = 0;
let subscriptionRevision = 0;
// A submitted search waits for the socket; merely showing the ledger is not a search.
let searchQueued = false;
let stopEvents: (() => void) | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let noticeTimer: number | null = null;
let savedRevision = 0;
let confirmedSaved: TradeSavedState = { offers: [], players: [] };
let savedWrites = Promise.resolve();
const now = ref(Date.now());

/**
 * Trade is a non-activating surface: a click on its chrome leaves the keyboard with
 * the game. Closing a level hands focus back inside Trade only while Trade holds it,
 * so an Escape or a click from the game never moves the game's keyboard into Trade.
 */
function ownsFocus(): boolean {
  return panel.value?.contains(document.activeElement) ?? false;
}

/** The keyboard lands on a named Trade control once the view has rendered (HUB-025). */
function focusAfterRender(target: () => HTMLElement | null | undefined): void {
  void nextTick(() => target()?.focus());
}

function rowElement(timestamp: number | null | undefined): HTMLElement | null {
  return timestamp === null || timestamp === undefined
    ? null
    : list.value?.querySelector<HTMLElement>(`[data-timestamp="${timestamp}"]`) ?? null;
}

function focusRow(timestamp: number | null | undefined): void {
  focusAfterRender(() => rowElement(timestamp));
}

function focusSearch(): void {
  const input = searchInput.value;
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/** At narrow widths the offer inspector is a sheet over the ledger, and the column header is hidden. */
function narrow(): boolean {
  return (panel.value?.querySelector(".trade-columns")?.getClientRects().length ?? 1) === 0;
}

async function subscribe(next: TradeSource): Promise<void> {
  const revision = ++subscriptionRevision;
  const target = states[next];
  target.status = target.live.length ? "reconnecting" : "connecting";
  try {
    const snapshot = await props.host.subscribe(next);
    if (revision !== subscriptionRevision || source.value !== next || !props.visible) return;
    target.status = snapshot.status;
    target.live = [...snapshot.messages];
    if (!submittedQuery.value && !playerName.value) keepOrSelectFirst(target, filtered.value);
    emit("ready");
    void sendQueuedSearch();
  } catch {
    if (revision === subscriptionRevision) target.status = "unavailable";
  }
}

async function runSearch(): Promise<void> {
  requestRevision += 1;
  searchQueued = false;
  resetPlayerView();
  detailOpen.value = false;
  current.value.savedSelection = null;
  const trimmed = query.value.trim();
  submittedQuery.value = trimmed;
  visibleLimit.value = 25;
  searchProblem.value = "";
  if (!trimmed) {
    searching.value = false;
    keepOrSelectFirst(current.value, filtered.value);
    return;
  }
  searching.value = true;
  searchQueued = true;
  await sendQueuedSearch();
}

async function sendQueuedSearch(): Promise<void> {
  if (!searchQueued || !props.visible || current.value.status !== "live") return;
  searchQueued = false;
  const revision = requestRevision;
  const requestedSource = source.value;
  try {
    const result = await props.host.search({
      source: requestedSource,
      query: submittedQuery.value,
      scope: "all",
    });
    if (revision !== requestRevision || source.value !== requestedSource) return;
    current.value.search = [...result.messages];
    // A new submission starts on its first result.
    current.value.selection = filtered.value[0]?.timestamp ?? null;
  } catch {
    if (revision === requestRevision) {
      current.value.search = [];
      searchProblem.value = "The feed did not answer. Check the connection and try again.";
    }
  } finally {
    if (revision === requestRevision) searching.value = false;
  }
}

function retrySearch(): void {
  if (submittedQuery.value) void runSearch();
  if (current.value.status !== "live") void props.host.retry(source.value);
}

function onQueryInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  if (!value.trim() && submittedQuery.value) clearSearch();
}

function clearSearch(): void {
  resetPlayerView();
  detailOpen.value = false;
  query.value = "";
  submittedQuery.value = "";
  searchProblem.value = "";
  searching.value = false;
  searchQueued = false;
  visibleLimit.value = 25;
  requestRevision += 1;
  current.value.savedSelection = null;
  keepOrSelectFirst(current.value, filtered.value);
}

function sameSender(left: TradeMessage | undefined, right: TradeMessage): boolean {
  return left?.sender.toLocaleLowerCase() === right.sender.toLocaleLowerCase();
}

/**
 * A re-post replaces the seller's older message. The selection follows it only to the
 * same seller and only once the new row is shown; other arrivals never move the
 * selection or the keyboard (HUB-013).
 */
function followReplacement(target: SourceState, message: TradeMessage, replaced: TradeMessage | undefined): void {
  if (target.selection !== message.replacementTimestamp || !sameSender(replaced, message)) return;
  const focused = document.activeElement instanceof HTMLElement
    && document.activeElement.dataset.timestamp === String(message.replacementTimestamp);
  target.selection = message.timestamp;
  if (focused) focusRow(message.timestamp);
}

function onTradeEvent(event: TradeEvent): void {
  const target = states[event.source];
  if (event.type === "status") {
    target.status = event.status;
    if (event.source === source.value) void sendQueuedSearch();
    return;
  }
  const message = event.message;
  const replacedAt = message.replacementTimestamp;
  const replaced = replacedAt === undefined ? undefined
    : [...target.live, ...target.pending, ...target.search, ...playerMessages.value]
      .find((candidate) => candidate.timestamp === replacedAt);
  if (replacedAt !== undefined) {
    // Search results and a player's listings are snapshots: a re-post updates its row in place.
    const inPlace = (messages: readonly TradeMessage[]) =>
      messages.map((candidate) => candidate.timestamp === replacedAt ? message : candidate);
    target.search = inPlace(target.search);
    if (event.source === source.value) playerMessages.value = inPlace(playerMessages.value);
  }
  if ([...target.live, ...target.pending].some((candidate) => candidate.timestamp === message.timestamp)) {
    followReplacement(target, message, replaced);
    return;
  }
  const readingLive = event.source === source.value && !submittedQuery.value && !playerName.value;
  if (readingLive && list.value && list.value.scrollTop >= 36) {
    // Away from the top the reader's rows hold still: the replaced row stays until the queue merges.
    target.pending = insertTradeMessage(target.pending, message);
  } else {
    target.live = insertTradeMessage(target.live, message);
    target.pending = target.pending.filter((candidate) => candidate.timestamp !== replacedAt);
    followReplacement(target, message, replaced);
  }
}

function commitPending(): void {
  const target = current.value;
  if (!target.pending.length) return;
  const arrivals = target.pending;
  target.pending = [];
  for (const message of arrivals) {
    const replaced = target.live.find((candidate) => candidate.timestamp === message.replacementTimestamp);
    target.live = insertTradeMessage(target.live, message);
    followReplacement(target, message, replaced);
  }
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

function select(message: TradeMessage): void {
  current.value.selection = message.timestamp;
  current.value.savedSelection = null;
}

/**
 * A click on a row gives the ledger the keyboard (D-10), so a following ↓ moves the
 * selection instead of the character. At narrow widths it opens the offer sheet.
 */
function onRowClick(message: TradeMessage): void {
  select(message);
  if (narrow()) openDetail();
  else rowElement(message.timestamp)?.focus();
}

/** Right-click chooses an offer and opens its existing Actions; it never contacts the author. */
function onRowContextMenu(message: TradeMessage): void {
  select(message);
  void nextTick(openOfferActions);
}

function openDetail(): void {
  detailOpen.value = true;
  focusAfterRender(() => panel.value?.querySelector<HTMLElement>(".inspector-whisper:not(:disabled)")
    ?? panel.value?.querySelector<HTMLElement>(".mobile-back"));
}

function closeDetail(restoreFocus = ownsFocus()): void {
  detailOpen.value = false;
  if (restoreFocus) focusRow(current.value.selection);
}

/** Whispers owns the conversation; Trade names the seller and says why it cannot. */
function whisper(message: TradeMessage, event?: MouseEvent): void {
  if (event && event.detail > 1) return;
  if (event?.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
  if (!whispersEnabled.value) {
    showNotice(`Turn on Whispers in Settings to write to ${message.sender}.`, "warning");
    return;
  }
  const request = new CustomEvent("gw:whisper-person", { detail: message.sender, cancelable: true });
  if (window.dispatchEvent(request)) showNotice("Whispers is unavailable. Wait for Guild Wars chat, then try again.", "warning");
}

async function openPlayer(sender: string, origin: number | null, restoreFocus = ownsFocus()): Promise<void> {
  searchQueued = false;
  searching.value = false;
  closeOfferActions(false);
  current.value.savedSelection = null;
  if (!playerName.value) {
    playerReturn.value = {
      scrollTop: list.value?.scrollTop ?? 0,
      selection: current.value.selection,
      visibleLimit: visibleLimit.value,
      focusTimestamp: origin,
    };
  }
  playerName.value = sender;
  playerMessages.value = [];
  playerProblem.value = "";
  playerSearching.value = true;
  visibleLimit.value = 25;
  detailOpen.value = false;
  savedOpen.value = false;
  // Back holds the keyboard while the listings load, then the first listing takes it.
  if (restoreFocus) focusAfterRender(() => playerBack.value);
  const revision = ++requestRevision;
  const requestedSource = source.value;
  try {
    const result = await props.host.search({
      source: requestedSource,
      query: sender,
      scope: "player",
    });
    if (revision !== requestRevision || source.value !== requestedSource) return;
    const key = sender.toLocaleLowerCase();
    playerMessages.value = result.messages.filter(
      (message) => message.sender.toLocaleLowerCase() === key,
    );
    current.value.selection = filtered.value[0]?.timestamp ?? null;
  } catch {
    if (revision === requestRevision) {
      playerMessages.value = [];
      playerProblem.value = "The feed did not answer. Go back or try again.";
    }
  } finally {
    if (revision === requestRevision) playerSearching.value = false;
  }
  if (!restoreFocus) return;
  await nextTick();
  const waiting = document.activeElement;
  if (revision === requestRevision && (waiting === playerBack.value || waiting === document.body)) {
    (rowElement(tabStop.value) ?? playerBack.value)?.focus();
  }
}

function closePlayer(restoreFocus = ownsFocus()): void {
  const previous = playerReturn.value;
  requestRevision += 1;
  resetPlayerView();
  detailOpen.value = false;
  if (!previous) return;
  current.value.selection = previous.selection;
  visibleLimit.value = previous.visibleLimit;
  void nextTick(() => {
    if (list.value) list.value.scrollTop = previous.scrollTop;
    if (restoreFocus) (rowElement(previous.focusTimestamp ?? previous.selection) ?? searchInput.value)?.focus({ preventScroll: true });
  });
}

function resetPlayerView(): void {
  playerName.value = "";
  playerMessages.value = [];
  playerSearching.value = false;
  playerProblem.value = "";
  playerReturn.value = null;
}

async function copy(value: string, label: "Character name" | "Offer", event?: MouseEvent): Promise<void> {
  if (event && event.detail > 1) return;
  if (event?.currentTarget instanceof HTMLElement) event.currentTarget.focus();
  const offer = selected.value;
  let text = `${label} copied`;
  let tone: "success" | "error" = "success";
  try { await props.host.copy(value); }
  catch {
    text = "Clipboard access was refused. Select the text and copy it manually.";
    tone = "error";
  }
  const currentOffer = selected.value;
  const sameOffer = !!offer && currentOffer?.source === offer.source && currentOffer?.timestamp === offer.timestamp;
  if (tone === "success" && !sameOffer) text = label === "Character name"
    ? `Copied character name: ${value}.` : `Copied offer${offer ? ` from ${offer.sender}` : ""}.`;
  showNotice(text, tone, sameOffer ? label : undefined);
}

function showNotice(text: string, tone: "success" | "warning" | "error" = "success", copyFor?: "Character name" | "Offer"): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  notice.value = { text, tone, ...(copyFor ? { copyFor } : {}) };
  noticeTimer = tone === "success" ? window.setTimeout(() => { notice.value = null; }, 3_000) : null;
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

/** The star and Saved count show the result; only a failed write speaks (HUB-122). */
function save(next: TradeSavedState): void {
  const revision = ++savedRevision;
  saved.value = next;
  savedWrites = savedWrites.then(async () => {
    try {
      confirmedSaved = await props.host.setSaved(next);
      if (revision === savedRevision) saved.value = confirmedSaved;
    } catch {
      if (revision === savedRevision) saved.value = confirmedSaved;
      showNotice("Saved items could not be updated. Try again.", "error");
    }
  });
}

function toggleOffer(message: TradeMessage, event?: MouseEvent): void {
  if (event && event.detail > 1) return;
  if (!savedReady.value) return;
  const exists = offerSaved(message);
  const offers = exists
    ? saved.value.offers.filter((offer) =>
      offer.source !== message.source || offer.timestamp !== message.timestamp
    )
    : [{ ...message, savedAt: Date.now() }, ...saved.value.offers]
      .slice(0, TRADE_LIMITS.savedOffers);
  // Removing the saved card the inspector shows leaves the feed's own row, if any.
  if (exists && states[message.source].savedSelection === message.timestamp) states[message.source].savedSelection = null;
  save({ ...saved.value, offers });
}

function togglePlayer(sender: string, event?: MouseEvent): void {
  if (event && event.detail > 1) return;
  if (!savedReady.value) return;
  const key = sender.toLocaleLowerCase();
  const exists = playerSaved(sender);
  const players = exists
    ? saved.value.players.filter((player) => player.sender.toLocaleLowerCase() !== key)
    : [{ sender, savedAt: Date.now() }, ...saved.value.players]
      .slice(0, TRADE_LIMITS.savedPlayers);
  save({ ...saved.value, players });
}

function openSaved(): void {
  savedOpen.value = true;
  nextTick(() => savedClose.value?.focus());
}

function closeSaved(restoreFocus = ownsFocus()): void {
  savedOpen.value = false;
  if (restoreFocus) nextTick(() => savedButton.value?.focus());
}

async function inspectSavedOffer(offer: TradeSavedOffer): Promise<void> {
  const restoreFocus = ownsFocus();
  states[offer.source].selection = offer.timestamp;
  states[offer.source].savedSelection = offer.timestamp;
  if (source.value !== offer.source) {
    source.value = offer.source;
    await nextTick();
  }
  detailOpen.value = true;
  savedOpen.value = false;
  if (restoreFocus) {
    focusAfterRender(() => rowElement(offer.timestamp)
      ?? panel.value?.querySelector<HTMLElement>(".inspector-whisper:not(:disabled)")
      ?? searchInput.value);
  }
}

function currentOffersFor(sender: string): number {
  const key = sender.toLocaleLowerCase();
  return current.value.live.filter((message) => message.sender.toLocaleLowerCase() === key).length;
}

/** ↓ ⌃N and PgDn in the search enter the ledger at the selected row; the other keys edit the text. */
function onSearchKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if ((event.key === "Enter" || event.key === "NumpadEnter")
    && (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) {
    event.preventDefault();
    return;
  }
  const step = listKeyStep(event, 1);
  if (step === null || step <= 0 || step === Infinity) return;
  event.preventDefault();
  const target = rowElement(tabStop.value)
    ?? panel.value?.querySelector<HTMLElement>(".trade-state button");
  target?.focus();
}

/** Keys that write into the search: text, and ⌫ to edit it. */
function typesText(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey
    && (event.key === "Backspace" || (event.key.length === 1 && event.key !== "/"));
}

/**
 * The ledger is one listbox with a roving row: the shared list move steps from the
 * focused row (HUB-121), ↑ on the first row returns to search, ↵ whispers the
 * seller and ⌘↵ opens their listings (D-10). Typing goes to the search.
 */
function onListKeydown(event: KeyboardEvent): void {
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-timestamp]") : null;
  if (!row || event.isComposing) return;
  const rows = visibleMessages.value;
  const index = rows.findIndex((message) => String(message.timestamp) === row.dataset.timestamp);
  const message = rows[index];
  if (!message) return;
  if ((event.key === "Enter" || event.key === "NumpadEnter") && !event.altKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    if (event.repeat) return;
    select(message);
    if (event.metaKey) void openPlayer(message.sender, message.timestamp);
    else whisper(message);
    return;
  }
  const step = listKeyStep(event, listPage(list.value, row));
  if (step !== null) {
    event.preventDefault();
    if (step === -1 && index === 0) {
      focusSearch();
      return;
    }
    const next = rows[listIndexAfter(index, rows.length, step)]!;
    select(next);
    rowElement(next.timestamp)?.focus();
    return;
  }
  // Moving focus before the key's default action lets the character land in the search.
  if (typesText(event)) focusSearch();
}

function onListFocus(event: FocusEvent): void {
  rowFocused.value = event.type === "focusin"
    && event.target instanceof HTMLElement && event.target.dataset.timestamp !== undefined;
}

/**
 * Trade's own levels, innermost first: the Actions menu, the Saved drawer, then a
 * sub-view (Trader prices, the narrow offer sheet, a player's listings), then for
 * Escape only a typed search (D-4). ⌘⌫ never edits the search.
 */
function stepBack(clearQuery: boolean): boolean {
  const restoreFocus = ownsFocus();
  if (offerActions.value?.open) closeOfferActions(restoreFocus);
  else if (savedOpen.value) closeSaved(restoreFocus);
  else if (view.value === "prices") closePrices(restoreFocus);
  // The offer sheet is a level only in the narrow layout, where it covers the ledger.
  else if (detailOpen.value && narrow()) closeDetail(restoreFocus);
  else if (playerName.value) closePlayer(restoreFocus);
  else if (clearQuery && (query.value || submittedQuery.value)) clearSearch();
  else return false;
  return true;
}

function closeOfferActions(restoreFocus = ownsFocus()): void {
  if (!offerActions.value?.open) return;
  offerActions.value.open = false;
  if (restoreFocus) offerActions.value.querySelector("summary")?.focus();
}

function menuItems(): HTMLElement[] {
  return [...offerActions.value?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? []];
}

/** Opens Actions for the selected offer with the keyboard on its first item (HUB-131). */
function openOfferActions(): void {
  if (!selected.value) return;
  const open = () => {
    if (!offerActions.value) return;
    offerActions.value.open = true;
    menuItems()[0]?.focus();
  };
  // At narrow widths the menu lives in the offer sheet, which renders first.
  if (narrow() && !detailOpen.value) {
    detailOpen.value = true;
    void nextTick(open);
  } else open();
}

/** ↵ and Space on Actions open the menu on its first item at once, as ⌘J does. */
function onActionsClick(event: MouseEvent): void {
  if (event.detail > 1) return;
  if (offerActions.value?.open) closeOfferActions();
  else openOfferActions();
}

function onActionsKeydown(event: KeyboardEvent): void {
  if ((event.key !== "Enter" && event.key !== " ") || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  event.preventDefault();
  if (event.repeat) return;
  if (offerActions.value?.open) closeOfferActions();
  else openOfferActions();
}

/** The menu's own keys: the shared list move over its items; Tab leaves it closed. */
function onMenuKeydown(event: KeyboardEvent): void {
  const items = menuItems();
  const step = listKeyStep(event, items.length);
  if (step !== null) {
    event.preventDefault();
    items[listIndexAfter(items.indexOf(document.activeElement as HTMLElement), items.length, step)]?.focus();
  } else if (event.key === "Tab") {
    closeOfferActions(false);
  }
}

/** An item runs once, after the menu closed, with the keyboard back on Actions. */
function runAction(action: () => void, event?: MouseEvent): void {
  if (event && event.detail > 1) return;
  closeOfferActions();
  action();
}

/**
 * ⌘⌫ and the mouse back button step out of one Trade level per physical press, like
 * Escape through the surface controller (HUB-120). At the listings they do nothing:
 * they never hide Trade or edit the search.
 */
function onPanelKeydown(event: KeyboardEvent): void {
  if (isHubBackKey(event) && !event.defaultPrevented) {
    event.preventDefault();
    if (!event.repeat) stepBack(false);
    return;
  }
  if (event.defaultPrevented || event.isComposing || view.value !== "listings") return;
  if (event.key.toLowerCase() === "j" && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    if (event.repeat) return;
    if (offerActions.value?.open) closeOfferActions();
    else openOfferActions();
    return;
  }
  // `/` is Trade's search key only inside Trade; from the game it stays a chat command (HUB-117).
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey
    && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
    event.preventDefault();
    focusSearch();
  }
}

function onPanelMouseUp(event: MouseEvent): void {
  if (event.button !== 3) return;
  event.preventDefault();
  stepBack(false);
}

/** A press anywhere else in Trade closes Actions; its summary toggles it itself. */
function onPanelPointerDown(event: PointerEvent): void {
  if (offerActions.value?.open && event.target instanceof Node && !offerActions.value.contains(event.target)) {
    closeOfferActions(false);
  }
}

function openPrices(): void {
  const restoreFocus = ownsFocus();
  pricesOpened.value = true;
  savedOpen.value = false;
  detailOpen.value = false;
  view.value = "prices";
  if (restoreFocus) focusAfterRender(() => panel.value?.querySelector<HTMLElement>(".trader-item-search input"));
}

function closePrices(restoreFocus = ownsFocus()): void {
  view.value = "listings";
  if (restoreFocus) void nextTick(() => pricesButton.value?.focus());
}

watch(source, (next, previous) => {
  resetPlayerView();
  detailOpen.value = false;
  visibleLimit.value = 25;
  // Leaving a market drops the saved card it showed (HUB-118).
  states[previous].savedSelection = null;
  // Each market has different results. Keep the submitted query, not unsubmitted edits.
  requestRevision += 1;
  searchQueued = !!submittedQuery.value;
  searching.value = searchQueued;
  searchProblem.value = "";
  current.value.search = [];
  if (props.visible) void subscribe(next);
});
// Actions belongs to the offer it opened for.
watch(() => selected.value ? `${selected.value.source}:${selected.value.timestamp}` : null, () => {
  closeOfferActions(false);
  // A copy receipt never labels another offer's action; a refusal remains in the local status.
  if (notice.value?.copyFor) notice.value = notice.value.tone === "error"
    ? { text: notice.value.text, tone: notice.value.tone } : null;
});
watch(() => props.visible, (visible) => {
  if (visible) void subscribe(source.value);
  else {
    subscriptionRevision += 1;
    requestRevision += 1;
    searchQueued = searching.value;
    if (playerSearching.value) {
      playerSearching.value = false;
      playerProblem.value = "The search was interrupted. Go back or try again.";
    }
    void props.host.unsubscribe();
  }
});

onMounted(() => {
  updateWhispersEnabled();
  window.addEventListener("gw:tools-settings", updateWhispersEnabled);
  stopEvents = props.host.onEvent(onTradeEvent);
  clock = setInterval(() => { now.value = Date.now(); }, 30_000);
  if (props.visible) void subscribe(source.value);
  void props.host.getSaved().then((value) => {
    confirmedSaved = value;
    saved.value = value;
    savedReady.value = true;
  }).catch(() => {
    showNotice("Saved items are unavailable for this session.", "error");
  });
});
onBeforeUnmount(() => {
  subscriptionRevision += 1;
  requestRevision += 1;
  stopEvents?.();
  window.removeEventListener("gw:tools-settings", updateWhispersEnabled);
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
/** Loading or returning to a list keeps a shown selection and otherwise starts on the first row. */
function keepOrSelectFirst(target: SourceState, messages: readonly TradeMessage[]): void {
  if (target.savedSelection !== null) return;
  if (!messages.some((message) => message.timestamp === target.selection)) {
    target.selection = messages[0]?.timestamp ?? null;
  }
}
function age(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((now.value - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
function relativeAge(timestamp: number): string {
  const short = age(timestamp);
  return short === "now" ? "just now" : `${short} ago`;
}
function exactTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" })
    .format(timestamp);
}
useClassicFrame(panel);
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
      :data-view="view"
      @keydown="onPanelKeydown"
      @mouseup="onPanelMouseUp"
      @pointerdown.capture="onPanelPointerDown"
    >
      <header class="ui-panel-head ui-window-head window-bar" @pointerdown="startDrag">
        <div class="window-brand trade-brand" aria-hidden="true">
          <TradeIcon name="market" />
        </div>
        <div class="window-identity">
          <h1 class="ui-panel-title">{{ view === "prices" ? "Trader Prices" : `${sourceLabel} Trade` }}</h1>
          <p class="ui-field-hint">{{ view === "prices" ? "Current Guild Wars trader quotes · history from Kamadan" : "Public trade feed · listings are posted in Guild Wars" }}</p>
        </div>
        <button
          v-if="mode === 'embedded'"
          class="ui-window-close window-close"
          data-icon
          aria-label="Close Trade Chat"
          @click="emit('close')"
        >×</button>
      </header>

      <TraderPrices
        v-if="pricesOpened"
        v-show="view === 'prices'"
        :host="host"
        :visible="visible && view === 'prices'"
        @back="closePrices()"
      />

      <div v-show="view === 'listings'" class="trade-toolbar">
        <div class="ui-segment source-segment" data-fill role="group" aria-label="Trade source">
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
              data-surface-entry
              @input="onQueryInput"
              @keydown="onSearchKeydown"
            >
            <kbd class="ui-kbd" aria-hidden="true">/</kbd>
          </label>
        </form>
        <div class="trade-toolbar-actions">
          <div class="ui-segment intent-segment" data-fill role="group" aria-label="Offer intent">
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
          <button ref="pricesButton" class="ui-button trader-prices-trigger" type="button" @click="openPrices">
            <TradeIcon name="market" /> Trader prices
          </button>
        </div>
      </div>

      <div v-show="view === 'listings'" class="trade-summary">
        <span v-if="!playerName" class="trade-summary-label">
          <span>{{ summaryLabel }}</span>
          <button v-if="typedFilter" type="button" class="ui-link trade-summary-action" @click="$event.detail <= 1 && runSearch()">
            Search {{ sourceLabel }} history <kbd class="ui-kbd" aria-hidden="true">↵</kbd>
          </button>
          <button v-else-if="submittedQuery" type="button" class="ui-link trade-summary-action" @click="$event.detail <= 1 && clearSearch()">Live feed</button>
        </span>
        <span v-else class="player-summary">
          <button ref="playerBack" class="ui-link" @click="$event.detail <= 1 && closePlayer()">
            ← {{ submittedQuery ? "Back to results" : "Back to offers" }} <kbd class="ui-kbd" aria-hidden="true">⌘⌫</kbd>
          </button>
          <strong><TradeIcon name="player" /><bdi>{{ playerName }}</bdi></strong>
        </span>
        <span class="trade-result-status" aria-live="polite">
          <span class="trade-status" :data-state="current.status" role="status">
            <i aria-hidden="true" />{{ statusLabel }}
          </span>
          <button
            v-if="current.status === 'unavailable' && visibleMessages.length"
            type="button"
            class="ui-link"
            @click="$event.detail <= 1 && retrySearch()"
          >Try again</button>
          {{ filtered.length }}
          {{ filtered.length === 1 ? "offer" : "offers" }}
        </span>
      </div>

      <div
        v-show="view === 'listings'"
        class="trade-ledger ui-well"
        :data-stale="current.status !== 'live' && visibleMessages.length ? '' : undefined"
      >
        <div class="trade-columns" aria-hidden="true">
          <span>Intent</span><span>Character</span><span>Message</span><span>Age</span>
        </div>
        <div
          v-if="searching && (current.status === 'reconnecting' || current.status === 'unavailable')"
          class="trade-state"
          role="status"
        >
          <strong>Waiting for {{ sourceLabel }} to reconnect</strong>
          <p>Your search runs as soon as the feed is back.</p>
          <button class="ui-button" @click="$event.detail <= 1 && retrySearch()">Try again</button>
        </div>
        <div
          v-else-if="playerSearching || searching || (!visibleMessages.length && (current.status === 'connecting' || current.status === 'reconnecting'))"
          class="trade-state"
          role="status"
        >
          <div class="trade-skeleton" /><div class="trade-skeleton" /><div class="trade-skeleton" />
          <p>{{ loadingLabel }}</p>
        </div>
        <div v-else-if="!visibleMessages.length" class="trade-state">
          <strong>{{ emptyHeading }}</strong>
          <p v-if="playerProblem">{{ playerProblem }}</p>
          <p v-else-if="searchProblem">{{ searchProblem }}</p>
          <p v-else-if="hiddenByIntent">They match, but the {{ intentLabel }} filter hides them.</p>
          <p v-else-if="typedFilter">Search {{ sourceLabel }} history to look beyond the loaded messages.</p>
          <p v-else-if="playerName">This character has no recent listings in {{ sourceLabel }}.</p>
          <p v-else-if="submittedQuery">Try a shorter item name, character name, or another intent.</p>
          <p v-else>Messages will appear here as soon as the public feed answers.</p>
          <button
            v-if="playerProblem"
            class="ui-button"
            @click="$event.detail <= 1 && openPlayer(playerName, null)"
          >Try again</button>
          <button
            v-else-if="current.status === 'unavailable' || searchProblem"
            class="ui-button"
            @click="$event.detail <= 1 && retrySearch()"
          >Try again</button>
          <button v-else-if="hiddenByIntent" class="ui-button" @click="$event.detail <= 1 && (intent = 'all')">Show all</button>
          <button v-else-if="typedFilter" class="ui-button" @click="$event.detail <= 1 && runSearch()">Search {{ sourceLabel }} history</button>
        </div>
        <div
          v-else
          ref="list"
          class="trade-list ui-scroll"
          role="listbox"
          aria-label="Trade offers"
          @scroll="onListScroll"
          @keydown="onListKeydown"
          @focusin="onListFocus"
          @focusout="onListFocus"
        >
          <div
            v-for="message in visibleMessages"
            :key="message.timestamp"
            class="trade-row ui-selection-region"
            role="option"
            :tabindex="tabStop === message.timestamp ? 0 : -1"
            :aria-selected="current.selection === message.timestamp"
            :aria-label="`${message.sender}: ${message.message}`"
            :data-timestamp="message.timestamp"
            :data-saved-offer="offerSaved(message) ? '' : undefined"
            :data-saved-player="playerSaved(message.sender) ? '' : undefined"
            :data-selected="current.selection === message.timestamp ? '' : undefined"
            @click="onRowClick(message)"
            @contextmenu.prevent="onRowContextMenu(message)"
          >
            <span class="intent-cell">
              <span v-if="offerSaved(message)" class="saved-mark" aria-label="Saved offer"><TradeIcon name="star" filled /></span>
              <span v-for="tag in tradeMessageIntents(message.message)" :key="tag" class="ui-chip" :data-intent="tag">
                {{ tag === "selling" ? "WTS" : "WTB" }}
              </span>
              <span v-if="!tradeMessageIntents(message.message).length" class="ui-chip">Other</span>
            </span>
            <button
              class="character-cell"
              tabindex="-1"
              :aria-label="`Show listings from ${message.sender}`"
              @click.stop="$event.detail <= 1 && openPlayer(message.sender, message.timestamp, true)"
            >
              <span v-if="playerSaved(message.sender)" class="followed-mark" aria-label="Followed player"><TradeIcon name="player" filled /></span>
              <bdi>{{ message.sender }}</bdi>
            </button>
            <span class="message-cell offer-cell"><bdi><template
              v-for="(part, index) in tradeMatchSegments(message.message, highlight)"
              :key="index"
            ><mark v-if="part.match" class="trade-match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></bdi></span>
            <time class="age-cell" :datetime="new Date(message.timestamp).toISOString()">{{ age(message.timestamp) }}</time>
            <div class="row-quick-actions">
              <button
                class="ui-button row-quick-action"
                data-variant="quiet"
                data-icon
                tabindex="-1"
                :aria-label="`${offerSaved(message) ? 'Remove saved' : 'Save'} offer from ${message.sender}`"
                :aria-pressed="offerSaved(message)"
                :disabled="!savedReady"
                :title="offerSaved(message) ? 'Remove saved offer' : 'Save offer'"
                @click.stop="toggleOffer(message, $event)"
              ><TradeIcon name="star" :filled="offerSaved(message)" /></button>
              <button
                class="ui-button row-quick-action"
                data-variant="quiet"
                data-icon
                tabindex="-1"
                :aria-label="`${playerSaved(message.sender) ? 'Unfollow' : 'Follow'} ${message.sender}`"
                :aria-pressed="playerSaved(message.sender)"
                :disabled="!savedReady"
                :title="playerSaved(message.sender) ? 'Unfollow player' : 'Follow player'"
                @click.stop="togglePlayer(message.sender, $event)"
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

      <section v-show="view === 'listings'" class="trade-inspector ui-well ui-scroll" :aria-label="selected ? `Offer from ${selected.sender}` : 'Offer detail'">
        <button class="ui-button mobile-back" @click="$event.detail <= 1 && closeDetail()">
          {{ playerName ? `Back to ${playerName}` : "Back to offers" }}
        </button>
        <template v-if="selected">
          <div class="inspector-copy">
            <div class="inspector-meta">
              <span class="inspector-player"><TradeIcon name="player" /><bdi>{{ selected.sender }}</bdi></span>
              <time :datetime="new Date(selected.timestamp).toISOString()">{{ relativeAge(selected.timestamp) }} · {{ exactTime(selected.timestamp) }}</time>
            </div>
            <p><bdi>{{ selected.message }}</bdi></p>
          </div>
          <footer class="inspector-actions">
            <span class="inspector-primary">
              <button
                class="ui-button inspector-whisper"
                data-variant="primary"
                :disabled="!whispersEnabled"
                :aria-describedby="whispersEnabled ? undefined : 'trade-whisper-reason'"
                @click="whisper(selected, $event)"
              ><bdi>Whisper {{ selected.sender }}</bdi><kbd class="ui-kbd" aria-hidden="true" :data-hidden="rowFocused ? undefined : ''">↵</kbd></button>
              <span v-if="!whispersEnabled" id="trade-whisper-reason" class="inspector-reason">Whispers is off</span>
              <button
                v-if="!playerName"
                class="ui-button inspector-listings"
                :aria-label="`Show listings from ${selected.sender}`"
                @click="$event.detail <= 1 && openPlayer(selected.sender, selected.timestamp)"
              >Show listings<kbd class="ui-kbd" aria-hidden="true" :data-hidden="rowFocused ? undefined : ''">⌘↵</kbd></button>
            </span>
            <details ref="offerActions" class="offer-actions">
              <summary class="ui-button" aria-haspopup="menu" @click.prevent="onActionsClick" @keydown="onActionsKeydown">Actions <kbd class="ui-kbd" aria-hidden="true">⌘J</kbd></summary>
              <div class="offer-menu ui-raised" role="menu" aria-label="Offer actions" @keydown="onMenuKeydown">
                <button role="menuitem" class="offer-menu-item" :disabled="!whispersEnabled" @click="runAction(() => whisper(selected!), $event)">
                  <span>Whisper <bdi>{{ selected.sender }}</bdi></span><kbd class="ui-kbd" aria-hidden="true">↵</kbd>
                </button>
                <button v-if="!playerName" role="menuitem" class="offer-menu-item" @click="runAction(() => openPlayer(selected!.sender, selected!.timestamp, true), $event)">
                  <span>Show listings</span><kbd class="ui-kbd" aria-hidden="true">⌘↵</kbd>
                </button>
                <button role="menuitemcheckbox" class="offer-menu-item" :aria-checked="offerSaved(selected)" :disabled="!savedReady" @click="runAction(() => toggleOffer(selected!), $event)">
                  <span>Save offer</span><span v-if="offerSaved(selected)" class="offer-menu-check" aria-hidden="true">✓</span>
                </button>
                <button role="menuitemcheckbox" class="offer-menu-item" :aria-checked="playerSaved(selected.sender)" :disabled="!savedReady" @click="runAction(() => togglePlayer(selected!.sender), $event)">
                  <span>Follow player</span><span v-if="playerSaved(selected.sender)" class="offer-menu-check" aria-hidden="true">✓</span>
                </button>
                <button role="menuitem" class="offer-menu-item offer-copy-name" :data-tone="notice?.copyFor === 'Character name' ? notice.tone : undefined" @click="copy(selected!.sender, 'Character name', $event)">
                  <span aria-live="polite">{{ notice?.copyFor === 'Character name' ? notice.text : 'Copy name' }}</span>
                </button>
                <button role="menuitem" class="offer-menu-item offer-copy-message" :data-tone="notice?.copyFor === 'Offer' ? notice.tone : undefined" @click="copy(selected!.message, 'Offer', $event)">
                  <span aria-live="polite">{{ notice?.copyFor === 'Offer' ? notice.text : 'Copy offer' }}</span>
                </button>
                <button role="menuitem" class="offer-menu-item" @click="runAction(() => props.host.openSource(source), $event)">
                  <span>Open {{ sourceLabel }} feed ↗</span>
                </button>
              </div>
            </details>
          </footer>
        </template>
        <div v-else class="ui-empty">
          <strong>Choose an offer</strong>
          <p>The complete message and copy actions will appear here.</p>
        </div>
      </section>

      <Transition name="saved-drawer">
        <aside
          v-if="savedOpen && view === 'listings'"
          id="trade-saved-drawer"
          class="trade-saved-drawer ui-drawer ui-raised"
          role="complementary"
          aria-label="Saved trade items"
        >
          <header class="saved-drawer-head ui-drawer-head">
            <div>
              <strong>Saved</strong>
              <span>{{ savedCount }} {{ savedCount === 1 ? "item" : "items" }}</span>
            </div>
            <button ref="savedClose" class="ui-button" data-icon aria-label="Close Saved" @click="closeSaved()">×</button>
          </header>
          <div class="ui-segment saved-tabs" data-fill role="group" aria-label="Saved item type">
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
                <button class="saved-card-main" @click="$event.detail <= 1 && openPlayer(player.sender, null)">
                  <span><bdi><TradeIcon name="player" filled />{{ player.sender }}</bdi><small>{{ currentOffersFor(player.sender) }} current {{ currentOffersFor(player.sender) === 1 ? "offer" : "offers" }} in {{ sourceLabel }}</small></span>
                </button>
                <button class="saved-remove" :aria-label="`Unfollow ${player.sender}`" @click="togglePlayer(player.sender)"><TradeIcon name="player" filled /></button>
              </article>
            </template>
          </div>
        </aside>
      </Transition>

      <Transition name="notice">
        <div v-if="notice && !notice.copyFor" class="ui-toast trade-notice" role="status" :data-tone="notice.tone === 'success' ? undefined : notice.tone">{{ notice.text }}</div>
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
