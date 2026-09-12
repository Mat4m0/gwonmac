/** Arithmetic, currency direction and refusal tests for the offline calculator. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, decimal, convertCurrency, formatFraction, parseConversion } from '../../src/shared/hub-calculator.ts';
test('decimal arithmetic is exact, bounded, and honours precedence', () => {
  assert.equal(formatFraction(calculate('0.1 + 0.2')!), '0.3');
  assert.equal(formatFraction(calculate('(2 + 3) * 4')!), '20');
  assert.equal(formatFraction(calculate('10 / 3')!), '3.333333');
  assert.throws(() => calculate('1 / 0'), /zero/);
  assert.equal(calculate('fetch(1)'), null);
  assert.throws(() => calculate('1..2 + 3'));
});
test('fixed and observed rates retain direction and units', () => {
  const conversion = parseConversion('10 ecto in p')!;
  assert.equal(conversion.from, 'ecto');
  assert.equal(formatFraction(convertCurrency(conversion.amount, conversion.from, conversion.to, 5000)), '50');
  assert.equal(formatFraction(convertCurrency(decimal('50'), 'platinum', 'ecto', 5000)), '10');
  assert.equal(formatFraction(convertCurrency(decimal('1250'), 'gold', 'platinum')), '1.25');
  assert.throws(() => convertCurrency(decimal('10'), 'ecto', 'platinum'), /unavailable/);
  assert.equal(parseConversion('10 unknown in p'), null);
});

test('a late quote cannot replace a new query or revive a disabled market', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  let enabled = true;
  let resolve!: (value: import('../../src/shared/trade-chat.ts').TraderQuoteSnapshot) => void;
  const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => enabled,
    quotes: () => new Promise(done => { resolve = done; }) });
  source.setVisible(true);
  assert.equal(source.search('10 ecto in p')[0]?.id, 'quote-state');
  source.search('2 + 3');
  resolve({ updatedAt: Date.now(), quotes: [{ modelId: '0b03a2', side: 'buy', price: 6000, timestamp: Date.now() }] });
  await Promise.resolve();
  assert.equal(source.search('2 + 3')[0]?.title, '5');
  enabled = false;
  assert.deepEqual(source.search('10 ecto in p'), []);
  source.setVisible(false);
});

test('market rows distinguish buy, sell, and stale observation', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => true,
    quotes: async () => ({ updatedAt: Date.now(), quotes: [
      { modelId: '0b03a2', side: 'buy', price: 6000, timestamp: Date.now() },
      { modelId: '0b03a2', side: 'sell', price: 5000, timestamp: Date.now() - 3600000 },
    ] }) });
  source.setVisible(true); source.search('10 ecto in p'); await Promise.resolve();
  const rows = source.search('10 ecto in p');
  assert.equal(rows[0]?.title, '60 platinum'); assert.match(rows[0]!.detail, /Buy from trader/);
  rows[0]?.quoteBasis?.choose('sell');
  const sell=source.search('10 ecto in p')[0]!;
  assert.equal(sell.title, '50 platinum'); assert.match(sell.detail, /Sell to trader.*Last observed/);
  source.setVisible(false);
});

test('trading shorthand accepts compact quantities, stacks and mixed sums without guesses', async () => {
  const { evaluateConversion, fraction } = await import('../../src/shared/hub-calculator.ts');
  for(const input of ['1p in a','1 p in armbraces','1 platinum to arms']) assert.equal(parseConversion(input)?.to,'armbrace');
  const rates = (unit: import('../../src/shared/hub-calculator.ts').Currency) => fraction(unit==='gold'?1n:unit==='platinum'?1000n:unit==='ecto'?5000n:150000n);
  const value=(query:string)=>formatFraction(evaluateConversion(parseConversion(query)!,rates));
  assert.equal(value('100k + 10e in a'),'1');
  assert.equal(value('1 stack ecto in p'),'1250');
  assert.equal(value('250 * 1.5e in p'),'1875');
  assert.equal(value('14a per stack in e each'),'1.68');
  assert.equal(value('.5e in p'),'2.5');
  assert.equal(value('500e in stacks e'),'2');
  assert.equal(parseConversion('1 set in a'),null);
  assert.equal(parseConversion('1 ecot in p'),null);
  assert.equal(parseConversion('1,500p in a'),null);
  assert.throws(()=>parseConversion('1 stack gold in p'),/no item stack/);
});

test('common materials divide batch quotes before conversion', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  const source=createHubCalculator({copy:async()=>{},marketEnabled:()=>true,quotes:async()=>({updatedAt:Date.now(),quotes:[{modelId:'0b03a5',side:'buy',price:390,timestamp:Date.now()}]})});
  source.setVisible(true);source.search('10 feathers in g');await Promise.resolve();
  assert.equal(source.search('10 feathers in g')[0]?.title,'390 gold');
  source.setVisible(false);
});
