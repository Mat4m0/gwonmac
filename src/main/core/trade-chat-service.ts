/**
 * Process-wide ownership of the public GWToolbox trade feeds.
 *
 * One connection per named source is shared by every game window. Raw frames,
 * URLs and reconnect mechanics stop here; subscribers receive only the bounded
 * shared contract and no message text is ever written to diagnostics.
 */
import WebSocket, { type ClientOptions, type RawData } from "ws";
import {
  TRADE_LIMITS,
  TRADE_SOURCES,
  TRADE_SOURCE_URLS,
  parseTradePayload,
  type TradeConnectionState,
  type TradeEvent,
  type TradeMessage,
  type TradeSearchResult,
  type TradeSnapshot,
  type TradeSource,
} from "../../shared/trade-chat.js";

const CONNECT_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 8_000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

type TradeServiceTiming = Readonly<{
  searchTimeoutMs: number;
  pingIntervalMs: number;
  pongTimeoutMs: number;
  reconnectDelaysMs: readonly number[];
}>;

export type TradeChatServiceOptions = Readonly<{
  createSocket?: (url: string, options: ClientOptions) => WebSocket;
  random?: () => number;
  timing?: Partial<TradeServiceTiming>;
}>;

type Listener = (event: TradeEvent) => void;

type PendingSearch = {
  readonly promise: Promise<readonly TradeMessage[]>;
  readonly resolve: (result: readonly TradeMessage[]) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

type Feed = {
  readonly source: TradeSource;
  readonly subscribers: Map<number, Listener>;
  readonly pendingSearches: Map<string, PendingSearch>;
  messages: TradeMessage[];
  status: TradeConnectionState;
  socket: WebSocket | null;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
};

export class TradeChatService {
  readonly #feeds = new Map<TradeSource, Feed>(
    TRADE_SOURCES.map((source) => [source, createFeed(source)]),
  );
  readonly #subscriptions = new Map<number, TradeSource>();
  readonly #createSocket: (url: string, options: ClientOptions) => WebSocket;
  readonly #random: () => number;
  readonly #timing: TradeServiceTiming;

  constructor(options: TradeChatServiceOptions = {}) {
    this.#createSocket = options.createSocket ?? ((url, socketOptions) =>
      new WebSocket(url, socketOptions));
    this.#random = options.random ?? Math.random;
    this.#timing = {
      searchTimeoutMs: options.timing?.searchTimeoutMs ?? SEARCH_TIMEOUT_MS,
      pingIntervalMs: options.timing?.pingIntervalMs ?? PING_INTERVAL_MS,
      pongTimeoutMs: options.timing?.pongTimeoutMs ?? PONG_TIMEOUT_MS,
      reconnectDelaysMs: options.timing?.reconnectDelaysMs ?? RECONNECT_DELAYS_MS,
    };
  }

  subscribe(id: number, source: TradeSource, listener: Listener): TradeSnapshot {
    this.unsubscribe(id);
    const feed = this.#feed(source);
    this.#subscriptions.set(id, source);
    feed.subscribers.set(id, listener);
    if (!feed.socket && !feed.reconnectTimer) this.#connect(feed);
    return Object.freeze({
      source,
      status: feed.status,
      messages: Object.freeze([...feed.messages]),
    });
  }

  unsubscribe(id: number): void {
    const source = this.#subscriptions.get(id);
    if (!source) return;
    this.#subscriptions.delete(id);
    const feed = this.#feed(source);
    feed.subscribers.delete(id);
    if (feed.subscribers.size === 0) this.#stop(feed);
  }

  search(
    id: number,
    source: TradeSource,
    query: string,
    scope: "all" | "player",
  ): Promise<TradeSearchResult> {
    if (this.#subscriptions.get(id) !== source) {
      return Promise.reject(new Error("trade source is not subscribed"));
    }
    const playerQuery = `user:${query}`;
    const queries = scope === "player" ? [playerQuery] : [query];
    if (
      scope === "all"
      && [...playerQuery].length <= TRADE_LIMITS.queryCharacters
    ) queries.push(playerQuery);
    return Promise.allSettled(queries.map((candidate) => this.#query(source, candidate)))
      .then((results) => {
        const messages = results.flatMap((result) => result.status === "fulfilled"
          ? result.value
          : []);
        if (messages.length === 0 && results.every((result) => result.status === "rejected")) {
          throw new Error("trade search failed");
        }
        return Object.freeze({ source, query, messages: mergeSearchMessages(messages) });
      });
  }

  #query(source: TradeSource, query: string): Promise<readonly TradeMessage[]> {
    const feed = this.#feed(source);
    if (feed.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("trade feed is not connected"));
    }
    const existing = feed.pendingSearches.get(query);
    if (existing) return existing.promise;

    let resolve!: (result: readonly TradeMessage[]) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<readonly TradeMessage[]>((accept, refuse) => {
      resolve = accept;
      reject = refuse;
    });
    const timer = setTimeout(() => {
      const pending = feed.pendingSearches.get(query);
      if (!pending) return;
      feed.pendingSearches.delete(query);
      pending.reject(new Error("trade search timed out"));
    }, this.#timing.searchTimeoutMs);
    feed.pendingSearches.set(query, { promise, resolve, reject, timer });
    feed.socket.send(JSON.stringify({ query }), (error) => {
      if (!error) return;
      this.#rejectSearch(feed, query, new Error("trade search could not be sent"));
    });
    return promise;
  }

  retry(id: number, source: TradeSource): void {
    if (this.#subscriptions.get(id) !== source) return;
    const feed = this.#feed(source);
    if (feed.subscribers.size === 0) return;
    this.#clearReconnect(feed);
    if (feed.socket) {
      feed.closing = true;
      feed.socket.terminate();
      feed.socket = null;
    }
    feed.reconnectAttempt = 0;
    this.#connect(feed);
  }

  dispose(): void {
    this.#subscriptions.clear();
    for (const feed of this.#feeds.values()) {
      feed.subscribers.clear();
      this.#stop(feed);
    }
  }

  #connect(feed: Feed): void {
    if (feed.socket || feed.subscribers.size === 0) return;
    feed.closing = false;
    this.#setStatus(feed, feed.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    const socket = this.#createSocket(TRADE_SOURCE_URLS[feed.source].websocket, {
      followRedirects: false,
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      maxPayload: TRADE_LIMITS.payloadBytes,
      perMessageDeflate: false,
      headers: { "User-Agent": "GWonMac Trade Chat" },
    });
    feed.socket = socket;

    socket.on("open", () => {
      if (feed.socket !== socket) return;
      feed.reconnectAttempt = 0;
      this.#setStatus(feed, "live");
      socket.send(JSON.stringify({ query: " " }));
      this.#startHeartbeat(feed, socket);
    });
    socket.on("pong", () => {
      if (feed.socket !== socket) return;
      if (feed.pongTimer) clearTimeout(feed.pongTimer);
      feed.pongTimer = null;
    });
    socket.on("message", (data) => this.#onMessage(feed, data));
    socket.on("error", () => {
      // `close` owns the state transition and bounded reconnect. Error text may
      // contain network details and is deliberately not logged.
    });
    socket.on("close", () => {
      if (feed.socket !== socket) return;
      feed.socket = null;
      this.#clearHeartbeat(feed);
      this.#rejectAllSearches(feed, new Error("trade feed disconnected"));
      if (feed.closing || feed.subscribers.size === 0) return;
      this.#scheduleReconnect(feed);
    });
  }

  #onMessage(feed: Feed, data: RawData): void {
    const bytes = rawBytes(data);
    if (bytes.byteLength > TRADE_LIMITS.payloadBytes) return;
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      return;
    }
    const payload = parseTradePayload(feed.source, value);
    if (!payload) return;
    if (payload.kind === "search") {
      if (payload.query === " ") {
        for (const message of [...payload.messages].reverse()) {
          this.#insertMessage(feed, message);
        }
        return;
      }
      const pending = feed.pendingSearches.get(payload.query);
      if (!pending) return;
      feed.pendingSearches.delete(payload.query);
      clearTimeout(pending.timer);
      pending.resolve(payload.messages);
      return;
    }
    this.#insertMessage(feed, payload.message);
  }

  #insertMessage(feed: Feed, message: TradeMessage): void {
    if (message.replacementTimestamp !== undefined) {
      feed.messages = feed.messages.filter(
        (candidate) => candidate.timestamp !== message.replacementTimestamp,
      );
    }
    if (feed.messages.some((candidate) => candidate.timestamp === message.timestamp)) return;
    feed.messages = [message, ...feed.messages]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, TRADE_LIMITS.liveMessages);
    this.#emit(feed, Object.freeze({
      type: "message",
      source: feed.source,
      message,
    }));
  }

  #startHeartbeat(feed: Feed, socket: WebSocket): void {
    this.#clearHeartbeat(feed);
    feed.pingTimer = setInterval(() => {
      if (feed.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      socket.ping();
      if (feed.pongTimer) clearTimeout(feed.pongTimer);
      feed.pongTimer = setTimeout(() => socket.terminate(), this.#timing.pongTimeoutMs);
    }, this.#timing.pingIntervalMs);
  }

  #scheduleReconnect(feed: Feed): void {
    this.#setStatus(feed, "reconnecting");
    const index = Math.min(feed.reconnectAttempt, this.#timing.reconnectDelaysMs.length - 1);
    const base = this.#timing.reconnectDelaysMs[index]!;
    feed.reconnectAttempt += 1;
    const delay = Math.round(base * (0.8 + this.#random() * 0.4));
    feed.reconnectTimer = setTimeout(() => {
      feed.reconnectTimer = null;
      this.#connect(feed);
    }, delay);
  }

  #setStatus(feed: Feed, status: TradeConnectionState): void {
    if (feed.status === status) return;
    feed.status = status;
    this.#emit(feed, Object.freeze({ type: "status", source: feed.source, status }));
  }

  #emit(feed: Feed, event: TradeEvent): void {
    for (const listener of feed.subscribers.values()) listener(event);
  }

  #stop(feed: Feed): void {
    feed.closing = true;
    this.#clearReconnect(feed);
    this.#clearHeartbeat(feed);
    this.#rejectAllSearches(feed, new Error("trade feed closed"));
    if (feed.socket) {
      const socket = feed.socket;
      feed.socket = null;
      socket.close();
    }
    feed.status = "unavailable";
    feed.reconnectAttempt = 0;
  }

  #clearReconnect(feed: Feed): void {
    if (feed.reconnectTimer) clearTimeout(feed.reconnectTimer);
    feed.reconnectTimer = null;
  }

  #clearHeartbeat(feed: Feed): void {
    if (feed.pingTimer) clearInterval(feed.pingTimer);
    if (feed.pongTimer) clearTimeout(feed.pongTimer);
    feed.pingTimer = null;
    feed.pongTimer = null;
  }

  #rejectSearch(feed: Feed, query: string, error: Error): void {
    const pending = feed.pendingSearches.get(query);
    if (!pending) return;
    feed.pendingSearches.delete(query);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  #rejectAllSearches(feed: Feed, error: Error): void {
    for (const query of [...feed.pendingSearches.keys()]) {
      this.#rejectSearch(feed, query, error);
    }
  }

  #feed(source: TradeSource): Feed {
    return this.#feeds.get(source)!;
  }
}

function mergeSearchMessages(messages: readonly TradeMessage[]): readonly TradeMessage[] {
  const unique = new Map<number, TradeMessage>();
  for (const message of messages) unique.set(message.timestamp, message);
  return Object.freeze([...unique.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, TRADE_LIMITS.searchResults)
    .map((message) => Object.freeze(message)));
}

function createFeed(source: TradeSource): Feed {
  return {
    source,
    subscribers: new Map(),
    pendingSearches: new Map(),
    messages: [],
    status: "unavailable",
    socket: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
    pingTimer: null,
    pongTimer: null,
    closing: false,
  };
}

function rawBytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return data;
}
