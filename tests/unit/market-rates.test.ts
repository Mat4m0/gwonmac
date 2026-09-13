/** Anonymous listing fixtures verify that only explicit prices become estimates. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractMarketObservations, estimateMarketRates, MARKET_MAX_AGE_MS, type MarketSnapshot } from '../../src/shared/market-rates.js';
import { formatFraction } from '../../src/shared/hub-calculator.js';
import { TradeChatService } from '../../src/main/core/trade-chat-service.js';
import { createHubCalculator } from '../../src/renderer/hub-calculator.js';
const now=Date.now();
const ad=(message:string,index=0,timestamp=now)=>({source:'kamadan' as const,message,sender:`Advertiser ${index}`,timestamp});

test('explicit live-observed syntax preserves quantities, decimals and units',()=>{
  const examples:readonly [string,string][]=[
    ['WTB armbraces 29e/ea open trade','29'],
    ['wts armbrace x4 for 30e each!','30'],
    ['WTB 3 x armbraces 30e/each','30'],
    ['WTS Armbrace of Truth 20e','20'],
    ['WTB 35 Armbraces = 980 ecto','28'],
    ['WTB GotT 5 = 11e | Zkeys 1,5e/ea | Golden Zaishen Coins 6e/ea','1.5'],
    ['WTB ZKey 14a/stk','0.056'],
    ['WTS Zkey Stack 15a','0.06'],
    ['WTS 6 Ectos for 100k','16666.666667'],
    ['WTS Ectos 7 for 100p','14285.714286'],
  ];
  for(const [text,expected] of examples){const observations=extractMarketObservations(text);assert.equal(observations.length,1,text);assert.equal(formatFraction(observations[0]!.rate),expected,text);}
});

test('ambiguous, malformed, unrelated and cross-game ads produce no rate',()=>{
  for(const text of ['WTS armbraces','WTS 54 ZKEYS 95E','wts 2 armbraces 58e','WTS armbraces 30/ea','WTS Armbrace of Trush 30e','WTB Gold Zaishen Coins 7e/ea','WTS 1x Stack Summ Zaishen Stones = 1a','WTT GW2 mystic coins for armbraces 10:1','WTB EOTN TOUR tip 1 armbrace','WTS armbraces x100a','WTS armbraces -30e','WTS armbraces 0e','WTS armbraces 30e or 35e','WTS emerald blade q11 / Armbrace 30e'])assert.deepEqual(extractMarketObservations(text),[],text);
});

test('median separates sides, deduplicates advertisers and refuses weak or divided evidence',()=>{
  const ads=Array.from({length:6},(_,i)=>ad(`WTS armbraces ${29+i%3}e/ea`,i));
  const snapshot=estimateMarketRates([...ads,...Array.from({length:40},()=>ads[0]!),ad('WTS armbraces 500e',99)],now);
  assert.equal(snapshot.quotes.length,1);assert.equal(snapshot.quotes[0]?.advertisers,6);
  assert.equal(Number(snapshot.quotes[0]?.numerator)/Number(snapshot.quotes[0]?.denominator),30);
  assert.deepEqual(estimateMarketRates(ads.slice(0,4),now).quotes,[]);
  assert.deepEqual(estimateMarketRates([...ads.slice(0,3),...Array.from({length:3},(_,i)=>ad('WTS armbrace 100e',i+3))],now).quotes,[]);
  assert.deepEqual(estimateMarketRates(ads.map(entry=>({...entry,timestamp:now-MARKET_MAX_AGE_MS-1})),now).quotes,[]);
  assert.deepEqual(estimateMarketRates(ads.map(entry=>({...entry,timestamp:now+1})),now).quotes,[]);
  assert.deepEqual(estimateMarketRates(ads.map(entry=>({...entry,timestamp:now-25*60*60_000})),now).quotes,[]);
  assert.deepEqual(estimateMarketRates([...ads.slice(0,5),ad('WTS armbraces',0,now+1)],now+1).quotes,[]);
  assert.deepEqual(estimateMarketRates(ads.map((entry,i)=>({...entry,message:i<3?'WTS armbraces 30e':'WTB armbraces 30e'})),now).quotes,[]);
});

test('Trade owns fixed endpoint demand, coalescing, cache and bounded pagination',async()=>{
  const urls:string[]=[];
  const service=new TradeChatService({fetch:async(input)=>{
    urls.push(String(input));await Promise.resolve();
    return new Response(JSON.stringify({results:Array.from({length:25},(_,i)=>({s:`Sender ${i}`,m:'WTS armbrace 30e',t:now-i*60_000}))}));
  }});
  const [first,second]=await Promise.all([service.getMarketRates(),service.getMarketRates()]);
  assert.equal(first,second);assert.equal(first.quotes.length,1);assert.equal(urls.length,10);
  assert.ok(urls.every(url=>url.startsWith('https://kamadan.gwtoolbox.com/s/')));
  assert.equal(await service.getMarketRates(),first);assert.equal(urls.length,10);
  service.dispose();await assert.rejects(service.getMarketRates(),/disposed/);
});

test('malformed data and rate limiting stay quiet and do not cause request storms',async()=>{
  let calls=0;const service=new TradeChatService({fetch:async()=>{calls++;return new Response('',{status:429});}});
  assert.deepEqual((await service.getMarketRates()).quotes,[]);
  await service.getMarketRates();assert.equal(calls,1);service.dispose();
  const malformed=new TradeChatService({fetch:async()=>new Response(JSON.stringify({results:[{m:'WTS armbrace 30e'}]}))});
  assert.deepEqual((await malformed.getMarketRates()).quotes,[]);malformed.dispose();
});

test('Hub labels inferred results, retains side on copy and never fills a missing route with NPC prices',async()=>{
  let copied='';const snapshot=estimateMarketRates(Array.from({length:6},(_,i)=>ad('WTS armbrace 30e',i)),now);
  const source=createHubCalculator({copy:async value=>{copied=value;},marketEnabled:()=>true,quotes:async()=>{throw new Error('NPC must not be fetched');},market:async()=>snapshot});
  source.setVisible(true);source.search('1a in e');await Promise.resolve();
  const row=source.search('1a in e')[0]!;assert.equal(row.title,'~ 30 ecto');assert.match(row.detail,/Inferred median/);await row.run();assert.match(copied,/~ 30 ecto.*Seller asking prices/);
  source.search('1p in a');await Promise.resolve();assert.equal(source.search('1p in a')[0]?.title,'Not enough recent prices');source.setVisible(false);
});

test('late market responses cannot revive a hidden or disabled result',async()=>{
  let enabled=true;let resolve!:(value:MarketSnapshot)=>void;
  const source=createHubCalculator({copy:async()=>{},marketEnabled:()=>enabled,quotes:async()=>({updatedAt:now,quotes:[]}),market:()=>new Promise(done=>{resolve=done;})});
  source.setVisible(true);source.search('1p in a');source.search('2+3');enabled=false;resolve({fetchedAt:now,quotes:[]});await Promise.resolve();
  assert.equal(source.search('2+3')[0]?.title,'5');assert.deepEqual(source.search('1p in a'),[]);source.setVisible(false);
});

test('an open Hub expires evidence without waiting for another keystroke',async(context)=>{
  context.mock.timers.enable({apis:['Date','setTimeout'],now});
  const snapshot=estimateMarketRates(Array.from({length:6},(_,i)=>ad('WTS armbrace 30e',i)),now);
  const source=createHubCalculator({copy:async()=>{},marketEnabled:()=>true,quotes:async()=>({updatedAt:now,quotes:[]}),market:async()=>snapshot});
  let title='';source.subscribe(()=>{title=source.search('1a in e')[0]?.title??'';});
  source.setVisible(true);source.search('1a in e');await Promise.resolve();assert.equal(title,'~ 30 ecto');
  context.mock.timers.tick(5*60_000+1);assert.equal(title,'~ 30 ecto');
  context.mock.timers.tick(24*60*60_000);assert.equal(title,'Not enough recent prices');source.setVisible(false);
});

test('sample prices are labelled on the result and clipboard, never as recent Kamadan ads',async()=>{
  let copied='';const snapshot={...estimateMarketRates(Array.from({length:6},(_,i)=>ad('WTS armbrace 30e',i)),now),sample:true as const};
  const source=createHubCalculator({copy:async value=>{copied=value;},marketEnabled:()=>true,quotes:async()=>({updatedAt:now,quotes:[]}),market:async()=>snapshot});
  source.setVisible(true);source.search('1a in e');await Promise.resolve();
  const row=source.search('1a in e')[0]!;assert.equal(row.title,'~ 30 ecto (sample)');assert.match(row.detail,/Sample prices/);assert.doesNotMatch(row.detail,/recent Kamadan trade ads/);await row.run();assert.match(copied,/\(sample\)/);source.setVisible(false);
});
