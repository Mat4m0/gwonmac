/** Title values, whole-item rounding and refusal boundaries use offline fixtures. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateTitle } from '../../src/shared/title-calculator.js';
import { createHubCalculator } from '../../src/renderer/hub-calculator.js';

test('known items convert only into their own title using base points',()=>{
  for(const [query,answer] of [['250 cupcakes in sweet points','500 Sweet Tooth points'],['1 stack grog in drunk points','750 Drunkard points'],['250 hunters ale to drunkard points','250 Drunkard points'],['2 stacks zkeys in zaishen points','2,500 Zaishen points'],['1 frosty tonic in party points','2 Party Animal points']])assert.equal(calculateTitle(query!)?.[0]?.title,answer);
  assert.match(calculateTitle('250 cupcakes in party points')![0]!.title,/gives Sweet Tooth/);
  for(const query of ['250 everlasting tonics in party points','250 sweets in sweet points','250 cupckes in sweet points','1.5 cupcakes in sweet points','-1 grog in drunk points','1,5 grog in drunk points'])assert.equal(calculateTitle(query),null,query);
});
test('progress is explicit, bounded, and distinguishes next rank from maximum',()=>{
  assert.equal(calculateTitle('sweet tooth from 7,350')?.[0]?.title,'2,650 points remaining');
  assert.equal(calculateTitle('sweet tooth next from 500')?.[0]?.title,'500 points remaining');
  assert.equal(calculateTitle('sweet tooth from 500')?.[0]?.title,'9,500 points remaining');
  assert.equal(calculateTitle('sweet tooth from 12000')?.[0]?.title,'0 points remaining');
  assert.equal(calculateTitle('sweet tooth from 10000')?.[0]?.next,undefined);
  assert.match(calculateTitle('sweet tooth from 1.5')![0]!.title,/whole number/);
  assert.match(calculateTitle('sweet tooth from 1000001')![0]!.title,/1,000,000/);
  assert.ok(calculateTitle('sweet tooth')?.[0]?.example);
});
test('shopping rounds up and reports stacks, leftovers and excess points',()=>{
  const rows=calculateTitle('2651 sweet points')!;
  assert.equal(rows[0]?.title,'1,326 × Birthday Cupcake');
  assert.match(rows[0]!.detail,/5 full stacks \+ 76 items · 1 excess point/);
  assert.equal(rows[1]?.title,'884 × Crème Brûlée');
  assert.match(rows[1]!.detail,/1 excess point/);
});
test('Zaishen targets use the sourced thresholds and entered points',()=>{
  assert.match(calculateTitle('zaishen rank 3')![0]!.detail,/From 0 entered points/);
  assert.equal(calculateTitle('zaishen rank 3 from 500')?.[1]?.title,'100 × Zaishen Key');
  assert.equal(calculateTitle('zaishen rank 7 from 0')?.[1]?.title,'1,550 × Zaishen Key');
  assert.equal(calculateTitle('zaishen rank 12 from 0')?.[1]?.title,'20,000 × Zaishen Key');
  assert.match(calculateTitle('zaishen rank 13')![0]!.title,/1 to 12/);
  assert.match(calculateTitle('zaishen rank 3 from 501')![0]!.title,/multiples of 5/);
});
test('explicit offers compare price per point without implying a market quote',()=>{
  assert.equal(calculateTitle('250 sweet points for 3e')?.[0]?.title,'0.012 ecto / point');
  assert.match(calculateTitle('250 sweet points for 3e')![0]!.detail,/120 ecto for 10,000 points/);
  assert.match(calculateTitle('250 party points for 3p')![0]!.detail,/Not a market quote/);
  assert.match(calculateTitle('0 party points for 3p')![0]!.title,/more than zero/);
  assert.match(calculateTitle('250 party points for 0p')![0]!.title,/greater than zero/);
});
test('title calculations stay offline and never change progress',async()=>{
  let copied='';const source=createHubCalculator({copy:async value=>{copied=value;},marketEnabled:()=>false,quotes:async()=>{throw new Error('Network forbidden');}});
  source.setVisible(true);const row=source.search('250 cupcakes in sweet points')[0]!;
  assert.equal(row.group,'Titles');await row.run();assert.match(copied,/500 Sweet Tooth points/);
  assert.equal(source.search('10 ecto in p').length,0);source.setVisible(false);
});
