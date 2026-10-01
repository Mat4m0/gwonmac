/** Arithmetic, currency direction and refusal tests for the offline calculator. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, decimal, convertCurrency, formatFraction, parseConversion } from '../../src/shared/hub-calculator.ts';
test('decimal arithmetic is exact, bounded, and honours precedence', async () => {
  assert.equal(formatFraction(calculate('0.1 + 0.2')!), '0.3');
  assert.equal(formatFraction(calculate('(2 + 3) * 4')!), '20');
  assert.equal(formatFraction(calculate('10 / 3')!), '3.333333');
  assert.throws(() => calculate('1 / 0'), /zero/);
  assert.equal(calculate('fetch(1)'), null);
  assert.throws(() => calculate('1..2 + 3'));
  for (const amount of ['1234567890123', '1.1234567']) assert.throws(() => decimal(amount), { message: 'Use at most 12 whole digits and six decimal places.' });
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => false, quotes: async () => ({ updatedAt: 0, quotes: [] }) });
  for (const [query, title] of [
    ['1 / 0', 'Cannot divide by zero.'], ['1 +', 'Complete the calculation.'], ['1..2 + 3', 'Complete the calculation.'], ['1 + * 2', 'Complete the calculation.'], ['(1 + 2', 'Close the parentheses.'],
    ['1.1234567 + 2', 'Use at most 12 whole digits and six decimal places.'], ['1234567890123 + 2', 'Use at most 12 whole digits and six decimal places.'],
  ]) {
    assert.deepEqual(source.search(query!).map(row => [row.title, row.detail, row.action]), [[title, '', 'Edit calculation']]);
  }

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
  assert.deepEqual(source.search('10 ecto in p').map(row => row.id), ['quote-disabled']);
  source.setVisible(false);
});

test('only a rate-dependent result offers the rates editor (HUB-100)', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  const views: string[] = [];
  const hub = { close() {}, notify() {}, attach: () => () => {}, showRows() {}, showView(title: string) { views.push(title); } };
  const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => true, hub,
    quotes: async () => ({ updatedAt: Date.now(), quotes: [{ modelId: '0b03a2', side: 'buy', price: 6000, timestamp: Date.now() }] }) });
  source.setVisible(true);
  try {
    for (const [query, title] of [['2+2', '4'], ['10p in g', '10,000 gold'], ['250e in stacks e', '1 stack ecto'], ['500e in stacks e', '2 stacks ecto'], ['1g in g', '1 gold'], ['1p in p', '1 platinum'], ['1g + 1p in g', '1,001 gold']] as const) {
      const row = source.search(query)[0];
      assert.equal(row?.title, title); row?.actions?.();
      if(query==='2+2')assert.deepEqual(row?.conversion,{input:'2+2',from:'Calculation',to:'Result'});
      if(['250e in stacks e', '500e in stacks e'].includes(query))assert.equal(row?.detail,'Fixed conversion · 1 stack = 250 items');
      if(['1g in g', '1p in p'].includes(query))assert.equal(row?.detail,'Fixed conversion');
      if(query==='1g + 1p in g')assert.equal(row?.detail,'Fixed conversion · 1 platinum = 1,000 gold');
    }
    assert.deepEqual(views, []);
    source.search('10 ecto in p'); await Promise.resolve();
    source.search('10 ecto in p')[0]?.actions?.();
    assert.deepEqual(views, ['Conversion rates']);
  } finally { source.setVisible(false); }
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

test('sample trader quotes keep the sample marker that sample market rates carry', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  const quotes = [{ modelId: '0b03a2', side: 'buy' as const, price: 6000, timestamp: Date.now() }];
  for (const sample of [true, false]) {
    const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => true,
      quotes: async () => ({ updatedAt: Date.now(), quotes, ...(sample ? { sample: true as const } : {}) }) });
    source.setVisible(true);
    try {
      source.search('10 ecto in p'); await Promise.resolve();
      assert.equal(source.search('10 ecto in p')[0]?.title, sample ? '60 platinum (sample)' : '60 platinum');
    } finally { source.setVisible(false); }
  }
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

// Wrong behavior: editing the amount or reopening the Hub starts redundant price demand,
// and changing market basis replaces the selected card's identity.
test('calculator price evidence survives quantity edits and reopening with a stable basis card', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  const now = Date.now();
  let traderRequests = 0, marketRequests = 0;
  const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => true,
    quotes: async () => { traderRequests++; return { updatedAt: now, quotes: [{ modelId: '0b03a2', side: 'buy', price: 6000, timestamp: now }] }; },
    market: async () => { marketRequests++; return { fetchedAt: now, quotes: [
      ...(['wts', 'wtb'] as const).map(side => ({ item: 'armbrace' as const, denomination: 'ecto' as const, side, numerator: '30', denominator: '1', advertisers: 5, oldest: now, newest: now })),
    ] }; },
  });
  source.setVisible(true);
  try {
    source.search('10e in p'); await Promise.resolve();
    assert.equal(source.search('11e in p')[0]?.title, '66 platinum');
    assert.equal(traderRequests, 1);
    source.setVisible(false); source.setVisible(true);
    assert.equal(source.search('12e in p')[0]?.title, '72 platinum');
    assert.equal(traderRequests, 1);
    source.search('1a in e'); await Promise.resolve();
    const seller = source.search('1a in e')[0]!;
    assert.equal(seller.id, 'market:result');
    seller.quoteBasis!.choose('wtb');
    const buyer = source.search('2a in e')[0]!;
    assert.equal(buyer.id, 'market:result');
    assert.equal(buyer.quoteBasis?.value, 'wtb');
    assert.equal(marketRequests, 1);
  } finally { source.setVisible(false); }
});

test('tiny nonzero calculations retain three significant digits', () => {
  assert.equal(formatFraction(calculate('1 / 999999999999')!), '0.00000000000100');
  assert.equal(formatFraction(calculate('2 / 30000000')!), '0.0000000667');
  assert.equal(formatFraction(calculate('-2 / 30000000')!), '-0.0000000667');
});
test('per-item questions retain the entered each qualifier', () => {
  assert.equal(parseConversion('10 ecto in p each')?.input, '10 ecto each');
});

test('default currency targets preserve canonical aliases and refuse guesses for materials or explicit directions', async () => {
  const { parseDefaultConversion } = await import('../../src/shared/hub-calculator.ts');
  for (const [query, target] of [['10 ecto', 'platinum'], ['1k', 'gold'], ['10 gold', 'platinum'], ['2p', 'gold'], ['1a', 'ecto'], ['1zkey', 'ecto']] as const)
    assert.equal(parseDefaultConversion(query)?.to, target, query);
  for (const query of ['10 iron', '10 ecto in', '10 ecto to', '10e + 1p']) assert.equal(parseDefaultConversion(query), null, query);
});

test('market age describes contributing ads and advances while the calculator stays visible', async t => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  const now = Date.UTC(2026, 8, 30, 12);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => true,
    quotes: async () => ({ updatedAt: now, quotes: [] }),
    market: async () => ({ fetchedAt: now, quotes: [{ item: 'armbrace', denomination: 'ecto', side: 'wts', numerator: '30', denominator: '1', advertisers: 5, oldest: now - 23 * 3600000, newest: now - 23 * 3600000 }] }),
  });
  source.setVisible(true);
  let latest: import('../../src/shared/hub.ts').HubRow | undefined;
  const stop = source.subscribe(() => { latest = source.search('1a in e')[0]; });
  try {
    source.search('1a in e'); await Promise.resolve();
    assert.match(latest!.detail, /Newest ad 23 h ago/);
    assert.doesNotMatch(latest!.detail, /Updated just now/);
    t.mock.timers.tick(600000);
    assert.match(latest!.detail, /Newest ad 23 h 10 min ago/);
  } finally { stop(); source.setVisible(false); }
});
test('unsupported material routes name the limitation without an impossible refresh request', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  let requests = 0;
  const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => true,
    quotes: async () => ({ updatedAt: Date.now(), quotes: [] }),
    market: async () => { requests++; return { fetchedAt: Date.now(), quotes: [] }; },
  });
  source.setVisible(true);
  try {
    const row = source.search('1 iron in a')[0]!;
    assert.match(row.title, /Iron Ingot/);
    assert.equal(row.action, 'Edit calculation');
    assert.equal(requests, 0);
  } finally { source.setVisible(false); }
});
test('saved manual rates never offer an absent material field', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  const source = createHubCalculator({ copy: async () => {}, marketEnabled: () => true,
    settings: () => ({ mode: 'manual', ecto: '5000', armbrace: '30', zkey: '.5' }),
    quotes: async () => ({ updatedAt: Date.now(), quotes: [] }),
  });
  source.setVisible(true);
  try {
    const row = source.search('1 iron in g')[0]!;
    assert.equal(row.title, 'Use automatic observed prices for Iron Ingot');
    assert.equal(row.action, 'Choose rates');
    assert.match(row.detail, /Automatic observed prices/);
    assert.equal(source.search('10e in p')[0]?.title, '50 platinum');
  } finally { source.setVisible(false); }
});

test('manual rate quantities accept grouped numbers and k but refuse ambiguous or unbounded values', async () => {
  const { parseManualRate } = await import('../../src/shared/hub-calculator.ts');
  for (const [entered, expected] of [['5,000','5000'],['5k','5000'],['.5','0.5'],['','']] as const) assert.equal(parseManualRate(entered), expected);
  for (const entered of ['0','-1','5,00','5,000g','999999999999k','1.0000001']) assert.throws(()=>parseManualRate(entered), entered);
});

test('disabled automatic prices offer manual rates without demand', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  let requests=0;
  const source=createHubCalculator({copy:async()=>{},marketEnabled:()=>false,quotes:async()=>{requests++;return {updatedAt:Date.now(),quotes:[]};}});
  source.setVisible(true);
  try {
    const rows=source.search('10e in p');
    assert.deepEqual(rows.map(row => row.id), ['quote-disabled']);
    const row=rows[0]!;
    assert.equal(row.title,'Use your conversion rates');assert.equal(row.action,'Choose rates');
    assert.equal(requests,0);
  } finally {source.setVisible(false);}
});
test('item equivalents retain their limitation in the visible card and clipboard provenance', async () => {
  const { createHubCalculator } = await import('../../src/renderer/hub-calculator.ts');
  let copied='';const now=Date.now();
  const source=createHubCalculator({copy:async value=>{copied=value;},marketEnabled:()=>true,quotes:async()=>({updatedAt:now,quotes:[
    {modelId:'0b03b4',side:'buy',price:390,timestamp:now},{modelId:'0b03a5',side:'buy',price:390,timestamp:now},
  ]})});
  source.setVisible(true);
  try {
    source.search('1 iron in feathers');await Promise.resolve();const row=source.search('1 iron in feathers')[0]!;
    assert.match(row.detail,/Equivalent value/);
    await row.run({live:()=>true,progress(){},done(){}});
    assert.match(copied,/^1 iron = 1 Feather/);assert.match(copied,/Equivalent value/);
  } finally {source.setVisible(false);}
});
