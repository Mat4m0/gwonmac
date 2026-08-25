<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  type TraderPriceHistoryProblem,
  type TraderQuote,
  type TraderQuoteSnapshot,
} from "../../../../src/shared/trade-chat";
import type { TradeHost } from "../trade-host";
import { traderProfessionIcon } from "../trader-assets";
import {
  TRADER_ITEMS,
  TRADER_PRICE_CATEGORIES,
  TRADER_PROFESSIONS,
  type TraderPriceCategory,
  type TraderItem,
  type TraderProfession,
} from "../trader-catalog";
import PriceHistoryChart from "./PriceHistoryChart.vue";
import TraderItemIcon from "./TraderItemIcon.vue";

const props = defineProps<{ host: TradeHost; visible: boolean }>();
const emit = defineEmits<{ back: [] }>();

const CATEGORY_LABELS: Readonly<Record<TraderPriceCategory, string>> = Object.freeze({
  "common-materials": "Common",
  "rare-materials": "Rare",
  runes: "Runes",
  dyes: "Dyes",
});
const PROFESSION_LABELS: Readonly<Record<TraderProfession, string>> = Object.freeze({
  general: "General",
  warrior: "Warrior",
  ranger: "Ranger",
  monk: "Monk",
  necromancer: "Necromancer",
  mesmer: "Mesmer",
  elementalist: "Elementalist",
  assassin: "Assassin",
  ritualist: "Ritualist",
  paragon: "Paragon",
  dervish: "Dervish",
});
const RANGES = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
] as const;
const HISTORY_DEBOUNCE_MS = 150;
const HISTORY_PROBLEM_MESSAGES: Readonly<Record<TraderPriceHistoryProblem, string>> = Object.freeze({
  "rate-limited": "Kamadan is receiving too many requests. Wait a moment, then try again.",
  timeout: "Kamadan took too long to respond. Try again.",
  "invalid-response": "Kamadan returned price history we could not read. Try again later.",
  unavailable: "Price history is temporarily unavailable. Try again.",
});

const category = ref<TraderPriceCategory>("rare-materials");
const profession = ref<TraderProfession>("general");
const query = ref("");
const selectedId = ref<string | null>("0b03a2");
const rangeDays = ref(30);
const mobileDetail = ref(false);
const quotes = ref<TraderQuoteSnapshot | null>(null);
const history = ref<readonly TraderQuote[]>([]);
const quotesLoading = ref(false);
const historyLoading = ref(false);
const quoteProblem = ref<string | null>(null);
const historyProblem = ref<TraderPriceHistoryProblem | null>(null);
const catalogue = ref<HTMLElement | null>(null);
const pricesRoot = ref<HTMLElement | null>(null);
const now = ref(Date.now());
let historyRevision = 0;
let historyTimer: ReturnType<typeof setTimeout> | null = null;
let clock: ReturnType<typeof setInterval> | null = null;

const quoteByItem = computed(() => {
  const result = new Map<string, { buy?: TraderQuote; sell?: TraderQuote }>();
  for (const quote of quotes.value?.quotes ?? []) {
    const current = result.get(quote.modelId) ?? {};
    current[quote.side] = quote;
    result.set(quote.modelId, current);
  }
  return result;
});
const availableItems = computed(() => TRADER_ITEMS.filter((item) => quoteByItem.value.has(item.modelId)));
const visibleItems = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  return availableItems.value.filter((item) => {
    if (term) return item.name.toLocaleLowerCase().includes(term);
    if (item.category !== category.value) return false;
    return item.category !== "runes"
      || profession.value === "general"
      || item.profession === profession.value;
  });
});
const selected = computed(() => availableItems.value.find((item) => item.modelId === selectedId.value)
  ?? visibleItems.value[0]
  ?? null);
const selectedQuote = computed(() => selected.value ? quoteByItem.value.get(selected.value.modelId) : undefined);
const selectedIndex = computed(() => selected.value
  ? visibleItems.value.findIndex((item) => item.modelId === selected.value?.modelId)
  : -1);
const updatedLabel = computed(() => quotes.value
  ? `Updated ${relativeAge(quotes.value.updatedAt)}`
  : "Waiting for Kamadan");

watch(visibleItems, (items) => {
  if (!items.length) return;
  if (!items.some((item) => item.modelId === selectedId.value)) selectedId.value = items[0]!.modelId;
});
watch([selectedId, rangeDays], scheduleHistory);
watch(() => props.visible, (visible) => {
  if (visible && !quotesLoading.value) void loadQuotes();
});

onMounted(() => {
  if (props.visible) void loadQuotes();
  clock = setInterval(() => { now.value = Date.now(); }, 30_000);
});
onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
  if (historyTimer) clearTimeout(historyTimer);
});

async function loadQuotes(): Promise<void> {
  if (!quotes.value) quotesLoading.value = true;
  quoteProblem.value = null;
  try {
    quotes.value = await props.host.getTraderQuotes();
    const first = visibleItems.value[0] ?? availableItems.value[0];
    if (first && !availableItems.value.some((item) => item.modelId === selectedId.value)) {
      selectedId.value = first.modelId;
    }
    await loadHistory();
  } catch {
    quoteProblem.value = "Trader prices could not be loaded. Check your connection and try again.";
  } finally {
    quotesLoading.value = false;
  }
}

function scheduleHistory(): void {
  if (historyTimer) clearTimeout(historyTimer);
  const revision = ++historyRevision;
  historyLoading.value = true;
  historyProblem.value = null;
  historyTimer = setTimeout(() => {
    historyTimer = null;
    void loadHistory(revision);
  }, HISTORY_DEBOUNCE_MS);
}

async function loadHistory(revision = ++historyRevision): Promise<void> {
  const item = selected.value;
  if (!item) return;
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = null;
  }
  historyLoading.value = true;
  historyProblem.value = null;
  const to = Date.now();
  const from = to - rangeDays.value * 24 * 60 * 60 * 1_000;
  try {
    const result = await props.host.getTraderPriceHistory({ modelId: item.modelId, from, to });
    if (revision !== historyRevision) return;
    if (result.status === "ok") {
      history.value = result.points;
    } else {
      history.value = [];
      historyProblem.value = result.problem;
    }
  } catch {
    if (revision === historyRevision) {
      history.value = [];
      historyProblem.value = "unavailable";
    }
  } finally {
    if (revision === historyRevision) historyLoading.value = false;
  }
}

function selectCategory(next: TraderPriceCategory): void {
  category.value = next;
  query.value = "";
  catalogue.value?.scrollTo({ top: 0 });
}

function selectItem(item: TraderItem): void {
  selectedId.value = item.modelId;
  mobileDetail.value = true;
  void nextTick(() => pricesRoot.value?.scrollIntoView({ block: "nearest" }));
}

function moveSelection(direction: -1 | 1): void {
  if (!visibleItems.value.length) return;
  const index = selectedIndex.value < 0 ? 0 : selectedIndex.value;
  const next = visibleItems.value[Math.max(0, Math.min(visibleItems.value.length - 1, index + direction))];
  if (!next) return;
  selectItem(next);
  void nextTick(() => pricesRoot.value
    ?.querySelector<HTMLElement>(`[data-trader-id="${next.modelId}"]`)
    ?.focus());
}

function onCatalogueKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const item = event.key === "Home" ? visibleItems.value[0] : visibleItems.value.at(-1);
  if (!item) return;
  selectItem(item);
  void nextTick(() => pricesRoot.value
    ?.querySelector<HTMLElement>(`[data-trader-id="${item.modelId}"]`)
    ?.focus());
}

function formatPrice(price: number | undefined): string {
  if (price === undefined) return "—";
  if (price >= 1_000) return `${(price / 1_000).toFixed(price >= 10_000 ? 0 : 1).replace(/\.0$/u, "")}k`;
  return `${price}g`;
}

function relativeAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((now.value - timestamp) / 1_000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3_600)}h ago`;
}
</script>

<template>
  <section ref="pricesRoot" class="trader-prices" :data-item-open="mobileDetail ? '' : undefined" aria-label="Trader Prices">
    <div class="trader-prices-toolbar">
      <button type="button" class="ui-link trader-back" @click="emit('back')">← Back to listings</button>
      <div class="ui-segment trader-category-tabs" data-fill role="group" aria-label="Trader price category">
        <button
          v-for="entry in TRADER_PRICE_CATEGORIES"
          :key="entry"
          :aria-pressed="category === entry && !query"
          @click="selectCategory(entry)"
        >{{ CATEGORY_LABELS[entry] }}</button>
      </div>
      <label class="ui-input-group trader-item-search">
        <span class="ui-sr-only">Search trader items</span>
        <input v-model="query" type="search" maxlength="80" placeholder="Search trader items">
      </label>
      <span class="trader-updated" :data-stale="quotes && now - quotes.updatedAt > 15 * 60_000 ? '' : undefined">
        {{ updatedLabel }}
      </span>
    </div>

    <div v-if="category === 'runes' && !query" class="trader-professions" role="group" aria-label="Rune profession filter">
      <button
        v-for="entry in TRADER_PROFESSIONS"
        :key="entry"
        type="button"
        :aria-pressed="profession === entry"
        :aria-label="PROFESSION_LABELS[entry]"
        :title="PROFESSION_LABELS[entry]"
        @click="profession = entry"
      >
        <span v-if="entry === 'general'" aria-hidden="true">All</span>
        <img v-else :src="traderProfessionIcon(entry)" alt="">
      </button>
    </div>

    <div v-if="quoteProblem" class="trader-price-error ui-empty" role="alert">
      <strong>Trader prices unavailable</strong>
      <p>{{ quoteProblem }}</p>
      <button class="ui-button" type="button" @click="loadQuotes">Try again</button>
    </div>
    <div v-else class="trader-prices-workspace">
      <section class="trader-catalogue ui-well" aria-label="Trader item catalogue">
        <div class="trader-catalogue-columns" aria-hidden="true">
          <span>Item</span><span>Buy</span><span>Sell</span>
        </div>
        <div v-if="quotesLoading" class="trader-catalogue-state" role="status">
          <span class="trade-skeleton" /><span class="trade-skeleton" /><span class="trade-skeleton" />
          Loading trader prices…
        </div>
        <div v-else-if="!visibleItems.length" class="trader-catalogue-state">
          <strong>No matching prices</strong>
          <span>Try another item name or category.</span>
        </div>
        <div v-else ref="catalogue" class="trader-catalogue-list ui-scroll" role="listbox" aria-label="Trader items" @keydown="onCatalogueKeydown">
          <button
            v-for="item in visibleItems"
            :key="item.modelId"
            type="button"
            class="trader-item-row ui-row"
            role="option"
            :data-trader-id="item.modelId"
            :aria-selected="selected?.modelId === item.modelId"
            :tabindex="selected?.modelId === item.modelId ? 0 : -1"
            @click="selectItem(item)"
          >
            <span class="trader-item-name">
              <TraderItemIcon :item="item" />
              <span><bdi>{{ item.quantity > 1 ? `${item.quantity} × ${item.name}` : item.name }}</bdi><small v-if="query">{{ CATEGORY_LABELS[item.category] }}</small></span>
            </span>
            <span class="trader-price-value" data-side="buy">{{ formatPrice(quoteByItem.get(item.modelId)?.buy?.price) }}</span>
            <span class="trader-price-value" data-side="sell">{{ formatPrice(quoteByItem.get(item.modelId)?.sell?.price) }}</span>
          </button>
        </div>
      </section>

      <section v-if="selected" class="trader-price-detail ui-well" :aria-label="`${selected.name} price history`">
        <button type="button" class="ui-button trader-mobile-back" @click="mobileDetail = false">← Back to prices</button>
        <header class="trader-price-detail-head">
          <TraderItemIcon :item="selected" size="large" />
          <div>
            <h2>{{ selected.quantity > 1 ? `${selected.quantity} × ${selected.name}` : selected.name }}</h2>
            <span>{{ CATEGORY_LABELS[selected.category] }} · Kamadan trader</span>
          </div>
          <div class="trader-item-navigation">
            <button class="ui-button" data-icon type="button" aria-label="Previous item" :disabled="selectedIndex <= 0" @click="moveSelection(-1)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5"/></svg>
            </button>
            <button class="ui-button" data-icon type="button" aria-label="Next item" :disabled="selectedIndex >= visibleItems.length - 1" @click="moveSelection(1)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>
            </button>
          </div>
        </header>
        <div class="trader-current-prices">
          <span data-side="buy"><small>Buy from trader</small><strong>{{ formatPrice(selectedQuote?.buy?.price) }}</strong></span>
          <span data-side="sell"><small>Sell to trader</small><strong>{{ formatPrice(selectedQuote?.sell?.price) }}</strong></span>
        </div>
        <div class="ui-segment trader-range" data-fill aria-label="Price history range">
          <button v-for="range in RANGES" :key="range.days" :aria-pressed="rangeDays === range.days" @click="rangeDays = range.days">{{ range.label }}</button>
        </div>
        <div v-if="historyProblem" class="trader-history-error" role="alert">
          <p>{{ HISTORY_PROBLEM_MESSAGES[historyProblem] }}</p>
          <button class="ui-button" type="button" @click="loadHistory()">Try again</button>
        </div>
        <PriceHistoryChart v-else :points="history" :loading="historyLoading" :item-name="selected.name" />
        <p class="trader-price-source">Observed trader quotes from Kamadan. Prices can change in Guild Wars before the next update.</p>
      </section>
    </div>
  </section>
</template>
