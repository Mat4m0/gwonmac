import { expect, test } from '@playwright/test';

test('market basis retains the selected card and keyboard focus in both directions', async ({ page }) => {
  await page.goto('/?hub');
  await page.locator('.hub-search input').fill('1zkey in a');
  const picker=page.getByRole('combobox',{name:'Price basis'});
  await picker.focus();
  for(const side of ['wtb','wts']){
    await picker.selectOption(side);
    await expect(picker).toBeFocused();
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id','market:result');
    await expect(page.getByRole('button',{name:/Copy result/})).toBeEnabled();
  }
});

test('rates accept trading shorthand, command-Enter saves once, and the choice survives reload', async ({ page }) => {
  await page.goto('/?hub&settings-ms=100');
  const search=page.locator('.hub-search input');
  await search.fill('rates'); await search.press('Enter');
  await page.getByRole('combobox',{name:'Rate source'}).selectOption('manual');
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
  await expect(page.locator('.hub-conversion')).toContainText('60 platinum');await expect(page.locator('.hub-status')).toBeHidden();
  await search.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-action',/Copied 10 e = 60 platinum.*Buy from trader.*Current observation/);
  await expect(page.locator('.hub-status')).toHaveText('Copied “60 platinum (sample)”');
});

test('stale observed quotes expose Refresh and price details label their median evidence', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('.hub-search input')).toBeVisible();
  await page.evaluate(()=>{const get=window.gwNative.trade.getTraderQuotes;window.gwNative.trade.getTraderQuotes=async()=>{const result=await get();return {...result,quotes:result.quotes.map(quote=>({...quote,timestamp:Date.now()-3600000}))};};});
  const search=page.locator('.hub-search input');await search.fill('10e in p');
  await expect(page.locator('.hub-conversion')).toContainText('Last observed');
  await expect(page.getByRole('button',{name:'Refresh quotes',exact:true})).toBeVisible();
  await search.fill('1a in e');await page.getByRole('button',{name:'Details',exact:true}).click();
  await expect(page.locator('.hub-view dl')).toContainText('Median rate');await expect(page.locator('.hub-view dl')).toContainText('1 Armbrace of Truth = 30 ecto');
  await expect(page.locator('.hub-view dl')).toContainText('Newest ad');
});

test('defaults label the named copy action and questions stay legible at narrow widths', async ({ page }) => {
  await page.setViewportSize({width:500,height:650});await page.goto('/?hub');
  const search=page.locator('.hub-search input');await search.fill('1k');
  await expect(page.locator('.hub-conversion')).toContainText('Default target');
  await expect(page.getByRole('button',{name:/Copy 1000 gold/})).toBeEnabled();
  await search.fill('14a per stack in e each');
  await expect(page.locator('.hub-conversion')).toHaveAttribute('aria-label',/^14 a per stack each equals/);
  await expect(page.locator('.hub-conversion-input')).toHaveCSS('white-space','normal');
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
