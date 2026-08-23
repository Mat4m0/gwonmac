import {
  TRADE_LIMITS,
  type TradeMessage,
  type TradeSearchMatch,
} from "../../../src/shared/trade-chat";

export type TradeIntent = "all" | "selling" | "buying";
export type TradeLedgerRow = Readonly<{ message: TradeMessage; postCount: number }>;

export function tradeMessageIntents(message: string): Exclude<TradeIntent, "all">[] {
  const selling = /(?:^|[^a-z0-9])wts(?:$|[^a-z0-9])/iu.test(message);
  const buying = /(?:^|[^a-z0-9])wtb(?:$|[^a-z0-9])/iu.test(message);
  return [selling ? "selling" : null, buying ? "buying" : null]
    .filter((value): value is Exclude<TradeIntent, "all"> => value !== null);
}

export function liveLedgerRows(
  messages: readonly TradeMessage[],
  intent: TradeIntent,
): TradeLedgerRow[] {
  return messages
    .filter((message) => matchesIntent(message, intent))
    .map((message) => ({ message, postCount: 1 }));
}

export function searchLedgerRows(
  matches: readonly TradeSearchMatch[],
  intent: TradeIntent,
): TradeLedgerRow[] {
  return matches.filter(({ message }) => matchesIntent(message, intent));
}

export function insertTradeMessage(
  messages: readonly TradeMessage[],
  message: TradeMessage,
  limit = TRADE_LIMITS.liveMessages,
): TradeMessage[] {
  const withoutReplacement = message.replacementTimestamp === undefined
    ? messages
    : messages.filter((candidate) => candidate.timestamp !== message.replacementTimestamp);
  if (withoutReplacement.some((candidate) => candidate.timestamp === message.timestamp)) {
    return [...withoutReplacement];
  }
  return [message, ...withoutReplacement]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit);
}

function matchesIntent(message: TradeMessage, intent: TradeIntent): boolean {
  return intent === "all" || tradeMessageIntents(message.message).includes(intent);
}
