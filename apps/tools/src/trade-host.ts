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
  const savedApi = api.trade as Partial<GwNativeApi["trade"]>;
  const getSaved = savedApi.getSaved;
  const setSaved = savedApi.setSaved;
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
    getSaved: () => invokeSaved("get", undefined, getSaved),
    setSaved: (value) => setSavedState(value, setSaved),
  });
}

async function setSavedState(
  value: TradeSavedState,
  setSaved: GwNativeApi["trade"]["setSaved"] | undefined,
): Promise<TradeSavedState> {
  const counts = { offers: value.offers.length, players: value.players.length };
  let normalized: TradeSavedState;
  try {
    // Vue may hand us reactive proxies. Rebuild the bounded shared contract so
    // Electron receives a plain structured-cloneable object.
    normalized = parseTradeSavedState(value);
    console.info("[trade:saved] renderer payload normalized", counts);
  } catch (error) {
    console.error("[trade:saved] renderer payload rejected", {
      counts,
      error: rendererError(error),
    });
    throw error;
  }
  return invokeSaved(
    "set",
    counts,
    setSaved ? () => setSaved(normalized) : undefined,
  );
}

async function invokeSaved(
  operation: "get" | "set",
  counts: Readonly<{ offers: number; players: number }> | undefined,
  invoke: (() => Promise<TradeSavedState>) | undefined,
): Promise<TradeSavedState> {
  if (!invoke) {
    console.error("[trade:saved] renderer bridge unavailable", { operation, counts });
    throw new Error("trade_saved_restart_required");
  }
  console.info("[trade:saved] renderer invoke", { operation, counts });
  try {
    const saved = await invoke();
    console.info("[trade:saved] renderer completed", {
      operation,
      offers: saved.offers.length,
      players: saved.players.length,
    });
    return saved;
  } catch (error) {
    console.error("[trade:saved] renderer failed", {
      operation,
      counts,
      error: rendererError(error),
    });
    throw error;
  }
}

/** Never let saved player names, offer text, or open-ended errors enter the console. */
function rendererError(error: unknown): Readonly<{ name: string; reason: string }> {
  if (!(error instanceof Error)) return { name: typeof error, reason: "non-error" };
  const forwarded = /trade_saved_(?:get|set)_failed:([a-z0-9_-]+)/u.exec(error.message)?.[1];
  const reason = forwarded
    ?? (error.message.includes("duplicate saved trade entry")
    ? "duplicate-entry"
    : error.message.includes("invalid saved trade state")
      ? "invalid-state"
      : error.message.includes("No handler registered")
        ? "missing-ipc-handler"
        : error.message.includes("trade_saved_restart_required")
          ? "bridge-unavailable"
          : "ipc-failed");
  return { name: error.name, reason };
}

const DEMO_MESSAGES: readonly TradeMessage[] = [
  fixture("kamadan", 1, "Tyria Cartographer", "WTS arms 29e each — trade me in Kamadan"),
  fixture("kamadan", 2, "Rin of the Isles", "WTB cupcakes, need several stacks"),
  fixture("kamadan", 3, "Silver Wayfarer", "WTS 105 consets — 1e each"),
  fixture("kamadan", 4, "Acolyte Mira", "WTS chocolate bunnies 4e per stack"),
  fixture("kamadan", 5, "Artic Voyager", "WTB +5 energy spear, message your offer"),
  fixture("kamadan", 6, "Quiet Ember", "WTS unded Polar Bear 100a | Envoy Axe 20a | q12 Eblade 6a"),
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
      const player = query.startsWith("user:") ? query.slice(5).trim() : null;
      return {
        ...request,
        messages: DEMO_MESSAGES.filter((message) =>
          message.source === request.source
          && (player === null
            ? message.message.toLocaleLowerCase().includes(query)
            : message.sender.toLocaleLowerCase().includes(player))
        ),
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
