/**
 * Conservative estimates from explicit Kamadan currency advertisements.
 * Both the native Trade owner and offline Hub fixture use these same rules.
 */
import { decimal, divide, fraction, multiply, type Fraction } from './hub-calculator.js';
import type { TradeMessage } from './trade-chat.js';

export type MarketItem = 'ecto' | 'armbrace' | 'zkey';
export type MarketDenomination = 'gold' | 'ecto' | 'armbrace';
export type MarketSide = 'wtb' | 'wts';
export type MarketObservation = {
  item: MarketItem; denomination: MarketDenomination; side: MarketSide; rate: Fraction;
};
export type MarketQuote = Omit<MarketObservation, 'rate'> & {
  numerator: string; denominator: string; advertisers: number; oldest: number; newest: number;
};
export type MarketSnapshot = { sample?: true; fetchedAt: number; quotes: readonly MarketQuote[] };
export const MARKET_MAX_AGE_MS = 72 * 60 * 60_000;
export const MARKET_CACHE_MS = 5 * 60_000;
export const MARKET_MIN_ADVERTISERS = 5;
export const MARKET_SEARCHES = ['armbrace', 'arms', 'zkey', 'zaishen key', 'ectos'] as const;

const amount = '(?:[0-9]{1,6}(?:[.,][0-9]{1,2})?)';
const item = '(armbraces?(?: of truth)?|arms?|zaishen keys?|zkeys?|ectos?|ectoplasm)';
const priceUnit = '(ectoplasm|ectos?|e|armbraces?|arms?|a|platinum|plat|gold|[gpk])';
// A quantity followed by "for" or "=" is a total. Bare quantity + price is refused.
const listing = new RegExp(`^(?:(?:(${amount})\\s*x?\\s*|x\\s*(${amount})\\s*))?(?:(stack)\\s+(?:of\\s+)?)?${item}\\s*(?:(?:x\\s*(${amount}))|(stack))?\\s*(?:(for|=|:)\\s*|-\\s+)?(${amount})\\s*${priceUnit}(?:\\s*(?:/|-|per\\s+)?\\s*(each|ea|stk|stack))?\\s*(.*)$`, 'u');
const suffix = /^(?:[!. ]*(?:(?:\(x?\d+\)|x\d+|pm(?: me)?|open trade|\(\d+ left\))\s*)*)$/u;
const normalizeItem = (name: string): MarketItem => /^(?:arm|a$)/u.test(name) ? 'armbrace' : /^(?:zkey|zaishen)/u.test(name) ? 'zkey' : 'ecto';

export function extractMarketObservations(message: string): MarketObservation[] {
  if (message.length > 1024 || /\b(?:gw2|guild wars 2|wtt|tip|service|tour)\b/iu.test(message)) return [];
  const result: MarketObservation[] = [];
  let side: MarketSide | undefined;
  for (const raw of message.toLowerCase().split(/(?=\bwt[bs]\b)|\||;|\/\/|,\s+/u)) {
    let segment = raw.trim();
    const intent = /^(wtb|wts)\b\s*:?\s*/u.exec(segment);
    if (intent) { side = intent[1] === 'wtb' ? 'wtb' : 'wts'; segment = segment.slice(intent[0].length); }
    if (!side) continue;
    segment = segment.replace(new RegExp(`^${item}\\s+(${amount})\\s+(for|=)\\s+`, 'u'), '$2 $1 $3 ');
    const match = listing.exec(segment);
    if (!match) continue;
    const [, count, xCount, stackBefore, name, countAfter, stackAfter, relation, price, unit, per, tail] = match;
    if (!name || !price || !unit || !suffix.test(tail ?? '')) continue;
    const quantityText = count ?? xCount ?? countAfter;
    const isStack = !!(stackBefore || stackAfter);
    if (quantityText && !per && !relation) continue;
    if (isStack && per === 'each') continue;
    const quantity = quantityText ? Number(quantityText) : 1;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;
    const denominator = per === 'stk' || per === 'stack' ? 250 : per ? 1 : quantity * (isStack ? 250 : 1);
    if (!Number.isSafeInteger(denominator) || denominator <= 0) continue;
    const currency: MarketDenomination = /^(?:e|ecto)/u.test(unit) ? 'ecto' : /^(?:a|arm)/u.test(unit) ? 'armbrace' : 'gold';
    const source = normalizeItem(name);
    if (!(source === 'ecto' && currency === 'gold') && !(source === 'armbrace' && currency === 'ecto') && !(source === 'zkey' && (currency === 'ecto' || currency === 'armbrace'))) continue;
    try {
      let value = decimal(price.replace(',', '.'));
      if (currency === 'gold' && unit !== 'gold' && unit !== 'g') value = multiply(value, fraction(1000n));
      value = divide(value, fraction(BigInt(denominator)));
      if (value.n <= 0n) continue;
      result.push({ item: source, denomination: currency, side, rate: value });
    } catch { /* Malformed prices contribute no evidence. */ }
  }
  return result;
}

const compare = (a: Fraction, b: Fraction) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const ratio = (value: Fraction) => Number(value.n) / Number(value.d);

export function estimateMarketRates(messages: readonly TradeMessage[], now = Date.now()): MarketSnapshot {
  const buckets = new Map<string, Array<MarketObservation & { timestamp: number }>>();
  const seen = new Set<string>();
  // One most recent advertisement per sender prevents a repeated ad gaining votes.
  // If its price is missing, older prices from that sender are not resurrected.
  for (const message of [...messages].sort((a, b) => b.timestamp - a.timestamp)) {
    if (message.source !== 'kamadan' || message.timestamp > now || now - message.timestamp > MARKET_MAX_AGE_MS) continue;
    const sender = message.sender.toLowerCase().trim();
    if (!sender || seen.has(sender)) continue;
    seen.add(sender);
    const observations = extractMarketObservations(message.message);
    const local = new Set<string>();
    for (const observation of observations) {
      const key = `${observation.item}:${observation.denomination}:${observation.side}`;
      if (local.has(key) || observations.filter(candidate => `${candidate.item}:${candidate.denomination}:${candidate.side}` === key).length !== 1) continue;
      local.add(key);
      const entries = buckets.get(key) ?? [];
      entries.push({ ...observation, timestamp: message.timestamp }); buckets.set(key, entries);
    }
  }
  const quotes: MarketQuote[] = [];
  for (const entries of buckets.values()) {
    if (entries.length < MARKET_MIN_ADVERTISERS) continue;
    entries.sort((a, b) => compare(a.rate, b.rate));
    const middle = entries[Math.floor(entries.length / 2)]!;
    const center = ratio(middle.rate);
    const agreed = entries.filter(entry => Math.abs(ratio(entry.rate) / center - 1) <= 0.2);
    if (agreed.length < MARKET_MIN_ADVERTISERS || agreed.length / entries.length < 0.8) continue;
    const newest = Math.max(...agreed.map(entry => entry.timestamp));
    if (now - newest > 24 * 60 * 60_000) continue;
    const low = agreed[Math.floor((agreed.length - 1) / 2)]!.rate;
    const high = agreed[Math.floor(agreed.length / 2)]!.rate;
    const median = fraction(low.n * high.d + high.n * low.d, 2n * low.d * high.d);
    quotes.push({ item: middle.item, denomination: middle.denomination, side: middle.side,
      numerator: String(median.n), denominator: String(median.d), advertisers: agreed.length,
      oldest: Math.min(...agreed.map(entry => entry.timestamp)), newest });
  }
  return { fetchedAt: now, quotes };
}
