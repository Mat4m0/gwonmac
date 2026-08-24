<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TraderPricePoint } from "../../../../src/shared/trade-chat";

const props = defineProps<{
  points: readonly TraderPricePoint[];
  loading: boolean;
  itemName: string;
}>();

const WIDTH = 800;
const HEIGHT = 340;
const PLOT = Object.freeze({ left: 58, right: 18, top: 22, bottom: 42 });
const plotWidth = WIDTH - PLOT.left - PLOT.right;
const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
const MAX_RENDERED_POINTS = 360;
const WHEEL_LINE_PIXELS = 16;
const MAX_WHEEL_DELTA_PIXELS = 100;
const WHEEL_ZOOM_RATE = 0.0008;

const viewport = ref<{ from: number; to: number } | null>(null);
const pointer = ref<{ x: number; y: number } | null>(null);
const drag = ref<{ pointerId: number; startX: number; from: number; to: number } | null>(null);

const extent = computed(() => {
  const times = props.points.map((point) => point.timestamp);
  const now = Date.now();
  return {
    from: Math.min(...times, now - 24 * 60 * 60 * 1_000),
    to: Math.max(...times, now),
  };
});

watch(() => props.points, () => { viewport.value = null; }, { flush: "sync" });

const visibleRange = computed(() => viewport.value ?? extent.value);
const visiblePoints = computed(() => props.points.filter((point) =>
  point.timestamp >= visibleRange.value.from && point.timestamp <= visibleRange.value.to));
const priceExtent = computed(() => {
  const prices = visiblePoints.value.map((point) => point.price);
  if (!prices.length) return { min: 0, max: 1 };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const padding = Math.max(1, (max - min) * 0.12);
  return { min: Math.max(0, min - padding), max: max + padding };
});

const buyPoints = computed(() => visiblePoints.value.filter((point) => point.side === "buy"));
const sellPoints = computed(() => visiblePoints.value.filter((point) => point.side === "sell"));
const buyPath = computed(() => linePath(thinSeries(buyPoints.value)));
const sellPath = computed(() => linePath(thinSeries(sellPoints.value)));
const yTicks = computed(() => Array.from({ length: 5 }, (_, index) => {
  const ratio = index / 4;
  const price = priceExtent.value.max - (priceExtent.value.max - priceExtent.value.min) * ratio;
  return { y: PLOT.top + plotHeight * ratio, label: formatPrice(price) };
}));
const xTicks = computed(() => Array.from({ length: 5 }, (_, index) => {
  const ratio = index / 4;
  const timestamp = visibleRange.value.from
    + (visibleRange.value.to - visibleRange.value.from) * ratio;
  return { x: PLOT.left + plotWidth * ratio, label: formatAxisTime(timestamp) };
}));
const isZoomed = computed(() => viewport.value !== null);

const hovered = computed(() => {
  if (!pointer.value || !visiblePoints.value.length) return null;
  const timestamp = visibleRange.value.from
    + ((pointer.value.x - PLOT.left) / plotWidth)
      * (visibleRange.value.to - visibleRange.value.from);
  const buy = nearest(buyPoints.value, timestamp);
  const sell = nearest(sellPoints.value, timestamp);
  const anchor = buy ?? sell;
  if (!anchor) return null;
  return {
    x: xFor(anchor.timestamp),
    timestamp: anchor.timestamp,
    buy,
    sell,
  };
});

const latest = computed(() => ({
  buy: props.points.filter((point) => point.side === "buy").at(-1),
  sell: props.points.filter((point) => point.side === "sell").at(-1),
}));

function linePath(points: readonly TraderPricePoint[]): string {
  return points.map((point, index) => {
    const x = xFor(point.timestamp);
    const y = yFor(point.price);
    if (index === 0) return `M ${x} ${y}`;
    return `L ${x} ${y}`;
  }).join(" ");
}

function thinSeries(points: readonly TraderPricePoint[]): readonly TraderPricePoint[] {
  if (points.length <= MAX_RENDERED_POINTS) return points;
  const first = points[0]!;
  const last = points.at(-1)!;
  const duration = Math.max(1, last.timestamp - first.timestamp);
  const buckets = new Map<number, TraderPricePoint>();
  for (const point of points) {
    const bucket = Math.min(
      MAX_RENDERED_POINTS - 1,
      Math.floor((point.timestamp - first.timestamp) / duration * MAX_RENDERED_POINTS),
    );
    buckets.set(bucket, point);
  }
  return [first, ...buckets.values(), last].filter((point, index, result) =>
    index === 0 || point !== result[index - 1]);
}

function xFor(timestamp: number): number {
  const range = visibleRange.value;
  return PLOT.left + (timestamp - range.from) / (range.to - range.from) * plotWidth;
}

function yFor(price: number): number {
  const range = priceExtent.value;
  return PLOT.top + (range.max - price) / (range.max - range.min) * plotHeight;
}

function nearest(points: readonly TraderPricePoint[], timestamp: number): TraderPricePoint | null {
  let result: TraderPricePoint | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const nextDistance = Math.abs(point.timestamp - timestamp);
    if (nextDistance < distance) {
      result = point;
      distance = nextDistance;
    }
  }
  return result;
}

function graphPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width * WIDTH,
    y: (event.clientY - rect.top) / rect.height * HEIGHT,
  };
}

function onPointerMove(event: PointerEvent): void {
  const next = graphPoint(event);
  pointer.value = next;
  if (!drag.value || drag.value.pointerId !== event.pointerId) return;
  const duration = drag.value.to - drag.value.from;
  const delta = (next.x - drag.value.startX) / plotWidth * duration;
  setViewport(drag.value.from - delta, drag.value.to - delta);
}

function startPan(event: PointerEvent): void {
  if (event.button !== 0 || !props.points.length) return;
  const point = graphPoint(event);
  drag.value = {
    pointerId: event.pointerId,
    startX: point.x,
    ...visibleRange.value,
  };
  (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
}

function stopPan(event: PointerEvent): void {
  if (drag.value?.pointerId === event.pointerId) drag.value = null;
}

function zoom(event: WheelEvent): void {
  if (!props.points.length) return;
  event.preventDefault();
  const point = graphPoint(event);
  const deltaPixels = event.deltaY * (
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? WHEEL_LINE_PIXELS
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? plotHeight
        : 1
  );
  const boundedDelta = Math.max(
    -MAX_WHEEL_DELTA_PIXELS,
    Math.min(MAX_WHEEL_DELTA_PIXELS, deltaPixels),
  );
  zoomAt(
    Math.exp(boundedDelta * WHEEL_ZOOM_RATE),
    Math.max(0, Math.min(1, (point.x - PLOT.left) / plotWidth)),
  );
}

function zoomAt(factor: number, anchor = 0.5): void {
  const range = visibleRange.value;
  const duration = range.to - range.from;
  const nextDuration = Math.min(
    extent.value.to - extent.value.from,
    Math.max(60 * 60 * 1_000, duration * factor),
  );
  const timestamp = range.from + duration * anchor;
  setViewport(timestamp - nextDuration * anchor, timestamp + nextDuration * (1 - anchor));
}

function setViewport(from: number, to: number): void {
  const full = extent.value;
  const duration = to - from;
  if (duration >= full.to - full.from) {
    viewport.value = null;
    return;
  }
  if (from < full.from) { to += full.from - from; from = full.from; }
  if (to > full.to) { from -= to - full.to; to = full.to; }
  viewport.value = { from, to };
}

function resetView(): void {
  viewport.value = null;
}

function formatPrice(value: number): string {
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/u, "")}k`;
  }
  return `${Math.round(value)}g`;
}

function formatAxisTime(timestamp: number): string {
  const days = (visibleRange.value.to - visibleRange.value.from) / 86_400_000;
  return new Intl.DateTimeFormat(undefined, days <= 2
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(timestamp);
}

function formatTooltipTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}
</script>

<template>
  <figure class="price-chart" :aria-label="`${itemName} trader price history`">
    <div class="price-chart-legend">
      <span data-series="buy"><i />Buy</span>
      <span data-series="sell"><i />Sell</span>
      <span class="price-chart-zoom">
        <button class="ui-button" data-icon type="button" aria-label="Zoom out" :disabled="!isZoomed" @click="zoomAt(1.22)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3M4.5 7h5" /></svg>
        </button>
        <button class="ui-button" data-icon type="button" aria-label="Zoom in" @click="zoomAt(0.82)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3M4.5 7h5M7 4.5v5" /></svg>
        </button>
        <button v-if="isZoomed" class="ui-link" type="button" @click="resetView">Reset view</button>
      </span>
    </div>
    <div v-if="loading" class="price-chart-state" role="status">
      <span class="trade-skeleton" /><span class="trade-skeleton" />
      Loading price history…
    </div>
    <div v-else-if="!points.length" class="price-chart-state">
      <strong>No price history</strong>
      <span>Kamadan has no quotes for this item in the selected range.</span>
    </div>
    <svg
      v-else
      class="price-chart-plot"
      :class="{ 'is-panning': drag }"
      viewBox="0 0 800 340"
      role="img"
      :aria-describedby="`price-chart-summary-${itemName.replace(/\W+/gu, '-')}`"
      @pointerdown="startPan"
      @pointermove="onPointerMove"
      @pointerup="stopPan"
      @pointercancel="stopPan"
      @pointerleave="pointer = null"
      @wheel="zoom"
    >
      <g class="price-chart-grid">
        <line v-for="tick in yTicks" :key="tick.y" :x1="PLOT.left" :x2="WIDTH - PLOT.right" :y1="tick.y" :y2="tick.y" />
      </g>
      <g class="price-chart-axis">
        <text v-for="tick in yTicks" :key="tick.label" :x="PLOT.left - 10" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
        <text v-for="tick in xTicks" :key="tick.x" :x="tick.x" :y="HEIGHT - 14" text-anchor="middle">{{ tick.label }}</text>
      </g>
      <path v-if="sellPath" class="price-series-halo" :d="sellPath" />
      <path v-if="buyPath" class="price-series-halo" :d="buyPath" />
      <path v-if="sellPath" class="price-series price-series-sell" :d="sellPath" />
      <path v-if="buyPath" class="price-series price-series-buy" :d="buyPath" />
      <g v-if="hovered" class="price-chart-hover" aria-hidden="true">
        <line :x1="hovered.x" :x2="hovered.x" :y1="PLOT.top" :y2="HEIGHT - PLOT.bottom" />
        <circle v-if="hovered.buy" :cx="xFor(hovered.buy.timestamp)" :cy="yFor(hovered.buy.price)" r="4" data-series="buy" />
        <circle v-if="hovered.sell" :cx="xFor(hovered.sell.timestamp)" :cy="yFor(hovered.sell.price)" r="4" data-series="sell" />
      </g>
    </svg>
    <div
      v-if="hovered"
      class="price-chart-tooltip ui-raised"
      :style="{ left: `${Math.max(14, Math.min(78, hovered.x / WIDTH * 100))}%` }"
      aria-hidden="true"
    >
      <time>{{ formatTooltipTime(hovered.timestamp) }}</time>
      <span v-if="hovered.buy"><i data-series="buy" />Buy <strong>{{ formatPrice(hovered.buy.price) }}</strong></span>
      <span v-if="hovered.sell"><i data-series="sell" />Sell <strong>{{ formatPrice(hovered.sell.price) }}</strong></span>
    </div>
    <figcaption :id="`price-chart-summary-${itemName.replace(/\W+/gu, '-')}`" class="ui-sr-only">
      {{ itemName }}. Latest buy price {{ latest.buy ? formatPrice(latest.buy.price) : "unavailable" }}.
      Latest sell price {{ latest.sell ? formatPrice(latest.sell.price) : "unavailable" }}.
      Scroll to zoom and drag to move through time.
    </figcaption>
  </figure>
</template>
