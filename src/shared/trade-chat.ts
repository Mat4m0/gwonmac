/**
 * The complete, bounded contract for the two public GWToolbox trade feeds.
 *
 * Network payloads are deliberately converted here before either process may
 * use them. The renderer receives only these values; it never receives raw
 * WebSocket frames or a URL it could change.
 */

export const TRADE_SOURCES = ["kamadan", "pre-searing"] as const;
export type TradeSource = (typeof TRADE_SOURCES)[number];

export const TRADE_LIMITS = Object.freeze({
  queryCharacters: 128,
  senderCharacters: 128,
  messageCharacters: 1_024,
  liveMessages: 100,
  searchResults: 200,
  savedOffers: 100,
  savedPlayers: 100,
  payloadBytes: 1024 * 1024,
});

export const TRADE_SOURCE_URLS: Readonly<
  Record<TradeSource, { readonly websocket: string; readonly website: string }>
> = Object.freeze({
  kamadan: Object.freeze({
    websocket: "wss://kamadan.gwtoolbox.com",
    website: "https://kamadan.gwtoolbox.com",
  }),
  "pre-searing": Object.freeze({
    websocket: "wss://ascalon.gwtoolbox.com",
    website: "https://ascalon.gwtoolbox.com",
  }),
});

export type TradeConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "unavailable";

export type TradeMessage = Readonly<{
  source: TradeSource;
  timestamp: number;
  sender: string;
  message: string;
  replacementTimestamp?: number;
}>;

export type TradeSnapshot = Readonly<{
  source: TradeSource;
  status: TradeConnectionState;
  messages: readonly TradeMessage[];
}>;

export type TradeSearchRequest = Readonly<{
  source: TradeSource;
  query: string;
}>;

export type TradeSearchResult = Readonly<{
  source: TradeSource;
  query: string;
  messages: readonly TradeMessage[];
}>;

export type TradeSavedOffer = TradeMessage & Readonly<{ savedAt: number }>;
export type TradeSavedPlayer = Readonly<{ sender: string; savedAt: number }>;
export type TradeSavedState = Readonly<{
  offers: readonly TradeSavedOffer[];
  players: readonly TradeSavedPlayer[];
}>;

export const EMPTY_TRADE_SAVED_STATE: TradeSavedState = Object.freeze({
  offers: Object.freeze([]),
  players: Object.freeze([]),
});

export type TradeEvent =
  | Readonly<{
      type: "status";
      source: TradeSource;
      status: TradeConnectionState;
    }>
  | Readonly<{
      type: "message";
      source: TradeSource;
      message: TradeMessage;
    }>;

export function isTradeSource(value: unknown): value is TradeSource {
  return TRADE_SOURCES.includes(value as TradeSource);
}

export function parseTradeSource(value: unknown): TradeSource {
  if (!isTradeSource(value)) throw new TypeError("invalid trade source");
  return value;
}

export function parseTradeSearchRequest(value: unknown): TradeSearchRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["source", "query"])) {
    throw new TypeError("invalid trade search request");
  }
  const source = parseTradeSource(value.source);
  if (typeof value.query !== "string") throw new TypeError("invalid trade query");
  const query = value.query.trim();
  if (query.length === 0 || countCharacters(query) > TRADE_LIMITS.queryCharacters) {
    throw new TypeError("invalid trade query");
  }
  return Object.freeze({ source, query });
}

export function parseTradeSavedState(value: unknown): TradeSavedState {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["offers", "players"])
    || !Array.isArray(value.offers)
    || !Array.isArray(value.players)
    || value.offers.length > TRADE_LIMITS.savedOffers
    || value.players.length > TRADE_LIMITS.savedPlayers
  ) throw new TypeError("invalid saved trade state");

  const offers = value.offers.map((candidate) => parseSavedOffer(candidate));
  const players = value.players.map((candidate) => parseSavedPlayer(candidate));
  if (offers.some((offer) => offer === null) || players.some((player) => player === null)) {
    throw new TypeError("invalid saved trade state");
  }
  const typedOffers = offers as TradeSavedOffer[];
  const typedPlayers = players as TradeSavedPlayer[];
  if (
    new Set(typedOffers.map((offer) => `${offer.source}:${offer.timestamp}`)).size
      !== typedOffers.length
    || new Set(typedPlayers.map((player) => player.sender.toLocaleLowerCase())).size
      !== typedPlayers.length
  ) throw new TypeError("duplicate saved trade entry");
  return Object.freeze({
    offers: Object.freeze(typedOffers),
    players: Object.freeze(typedPlayers),
  });
}

export type ParsedTradePayload =
  | Readonly<{ kind: "message"; message: TradeMessage }>
  | Readonly<{
      kind: "search";
      query: string;
      messages: readonly TradeMessage[];
    }>;

export function parseTradePayload(
  source: TradeSource,
  value: unknown,
): ParsedTradePayload | null {
  if (!isRecord(value)) return null;
  if (typeof value.query === "string" && Array.isArray(value.results)) {
    const query = value.query;
    if (countCharacters(query) > TRADE_LIMITS.queryCharacters) return null;
    const messages: TradeMessage[] = [];
    for (const candidate of value.results.slice(0, TRADE_LIMITS.searchResults)) {
      const message = parseTradeMessage(source, candidate);
      if (message) messages.push(message);
    }
    return Object.freeze({
      kind: "search",
      query,
      messages: Object.freeze(sortNewest(deduplicate(messages))),
    });
  }
  const message = parseTradeMessage(source, value);
  return message ? Object.freeze({ kind: "message", message }) : null;
}

export function parseTradeMessage(
  source: TradeSource,
  value: unknown,
): TradeMessage | null {
  if (!isRecord(value)) return null;
  const timestamp = parseTimestamp(value.t);
  const replacementTimestamp = value.r === undefined
    ? undefined
    : parseTimestamp(value.r);
  if (
    timestamp === null
    || (value.r !== undefined && replacementTimestamp === null)
    || typeof value.s !== "string"
    || typeof value.m !== "string"
    || value.s.length === 0
    || value.m.length === 0
    || countCharacters(value.s) > TRADE_LIMITS.senderCharacters
    || countCharacters(value.m) > TRADE_LIMITS.messageCharacters
  ) return null;
  const message = {
    source,
    timestamp,
    sender: value.s,
    message: value.m,
  };
  return replacementTimestamp === undefined || replacementTimestamp === null
    ? Object.freeze(message)
    : Object.freeze({ ...message, replacementTimestamp });
}

function parseTimestamp(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function parseSavedOffer(value: unknown): TradeSavedOffer | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "source", "timestamp", "sender", "message", "replacementTimestamp", "savedAt",
  ])) return null;
  if (!isTradeSource(value.source)) return null;
  const message = parseTradeMessage(value.source, {
    t: value.timestamp,
    s: value.sender,
    m: value.message,
    ...(value.replacementTimestamp === undefined ? {} : { r: value.replacementTimestamp }),
  });
  const savedAt = parseTimestamp(value.savedAt);
  return message && savedAt !== null ? Object.freeze({ ...message, savedAt }) : null;
}

function parseSavedPlayer(value: unknown): TradeSavedPlayer | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["sender", "savedAt"])
    || typeof value.sender !== "string"
    || value.sender.length === 0
    || countCharacters(value.sender) > TRADE_LIMITS.senderCharacters
  ) return null;
  const savedAt = parseTimestamp(value.savedAt);
  return savedAt === null ? null : Object.freeze({ sender: value.sender, savedAt });
}

function deduplicate(messages: readonly TradeMessage[]): TradeMessage[] {
  const seen = new Set<number>();
  return messages.filter((message) => {
    if (seen.has(message.timestamp)) return false;
    seen.add(message.timestamp);
    return true;
  });
}

function sortNewest(messages: TradeMessage[]): TradeMessage[] {
  return messages.sort((left, right) => right.timestamp - left.timestamp);
}

function countCharacters(value: string): number {
  return [...value].length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
