/** The narrow host boundary used by the Trade Chat Vue surface. */
import {
  parseTradeSavedState,
  type TradeEvent,
  type TradeMessage,
  type TradeSearchRequest,
  type TradeSearchResult,
  type TradeSavedState,
  type TradeSnapshot,
  type TradeSource,
  type TraderPriceHistoryRequest,
  type TraderPricePoint,
  type TraderQuoteSnapshot,
} from "../../../src/shared/trade-chat";
import type { GwNativeApi } from "../../../src/shared/contracts";

export type TradeHost = Readonly<{
  subscribe(source: TradeSource): Promise<TradeSnapshot>;
  unsubscribe(): Promise<void>;
  search(request: TradeSearchRequest): Promise<TradeSearchResult>;
  retry(source: TradeSource): Promise<void>;
  onEvent(callback: (event: TradeEvent) => void): () => void;
  copy(text: string): Promise<void>;
  openSource(source: TradeSource): Promise<void>;
  getSaved(): Promise<TradeSavedState>;
  setSaved(value: TradeSavedState): Promise<TradeSavedState>;
  getTraderQuotes(): Promise<TraderQuoteSnapshot>;
  getTraderPriceHistory(
    request: TraderPriceHistoryRequest,
  ): Promise<readonly TraderPricePoint[]>;
}>;

type NativeTradeHostApi = Readonly<{
  trade: GwNativeApi["trade"];
  clipboard: Pick<GwNativeApi["clipboard"], "writeText">;
  app: Pick<GwNativeApi["app"], "openExternal">;
}>;

export function createNativeTradeHost(api: NativeTradeHostApi): TradeHost {
  return Object.freeze({
    subscribe: (source) => api.trade.subscribe(source),
    unsubscribe: () => api.trade.unsubscribe(),
    search: (request) => api.trade.search(request),
    retry: (source) => api.trade.retry(source),
    onEvent: (callback) => api.trade.onEvent(callback),
    copy: (text) => api.clipboard.writeText(text),
    openSource: (source) => api.app.openExternal(
      source === "kamadan" ? "kamadanTrade" : "preSearingTrade",
    ),
    getSaved: () => api.trade.getSaved(),
    // Vue state can contain proxies, which Electron cannot structured-clone.
    setSaved: (value) => api.trade.setSaved(parseTradeSavedState(value)),
    getTraderQuotes: () => api.trade.getTraderQuotes(),
    getTraderPriceHistory: (request) => api.trade.getTraderPriceHistory(request),
  });
}

const DEMO_MESSAGES: readonly TradeMessage[] = [
  fixture("kamadan", 1, "Tyria Cartographer", "WTS arms 29e each — trade me in Kamadan"),
  fixture("kamadan", 2, "Rin of the Isles", "WTB cupcakes, need several stacks"),
  fixture("kamadan", 3, "Silver Wayfarer", "WTS 105 consets — 1e each"),
  fixture("kamadan", 4, "Acolyte Mira", "WTS chocolate bunnies 4e per stack"),
  fixture("kamadan", 5, "Artic Voyager", "WTB +5 energy spear, message your offer"),
  fixture("kamadan", 6, "Quiet Ember", "WTS unded Polar Bear 100a | Envoy Axe 20a | q12 Eblade 6a"),
  fixture("kamadan", 7, "Tyria Cartographer", "Earlier trade listing, now superseded"),
  fixture("pre-searing", 1, "Vanguard Althea", "WTB Charr carvings and red iris flowers"),
  fixture("pre-searing", 2, "Northlands Scout", "WTS purple Charr bag, offer"),
  fixture("pre-searing", 3, "Ascalon Merchant", "WTS dyes, iron ingots and wood planks"),
  fixture("pre-searing", 4, "The Legendary Defender", "WTB max purple sword q8"),
];

export function createDemoTradeHost(): TradeHost {
  let source: TradeSource = "kamadan";
  const listeners = new Set<(event: TradeEvent) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let saved: TradeSavedState = { offers: [], players: [] };
  const start = () => {
    if (timer) return;
    timer = setInterval(() => {
      const message = fixture(
        source,
        Math.floor(Date.now() / 1000),
        source === "kamadan" ? "Demo Trader" : "Ascalon Collector",
        source === "kamadan" ? "WTS ectos 7e each" : "WTB black dyes, pm offer",
      );
      for (const listener of listeners) {
        listener({ type: "message", source, message });
      }
    }, 18_000);
  };
  return Object.freeze({
    async subscribe(next) {
      source = next;
      start();
      return {
        source,
        status: "live",
        messages: DEMO_MESSAGES.filter((message) => message.source === source),
      };
    },
    async unsubscribe() {},
    async search(request) {
      const query = request.query.toLocaleLowerCase();
      const messages = DEMO_MESSAGES.filter((candidate) =>
        candidate.source === request.source
        && (request.scope === "player"
          ? candidate.sender.toLocaleLowerCase() === query
          : candidate.message.toLocaleLowerCase().includes(query)
            || candidate.sender.toLocaleLowerCase().includes(query))
      ).sort((left, right) => right.timestamp - left.timestamp);
      return {
        ...request,
        messages,
      };
    },
    async retry(next) {
      for (const listener of listeners) {
        listener({ type: "status", source: next, status: "live" });
      }
    },
    onEvent(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    async copy(text) {
      await navigator.clipboard?.writeText(text);
    },
    async openSource() {},
    async getSaved() { return saved; },
    async setSaved(value) {
      saved = value;
      return saved;
    },
    async getTraderQuotes() {
      return demoTraderQuotes();
    },
    async getTraderPriceHistory(request) {
      return demoTraderPriceHistory(request);
    },
  });
}

function demoTraderQuotes(): TraderQuoteSnapshot {
  const updatedAt = Date.now() - 75_000;
  const rows = [
    ["0b03a2", 20_000, 15_000],
    ["0b03b1", 6_500, 5_200],
    ["0b039f", 900, 700],
    ["0b03a6", 850, 650],
    ["0b03b4", 210, 160],
    ["0a009224d00a01", 8_600, 7_100],
    ["0a009224d00c01", 3_200, 2_500],
    ["0815af27ea02c2", 12_500, 9_800],
    ["084ab9a53003c6", 4_200, 3_300],
  ] as const;
  return Object.freeze({
    updatedAt,
    quotes: Object.freeze(rows.flatMap(([modelId, buy, sell]) => [
      Object.freeze({ modelId, side: "buy" as const, price: buy, timestamp: updatedAt }),
      Object.freeze({ modelId, side: "sell" as const, price: sell, timestamp: updatedAt }),
    ])),
  });
}

function demoTraderPriceHistory(
  request: TraderPriceHistoryRequest,
): readonly TraderPricePoint[] {
  const span = request.to - request.from;
  const base = demoTraderQuotes().quotes.find((quote) =>
    quote.modelId === request.modelId && quote.side === "buy")?.price ?? 1_000;
  return Object.freeze(Array.from({ length: 42 }, (_, index) => {
    const timestamp = request.from + span * index / 41;
    const wave = Math.sin(index / 4.2) * 0.08 + index / 900;
    const buy = Math.max(1, Math.round(base * (1 + wave)));
    return [
      Object.freeze({ modelId: request.modelId, side: "buy" as const, price: buy, timestamp }),
      Object.freeze({ modelId: request.modelId, side: "sell" as const, price: Math.round(buy * 0.78), timestamp }),
    ];
  }).flat());
}

function fixture(
  source: TradeSource,
  offset: number,
  sender: string,
  message: string,
): TradeMessage {
  return Object.freeze({
    source,
    timestamp: Date.now() - offset * 60_000,
    sender,
    message,
  });
}
