/**
 * Recognises currency spans for native search-input glyphs from the parser's aliases.
 * Prefixes describe only unambiguous units; recognition never requests prices or edits text.
 */
import { CURRENCY_ALIASES, type Currency } from './hub-calculator.js';
export type CurrencyToken = Readonly<{ start: number; end: number; unit: Currency }>;
type Prefix = { children: Map<string, Prefix>; unit: Currency | null; exact?: Currency };
const root: Prefix = { children: new Map(), unit: null };
for (const [alias, unit] of Object.entries(CURRENCY_ALIASES)) {
  let node = root;
  for (const character of alias) {
    let next = node.children.get(character);
    if (!next) { next = { children: new Map(), unit }; node.children.set(character, next); }
    else if (next.unit !== unit) next.unit = null;
    node = next;
  }
  node.exact = unit;
}
const letter = /[\p{L}]/u;
const word = /[\p{L}\p{N}']/u;
const reserved = new Set(['in', 'to', 'each', 'ea', 'stack', 'stacks', 'stk']);
export function recogniseCurrencyTokens(text: string): readonly CurrencyToken[] {
  const tokens: CurrencyToken[] = [];
  for (let start = 0; start < text.length;) {
    if (!letter.test(text[start]!)) { start++; continue; }
    let node = root, end = start;
    let best: CurrencyToken | undefined;
    while (end < text.length) {
      let character = text[end]!.toLowerCase();
      let nextEnd = end + 1;
      if (/\s/u.test(character)) {
        character = ' ';
        while (nextEnd < text.length && /\s/u.test(text[nextEnd]!)) nextEnd++;
      }
      const next = node.children.get(character);
      if (!next) break;
      node = next; end = nextEnd;
      const unit = node.exact ?? node.unit;
      if (unit && (end === text.length || !word.test(text[end]!)) &&
          !reserved.has(text.slice(start, end).toLowerCase())) best = { start, end, unit };
    }
    if (best) { tokens.push(best); start = best.end; }
    else { while (start < text.length && word.test(text[start]!)) start++; }
  }
  return tokens;
}
