/** Currency glyph spans protect native text, ambiguous prefixes and the shared alias catalogue. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENCY_ALIASES } from '../../src/shared/hub-calculator.ts';
import { recogniseCurrencyTokens } from '../../src/shared/hub-currency-tokens.ts';
test('currency glyphs keep exact spans for prefixes, compact amounts and multiword aliases', () => {
  for (const [text, expected] of [
    ['10 ectos in p', [[3, 8, 'ecto'], [12, 13, 'platinum']]],
    ['10 ec in plat', [[3, 5, 'ecto'], [9, 13, 'platinum']]],
    ['10 ec in pla', [[3, 5, 'ecto']]],
    ['1 a + 1 b in p', [[2, 3, 'armbrace'], [13, 14, 'platinum']]],
    ['10e + 1k + 5plat', [[2, 3, 'ecto'], [7, 8, 'platinum'], [12, 16, 'platinum']]],
    ['1 armbrace of t in zaishen ke', [[2, 15, 'armbrace'], [19, 29, 'zkey']]],
    ['1 armbrace   of truth in e each', [[2, 21, 'armbrace'], [25, 26, 'ecto']]],
    ['2 stacks + 10 in to each ea stk', []],
  ] as const) {
    assert.deepEqual(recogniseCurrencyTokens(text).map(({ start, end, unit }) => [start, end, unit]), expected, text);
  }
});
test('every canonical alias is available without maintaining a second glyph list', () => {
  for (const [alias, unit] of Object.entries(CURRENCY_ALIASES)) {
    const text = `10 ${alias}`;
    assert.deepEqual(recogniseCurrencyTokens(text), [{ start: 3, end: text.length, unit }], alias);
  }
});
