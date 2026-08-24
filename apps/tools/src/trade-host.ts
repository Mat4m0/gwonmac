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
  });
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
