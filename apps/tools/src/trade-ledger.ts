/**
 * Owns what one Trade ledger row set is: which loaded messages the intent filter and
 * the typed words keep, in the feed's newest-first order, and where those words
 * appear in a message for highlighting. Searching the feed stays upstream; this only
 * narrows what is already loaded.
 */
import {
  TRADE_LIMITS,
  type TradeMessage,
} from "../../../src/shared/trade-chat";

export type TradeIntent = "all" | "selling" | "buying";

export function tradeMessageIntents(message: string): Exclude<TradeIntent, "all">[] {
  const selling = /(?:^|[^a-z0-9])wts(?:$|[^a-z0-9])/iu.test(message);
  const buying = /(?:^|[^a-z0-9])wtb(?:$|[^a-z0-9])/iu.test(message);
  return [selling ? "selling" : null, buying ? "buying" : null]
    .filter((value): value is Exclude<TradeIntent, "all"> => value !== null);
}

/** The words of a typed filter: case-insensitive, in any order. */
function filterWords(text: string): string[] {
  return text.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

/** The loaded messages whose sender or text contains every typed word, order kept. */
export function tradeTextMatches(
  messages: readonly TradeMessage[],
  text: string,
): readonly TradeMessage[] {
  const words = filterWords(text);
  if (!words.length) return messages;
  return messages.filter((message) => {
    const haystack = `${message.sender} ${message.message}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function tradeLedgerRows(
  messages: readonly TradeMessage[],
  intent: TradeIntent,
): TradeMessage[] {
  return messages.filter((message) => matchesIntent(message, intent));
}

/**
 * A message split where the words appear. The highlight is visual only: the text
 * itself is unchanged, so selecting and copying it gives the original wording.
 */
export function tradeMatchSegments(
  message: string,
  text: string,
): { text: string; match: boolean }[] {
  const words = filterWords(text);
  const lower = message.toLocaleLowerCase();
  // Lowercase offsets index the original only when lowercasing keeps the length.
  if (!words.length || lower.length !== message.length) return [{ text: message, match: false }];
  const marked = new Array<boolean>(message.length).fill(false);
  for (const word of words) {
    for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) {
      marked.fill(true, at, at + word.length);
    }
  }
  const segments: { text: string; match: boolean }[] = [];
  for (let index = 0; index < message.length; index += 1) {
    const last = segments.at(-1);
    if (last && last.match === marked[index]) last.text += message[index];
    else segments.push({ text: message[index]!, match: marked[index]! });
  }
  return segments;
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
