import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC' });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
});

test('market basis retains the selected card and keyboard focus in both directions', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.goto('/?hub');
  await page.locator('.hub-search input').fill('1zkey in a');
  const picker=page.getByRole('combobox',{name:'Price basis'});
  await picker.focus();
  for(const side of ['wtb','wts']){
    await picker.selectOption(side);
    await expect(picker).toBeFocused();
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id','market:result');
    await expect(page.getByRole('button',{name:/Copy ~ /})).toBeEnabled();
    // Enter on the picker copies the card it just re-priced (HUB-022).
    await page.evaluate(() => { delete document.getElementById('app')!.dataset.action; });
    await picker.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-action', /^Copied 1 zkey = ~ /);
    await expect(picker).toBeFocused();
  }
  // Quote expiry withdraws the conversion while its basis control owns focus.
  await picker.focus();
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
  await page.clock.runFor(60_001);
  await expect(page.locator('.hub-conversion')).toHaveCount(0);
  await expect(page.locator('.hub-search input')).toBeFocused();
});

test('rates accept trading shorthand, command-Enter saves once, and the choice survives reload', async ({ page }) => {
  await page.goto('/?hub&settings-ms=1000');
  const search=page.locator('.hub-search input');
  await search.fill('rates'); await search.press('Enter');
  await page.getByRole('combobox',{name:'Rate source'}).selectOption('manual');
  for (const [label, value, message] of [
    ['Gold per ectoplasm', '0', 'Enter a rate greater than zero.'],
    ['Ectoplasm per armbrace', '5,00', 'Enter a positive number, such as 5,000 or 5k.'],
    ['Ectoplasm per Zaishen key', '1.0000001', 'Enter a positive number, such as 5,000 or 5k.'],
  ]) {
    const field = page.getByRole('textbox', { name: label });
    await field.fill(value);
    await field.press('Meta+Enter');
    await expect(page.locator('.hub-view [role=status]')).toHaveText(`${label}: ${message}`);
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(value);
    await field.fill('');
  }
  await page.getByRole('textbox',{name:'Gold per ectoplasm'}).fill('5k');
  await page.getByRole('textbox',{name:'Ectoplasm per armbrace'}).fill('30');
  const key=page.getByRole('textbox',{name:'Ectoplasm per Zaishen key'});await key.fill('.5');
  await page.evaluate(()=>{let count=0;const set=window.gwNative.settings.set;window.gwNative.settings.set=async patch=>{document.documentElement.dataset.rateSaves=String(++count);return set(patch);};});
  await key.press('Meta+Enter');await key.press('Meta+Enter');
  await expect(page.locator('.hub-view [role=status]')).toHaveText('Your rates saved. Go back to your conversion.');
  await expect(page.locator('html')).toHaveAttribute('data-rate-saves','1');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await search.fill('10e in p');await expect(page.locator('.hub-conversion')).toContainText('50 platinum');
  await page.reload();await search.fill('10e in p');await expect(page.locator('.hub-conversion')).toContainText('50 platinum');
  await search.fill('1 iron in g');await expect(page.locator('.hub-row')).toContainText('Use automatic observed prices for Iron Ingot');
  await search.press('Enter');await page.getByRole('combobox',{name:'Rate source'}).selectOption('trader');
  await page.getByRole('button',{name:/Use these rates/}).click();
  await expect(page.locator('.hub-view [role=status]')).toHaveText('Automatic observed prices selected. Go back to your conversion.');
});

test('a missing quote names its item and Enter retries the selected result', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('.hub-search input')).toBeVisible();
  await page.evaluate(()=>{let count=0;const get=window.gwNative.trade.getTraderQuotes;window.gwNative.trade.getTraderQuotes=async()=>{document.documentElement.dataset.quoteReads=String(++count);return get();};});
  const search=page.locator('.hub-search input');await search.fill('1 iron in g');
  const row=page.locator('.hub-row[aria-selected=true]');await expect(row).toContainText('Iron Ingot');
  await expect(row.locator('.hub-detail')).toHaveCSS('white-space','normal');
  await expect(page.getByRole('button',{name:/Retry/})).toBeEnabled();await search.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-quote-reads','2');
});

test('a loading refusal clears when evidence arrives and copy retains its question and time', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('.hub-search input')).toBeVisible();
  await page.evaluate(()=>{const get=window.gwNative.trade.getTraderQuotes;window.gwNative.trade.getTraderQuotes=async()=>{await new Promise(resolve=>setTimeout(resolve,200));return get();};});
  const search=page.locator('.hub-search input');await search.fill('10e in p');await search.press('Enter');
  await expect(page.locator('.hub-status')).toHaveText('Loading trader quotes…');
  await expect(page.locator('.hub-conversion')).toContainText('60 platinum');await expect(page.locator('.hub-status')).toBeEmpty();
  // All output families retain a literal question, answer and provenance contract.
  for (const [query, payload] of [
    ['10e in p', 'Copied 10 e = 60 platinum (sample) · Buy from trader · Current observation 9/30/2026, 12:00:00 PM · Kamadan · Estimate'],
    ['2+2', 'Copied 2+2 = 4 · Exact arithmetic'],
    ['250 cupcakes in sweet points', 'Copied 250 items Birthday Cupcake = 500 Sweet Tooth points · 250 items × 2 base points · Normal use restrictions apply; no bonus event assumed'],
    ['1a in e', 'Copied 1 a = ~ 30 ecto (sample) · Sample data — not live Kamadan prices · Median of simulated ads · Seller asking prices · 6 advertisers (Armbrace of Truth) · Ads since 9/30/2026, 11:55:00 AM'],
  ]) {
    await search.fill(query);
    await expect(page.locator('.hub-conversion')).toHaveCount(1);
    if (query === '2+2') await expect(page.locator('.hub-conversion .hub-title')).toHaveText('4');
    await expect(page.getByRole('button', { name: /^Copy/ })).toBeEnabled();
    await search.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-action', payload);
    if (query === '10e in p') await expect(page.locator('.hub-status')).toHaveText('Copied “60 platinum (sample)”');
  }
});

test('stale observed quotes expose Refresh and price details label their median evidence', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('.hub-search input')).toBeVisible();
  await page.evaluate(()=>{let count = 0; const get=window.gwNative.trade.getTraderQuotes;
    window.gwNative.trade.getTraderQuotes=async()=>{
      const result=await get(); document.documentElement.dataset.quoteReads=String(++count);
      return {...result,quotes:result.quotes.map(quote=>({...quote,price:count===1?6000:7000,timestamp:Date.now()-(count===1?3600000:0)}))};
    };});
  const search=page.locator('.hub-search input');await search.fill('10e in p');
  await expect(page.locator('.hub-conversion')).toContainText('Last observed');
  await expect(page.locator('html')).toHaveAttribute('data-quote-reads','1');
  await page.getByRole('button',{name:'Refresh quotes',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-quote-reads','2');
  await expect(page.locator('.hub-conversion')).toContainText('70 platinum');
  await expect(page.locator('.hub-conversion')).toContainText('Current observation');
  await expect(page.locator('.hub-conversion')).not.toContainText('Last observed');
  await search.fill('1a in e');await page.getByRole('button',{name:'Details',exact:true}).click();
  await expect(page.locator('.hub-view dl')).toContainText('Median rate');await expect(page.locator('.hub-view dl')).toContainText('1 Armbrace of Truth = 30 ecto');
  await expect(page.locator('.hub-view dl')).toContainText('Newest ad');
});

test('defaults label the named copy action and questions stay legible at narrow widths', async ({ page }) => {
  await page.setViewportSize({width:500,height:650});await page.goto('/?hub');
  const search=page.locator('.hub-search input');await search.fill('1k');
  await expect(page.locator('.hub-conversion')).toContainText('Default target');
  await expect(page.getByRole('button',{name:/Copy 1,000 gold/})).toBeEnabled();
  await search.fill('14a per stack in e each');
  await expect(page.locator('.hub-conversion')).toHaveAttribute('aria-label',/^14 a per stack each equals/);
  await expect(page.locator('.hub-conversion-input')).toHaveCSS('white-space','normal');
  const originalFont = await page.locator('.hub-conversion-input').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  await page.locator('.hub-conversion').evaluate(card => {
    for (const node of card.querySelectorAll<HTMLElement>('.hub-conversion-input, .hub-title, .hub-currency, .hub-detail')) node.style.fontSize = `${parseFloat(getComputedStyle(node).fontSize) * 2}px`;
  });
  const bounds = await page.locator('.hub-conversion').evaluate(card => {
    const question = card.querySelector('.hub-conversion-input')!;
    const range = document.createRange(); range.selectNodeContents(question);
    const box = card.getBoundingClientRect();
    return { overflow: card.scrollWidth - card.clientWidth, font: getComputedStyle(question).fontSize,
      inside: [...range.getClientRects()].every(rect => rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom) };
  });
  expect(parseFloat(bounds.font)).toBe(originalFont * 2);
  expect(bounds.overflow).toBeLessThanOrEqual(1);
  expect(bounds.inside).toBe(true);
});

test('a rate save refusal after Back reports its named failure without changing the new page', async ({ page }) => {
  await page.goto('/?hub');const search=page.locator('.hub-search input');
  await search.fill('rates');await search.press('Enter');
  await page.evaluate(()=>{window.gwNative.settings.set=async()=>{await new Promise(resolve=>setTimeout(resolve,400));throw new Error('Synthetic settings refusal');};});
  await page.getByRole('combobox',{name:'Rate source'}).selectOption('manual');
  await page.getByRole('textbox',{name:'Gold per ectoplasm'}).fill('5k');
  await page.getByRole('button',{name:/Use these rates/}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();await search.fill('2+2');
  await expect(page.locator('.hub-status')).toHaveText('Could not save conversion rates. Try again.');
  await expect(search).toHaveValue('2+2');await expect(page.locator('.hub-conversion')).toContainText('4');
  expect(await page.evaluate(()=>window.gwToolsSettings().calculatorRates?.mode)).toBe('automatic');
});

test('switching source with blank rates restores the named prompt, rather than a lost selection', async ({ page }) => {
  await page.goto('/?hub');const search=page.locator('.hub-search input');await search.fill('10e in p');
  await page.getByRole('button',{name:'Details',exact:true}).click();
  await page.getByRole('combobox',{name:'Rate source'}).selectOption('manual');
  await page.getByRole('button',{name:/Use these rates/}).click();
  await expect(page.locator('.hub-view [role=status]')).toContainText('Your rates saved');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Set a rate for Glob of Ectoplasm');
  await expect(page.getByRole('button',{name:/Set rates/})).toBeEnabled();
  await expect(page.locator('.hub-status')).not.toContainText('previous selection');
});

// A cached result must remain actionable through the shell's two restore paths.
test('resumed and rates-saved quotes retain selection, empty status and Enter copy (HUB-104, HUB-098)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await expect(search).toBeVisible();
  await page.evaluate(() => {
    let reads=0; const get=window.gwNative.trade.getTraderQuotes;
    window.gwNative.trade.getTraderQuotes=async()=>{document.documentElement.dataset.quoteReads=String(++reads);return get();};
  });
  await search.fill('10e in p');
  await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id','quote:result');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#hub')).toBeHidden();
  await page.getByRole('button',{name:'Open Hub',exact:true}).click();
  for (const sequence of ['resume', 'rates-save-back']) {
    if (sequence === 'rates-save-back') {
      await page.getByRole('button',{name:'Details',exact:true}).click();
      await page.getByRole('button',{name:/Use these rates/}).click();
      await expect(page.locator('.hub-view [role=status]')).toHaveText('Automatic observed prices selected. Go back to your conversion.');
      await page.getByRole('button',{name:'Back',exact:true}).click();
    }
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id','quote:result');
    await expect(page.locator('.hub-status')).toBeEmpty();
    await search.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-action','Copied 10 e = 60 platinum (sample) · Buy from trader · Current observation 9/30/2026, 12:00:00 PM · Kamadan · Estimate');
    await search.fill('10e in p');
  }
  // Dispatch the final digit and Enter in one browser turn, excluding driver latency.
  const copied = await search.evaluate(input => {
    const field=input as HTMLInputElement; let payload=''; let elapsed=Infinity;
    const start=performance.now();
    window.gwNative.clipboard.writeText=async value=>{payload=value;elapsed=performance.now()-start;};
    field.value='10005e in p';field.dispatchEvent(new Event('input',{bubbles:true}));
    field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    return {payload,elapsed};
  });
  expect(copied.payload).toBe('10005 e = 60,030 platinum (sample) · Buy from trader · Current observation 9/30/2026, 12:00:00 PM · Kamadan · Estimate');
  expect(copied.elapsed).toBeLessThanOrEqual(10);
  await expect(page.locator('html')).toHaveAttribute('data-quote-reads','1');
});
