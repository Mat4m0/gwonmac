import { expect, test } from '@playwright/test';

test('calculator retains labelled values when optional currency artwork fails', async ({ page }) => {
  await page.route('**/images/currency/*.png*', route => route.abort());
  await page.goto('/?hub');
  await page.getByRole('combobox', { name: 'Search people, places, builds' }).fill('1250 gold in p');
  const result = page.locator('#hub').getByRole('option');
  await expect(result).toContainText('1.25 platinum');
  await expect(result.locator('.hub-conversion-art')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Copy result/ })).toBeEnabled();
});

test('Hub searches, restores the query after actions, and hands off explicitly', async ({ page }) => {
  await page.goto('/?hub');
  const dialog = page.getByRole('dialog', { name: 'Hub', exact: true });
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await expect(search).toBeFocused();
  await search.fill('settings');
  await expect(page.locator('#hub').getByRole('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('settings');
  await search.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', 'Settings');
});

test('no results, editing shortcuts, dismissal and narrow layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('no such tool');
  await expect(page.getByText('No matches')).toBeVisible();
  await search.press('Meta+a');
  await search.fill('build');
  await expect(page.locator('#hub').getByRole('option')).toContainText('Build Library');
  const panel = await page.locator('.hub-panel').boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  await search.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
});

test('outpost travel closes Hub quietly after acceptance', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('embark');
  await expect(page.locator('#hub').getByRole('option')).toContainText('Embark Beach');
  await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).not.toBeVisible();
});

test('a friend opens explicit actions and an offline location cannot travel', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('romi');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.locator('#hub').getByRole('option')).toHaveCount(2);
  await expect(page.locator('#hub').getByRole('option', { name: /Travel to outpost/ })).toContainText('Any district');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('romi');
  await search.fill('offline');
  await search.press('Enter');
  await expect(page.locator('#hub').getByRole('option', { name: /Travel to outpost/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#hub').getByRole('option', { name: /Travel to outpost/ })).toContainText('offline');
});

test('one Hub whisper view keeps drafts through navigation, dismissal and failures', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('romi'); await search.press('Enter'); await search.press('Enter');
  const draft = page.getByRole('textbox', { name: 'Message Romi Ranger', exact: true });
  await expect(draft).toBeFocused();
  await draft.fill('Meet in Kamadan?'); await draft.press('Escape');
  const picker = page.getByRole('combobox', { name: 'Character name' });
  await expect(picker).toBeFocused();
  await picker.press('ArrowDown'); await picker.press('ArrowRight');
  await expect(draft).toHaveValue('Meet in Kamadan?');
  await page.getByRole('button', { name: 'Close Hub' }).click();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await search.fill('whispers'); await search.press('Enter');
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('Meet in Kamadan?');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-failure')));
  await draft.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Your draft is kept');
  await expect(draft).toHaveValue('Meet in Kamadan?');
  await page.locator('.whisper-options summary').click();
  await page.getByRole('button', { name: 'Close conversation with Romi Ranger' }).click();
  await expect(page.getByRole('alert').filter({hasText:'Discard'})).toBeVisible();
  await page.getByRole('button', { name: 'Keep chatting' }).click();
  await expect(draft).toHaveValue('Meet in Kamadan?');
});

test('sending uses observed messages, and session reset clears the shared view', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('whisper Romi Ranger'); await search.press('Enter');
  const draft = page.getByRole('textbox', { name: 'Message Romi Ranger', exact: true });
  await draft.fill('Hello'); await draft.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-sends', '1');
  await expect(draft).toHaveValue('');
  await expect(page.locator('.whisper-transcript:visible')).toContainText('Hello');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-reset')));
  await expect(draft).toHaveCount(0);
  await expect(page.locator('.whisper-message')).toHaveCount(0);
  await expect(search).toBeVisible();
});

test('a withdrawn friend cannot act through an already open action view', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('romi'); await search.press('Enter');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-withdraw')));
  await expect(page.locator('#hub').getByRole('option', { name: /Travel to outpost/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#hub').getByRole('option', { name: /Whisper/ })).toHaveAttribute('aria-disabled', 'true');
  await search.press('Enter');
  await expect(page.locator('#hub-draft')).toHaveCount(0);
});

test('exact team applies through the observed runner, prefixes only review', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('team gom af');
  await expect(page.getByRole('button', { name: 'Review ↵', exact: true })).toBeEnabled();
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'GOM AFK' })).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('team gom afk');
  await expect(page.getByRole('button', { name: 'Apply team GOM AFK ↵' })).toBeEnabled();
  await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).not.toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-action', /command:/);
});

test('exact build has a visible target and does not apply while typing', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('build smiter');
  await expect(page.getByRole('button', { name: 'Load Smiter on Your character ↵' })).toBeEnabled();
  await expect(page.locator('.hub-preview')).toContainText('Templates/Skills/Smiter.txt');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).not.toBeVisible();
});

test('team preflight is inline and an interruption is not reported as success', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-scenario', { detail: 'explorable' })));
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('team gom afk');
  await expect(page.getByRole('button', { name: 'Apply team GOM AFK ↵' })).toBeDisabled();
  await expect(page.locator('#hub').getByRole('option')).toContainText('outpost');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-scenario', { detail: 'partial' })));
  await expect(page.getByRole('button', { name: 'Apply team GOM AFK ↵' })).toBeEnabled();
  await search.press('Enter');
  await expect(page.getByRole('status')).toContainText('1 change was confirmed');
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).toBeVisible();
});

test('calculator shows both observed trader rates and fixed conversions', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('10 ecto in p');
  await expect(page.locator('#hub').getByRole('option', { name: /60 platinum.*Buy from trader/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Price basis' }).selectOption('sell');
  await expect(page.locator('#hub').getByRole('option', { name: /50 platinum.*Sell to trader/ })).toBeVisible();
  await search.fill('1250 gold in p');
  await expect(page.locator('#hub').getByRole('option')).toContainText('1.25 platinum');
  await search.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'Copied 1.25 platinum');
});

test('a saved search phrase and pin survive reload and resolve the original item', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('team gom afk');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.locator('#hub').getByRole('option', { name: /Pin to Hub/ }).click();
  await page.locator('#hub').getByRole('option', { name: /Set search phrase/ }).click();
  await page.getByRole('textbox', { name: 'Search phrase' }).fill('evening team');
  await page.getByRole('button', { name: 'Save phrase' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#hub').getByRole('option', { name: /GOM AFK/ })).toBeVisible();
  await search.fill('evening team');
  await expect(page.locator('#hub').getByRole('option')).toContainText('GOM AFK');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'GOM AFK' })).toBeVisible();
});

test('Builds and Trade open inside Hub with the same direct shortcuts', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await expect(search).toBeFocused();
  await search.press('Meta+b');
  await expect(page.locator('#hub .tools-window')).toBeVisible();
  await page.keyboard.press('Meta+k');
  await expect(page.locator('#hub .trade-window')).toBeVisible();
  await expect(page.locator('#hub #toolbox-builds')).toHaveCount(0);
});


test('duplicate exact names require a deliberate selection', async ({ page }) => {
  await page.goto('/?hub');
  await page.getByRole('button', { name: 'Close Hub' }).click();
  await page.getByRole('combobox', { name: 'Fixture scenario' }).selectOption('duplicate');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('build smiter');
  await expect(page.locator('#hub').getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Select a result' })).toBeDisabled();
  await search.press('Enter');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await search.press('ArrowDown'); await search.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Build target' })).toBeVisible();
});

test('disabled capabilities disappear including friend child actions', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await expect(search).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { buildLibrary: false, tradeChat: false, whispersEnabled: false } })));
  await search.fill('build smiter'); await expect(page.locator('#hub').getByRole('option')).toHaveCount(0);
  await search.fill('trade ecto'); await expect(page.locator('#hub').getByRole('option')).toHaveCount(0);
  await search.fill('romi'); await search.press('Enter');
  await expect(page.locator('#hub').getByRole('option', { name: /Whisper/ })).toHaveCount(0);
  await expect(page.locator('#hub').getByRole('option', { name: /Travel to outpost/ })).toBeVisible();
});

test('storage refusal stays silent', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('storage'); await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).not.toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('character search switches the explicitly selected observed character', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('char Toefte');
  await expect(page.locator('#hub').getByRole('option')).toContainText('Toefte');
  await expect(page.getByRole('button', { name: 'Switch to Toefte ↵' })).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
  await search.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'Character toefte');
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).not.toBeVisible();
});

test('trade query opens the same searchable tool and can detach', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('trade ecto'); await search.press('Enter');
  await expect(page.locator('#hub .trade-search input')).toHaveValue('ecto');
  await page.getByRole('button', { name: 'Detach', exact: true }).click();
  await expect(page.locator('#toolbox-foundation .trade-search input')).toHaveValue('ecto');
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).not.toBeVisible();
});

test('Maps controls save inline without navigating away', async ({ page }) => {
  await page.goto('/?hub');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { cartographyEnabled: true } })));
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('maps'); await search.press('Enter');
  await page.getByRole('button', { name: /Exploration grid/ }).click();
  await expect(page.getByRole('slider', { name: 'Grid opacity' })).toBeVisible();
  await page.getByRole('slider', { name: 'Grid opacity' }).fill('45');
  await expect(page.locator('.hub-view')).toContainText('45%');
});

test('compact armbrace conversions use explicit manual rates and original item art', async ({page})=>{
  await page.goto('/?hub');
  const search=page.getByRole('combobox',{name:'Search people, places, builds'});
  await search.fill('1p in a');
  await expect(page.locator('#hub .hub-row')).toContainText('~ 0.006667 armbrace');
  await page.getByRole('button',{name:'Actions',exact:true}).click();
  await page.getByRole('button',{name:'Edit rates',exact:true}).click();
  await page.getByRole('combobox',{name:'Rate source'}).selectOption('manual');
  await page.getByRole('textbox',{name:'Gold per ectoplasm'}).fill('5000');
  await page.getByRole('textbox',{name:'Ectoplasm per armbrace'}).fill('30');
  await page.getByRole('textbox',{name:'Ectoplasm per Zaishen key'}).fill('0.5');
  await page.getByRole('button',{name:'Use these rates'}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.locator('#hub .hub-row')).toContainText('0.006667 armbrace');
  await expect(page.locator('#hub .hub-row')).toContainText('Your rates');
  await expect(page.locator('.hub-conversion-art')).toHaveCount(2);
  await expect.poll(()=>page.locator('.hub-conversion-art').evaluateAll(images=>images.every(image=>image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>0))).toBe(true);
  await search.fill('100k + 10e in a');await expect(page.locator('#hub .hub-row')).toContainText('1 armbrace');
  await search.fill('1 stack zkeys in e');await expect(page.locator('#hub .hub-row')).toContainText('125 ecto');
  await search.fill('14a/stk in e each');await expect(page.locator('#hub .hub-row')).toContainText('1.68 ecto');
});

test('market conversions show inferred medians, sides, provenance and original currency art',async({page})=>{
  await page.goto('/?hub');
  const search=page.getByRole('combobox',{name:'Search people, places, builds'});
  await search.fill('1p in a');
  const card=page.locator('#hub .hub-row');
  await expect(card).toContainText('~ 0.006667 armbrace');
  await expect(card).toContainText('Sample prices');
  await expect(card).toContainText('(sample)');
  await expect(card).not.toContainText('recent Kamadan trade ads');
  await page.getByRole('button',{name:'Details',exact:true}).click();
  await expect(page.locator('.hub-view')).toContainText('6 advertisers');
  await expect(page.locator('.hub-view')).toContainText('Ads since');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('combobox',{name:'Price basis'}).selectOption('wtb');
  await expect(card).toContainText('~ 0.008929 armbrace');
  await expect(card).toContainText('Buyer offers');
  await search.fill('1 stack zkeys in e');
  await expect(card).toContainText('~ 350 ecto');
  await page.getByRole('combobox',{name:'Price basis'}).selectOption('wts');
  await expect(card).toContainText('~ 375 ecto');
  await expect.poll(()=>page.locator('.hub-conversion-art').evaluateAll(images=>images.length===2&&images.every(image=>image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>0))).toBe(true);
});

test('insufficient market evidence stays inline without a setup prompt',async({page})=>{
  await page.goto('/?hub&market-empty');
  await page.getByRole('combobox',{name:'Search people, places, builds'}).fill('1p in a');
  await expect(page.locator('#hub .hub-row')).toContainText('Not enough recent prices');
  await expect(page.locator('.hub-view')).toBeHidden();
  await expect(page.locator('#hub')).not.toContainText('Set Armbrace');
});

test('title progress leads into editable shopping quantities without changing game state',async({page})=>{
  await page.goto('/?hub');
  const search=page.getByRole('combobox',{name:'Search people, places, builds'});
  await search.fill('sweet tooth from 7350');
  await expect(page.locator('.hub-conversion')).toContainText('2,650 points remaining');
  await expect(page.locator('.hub-conversion')).toContainText('entered points');
  await search.press('Enter');
  await expect(search).toHaveValue('2650 sweet points');
  await expect(page.locator('#hub .hub-row').first()).toContainText('1,325 × Birthday Cupcake');
  await search.fill('2651 sweet points');
  await expect(page.locator('#hub .hub-row').first()).toContainText('1 excess point');
  await search.fill('250 sweet points for 3e');
  await expect(page.locator('.hub-conversion')).toContainText('0.012 ecto / point');
  await expect(page.locator('.hub-conversion')).toContainText('Not a market quote');
});

test('title examples are editable, exact, and reject the wrong point track',async({page})=>{
  await page.goto('/?hub');
  const search=page.getByRole('combobox',{name:'Search people, places, builds'});
  await search.fill('titles');await search.press('Enter');
  await expect(search).toHaveValue('sweet tooth from 7350');
  await search.fill('1 stack grog in drunk points');
  await expect(page.locator('.hub-conversion')).toContainText('750 Drunkard points');
  await search.fill('zaishen rank 3 from 500');
  await expect(page.locator('#hub')).toContainText('100 × Zaishen Key');
  await search.fill('250 cupcakes in party points');
  await expect(page.locator('#hub')).toContainText('Birthday Cupcake gives Sweet Tooth points');
  await expect(page.locator('.hub-view')).toBeHidden();
});

test('Travel uses Hub typography and supports empty-query arrows, favorites and settings by keyboard',async({page})=>{
  await page.goto('/?hub');
  const hubSearch=page.getByRole('combobox',{name:'Search people, places, builds'});
  const font=await hubSearch.evaluate(element=>getComputedStyle(element).fontFamily);
  await hubSearch.fill('travel');await hubSearch.press('Enter');
  const search=page.getByRole('combobox',{name:'Destination, phrase, or friend'});
  await expect(search).toBeFocused();
  expect(await search.evaluate(element=>getComputedStyle(element).fontFamily)).toBe(font);
  await expect(page.locator('#travel-recent-449')).toHaveAttribute('aria-selected','true');
  await search.press('ArrowDown');
  await expect(page.locator('.travel-history [aria-selected=true]')).toContainText('Kaineng Center');
  await search.press('ArrowUp');await search.press('ArrowUp');
  await expect(page.locator('.travel-favorites [aria-selected=true]')).toHaveAttribute('aria-label','Travel to Embark Beach, shortcut 6');
  await search.press('Tab');
  await expect(page.getByRole('button',{name:'Customize Travel'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region',{name:'Travel settings'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(search).toBeFocused();
  await search.fill('kama');await search.press('Escape');await expect(search).toHaveValue('');
  await search.press('Escape');await expect(hubSearch).toBeVisible();
});

test('Travel Enter from an empty search uses the selected recent destination',async({page})=>{
  await page.goto('/?hub');
  const hubSearch=page.getByRole('combobox',{name:'Search people, places, builds'});
  await hubSearch.fill('travel');await hubSearch.press('Enter');
  const search=page.getByRole('combobox',{name:'Destination, phrase, or friend'});
  await search.press('ArrowDown');await search.press('Enter');
  await expect(page.locator('#hub .hub-view')).toBeHidden();
});

test('Travel carousel arrows browse without executing and preserve query caret editing',async({page})=>{
  await page.goto('/?hub');
  const root=page.getByRole('combobox',{name:'Search people, places, builds'});
  await root.fill('travel');await root.press('Enter');
  const search=page.getByRole('combobox',{name:'Destination, phrase, or friend'});
  await expect(search).toBeFocused();
  await search.fill('kamadan');
  await search.evaluate(element=>{if(element instanceof HTMLInputElement)element.setSelectionRange(3,3);});
  await search.press('ArrowLeft');await expect(search).toHaveValue('kamadan');
  await expect(search).toBeVisible();
  await search.evaluate(element=>{if(element instanceof HTMLInputElement)element.setSelectionRange(0,0);});
  await search.press('ArrowLeft');await expect(search).toHaveValue('kamadan');
  await search.press('End');await search.press('ArrowRight');
  await expect(search).toHaveValue('kamadan');
  await expect(page.locator('#hub .hub-view')).toBeVisible();
  await search.press('Escape');await expect(search).toHaveValue('');
  await search.press('Escape');await expect(root).toBeVisible();
  await root.fill('travel');await root.press('Enter');
  await search.press('ArrowRight');
  await expect(page.locator('.travel-history [aria-selected=true]')).toContainText('Kaineng Center');
  await expect(page.locator('#hub .hub-view')).toBeVisible();
  await search.press('Enter');
  await expect(page.locator('#hub .hub-view')).toBeHidden();
});

test('profession build search previews eight skills and reviews without applying', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const builds = page.locator('.hub-build-row');
  await search.fill('build monk');
  await expect(builds).toHaveCount(3);
  await expect(page.locator('.hub-skill')).toHaveCount(24);
  await expect.poll(() => page.locator('.hub-skill img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await expect(page.getByRole('button', { name: 'Review ↵', exact: true })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Build target' })).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('build mo'); await expect(builds).toHaveCount(3);
  await search.fill('build monk smit'); await expect(builds).toHaveCount(1);
  await expect(builds).toContainText('Smiter');
  await search.fill('build monkk'); await expect(builds).toHaveCount(0);
  await search.fill('build mesmer'); await expect(builds).toHaveCount(1);
  await expect(builds).toContainText('Domination shutdown');
});


test('Hub keeps its geometry across results, conversations and compact carousels', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const panel = page.locator('.hub-panel');
  const size = await panel.boundingBox();
  for (const query of ['10 ecto in p', 'build monk', 'travel', 'switch character', 'whispers']) {
    await search.fill(query);
    if (['travel', 'switch character', 'whispers'].includes(query)) await search.press('Enter');
    await expect.poll(() => panel.boundingBox()).toEqual(size);
    if (query === 'switch character') {
      const selected = page.locator('.character-switch-row[data-selected=true]');
      await expect(selected).toContainText('Fixture Monk');
      expect((await selected.boundingBox())!.height).toBeLessThan(165);
      await page.keyboard.press('ArrowRight');
      await expect(selected).toContainText('Fixture Ranger');
      await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
      await page.getByRole('button', { name: 'Character Switch settings', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: /Show search bar/ })).toBeFocused();
      await page.keyboard.press('Escape');
    }
    if (query === 'whispers') {
      const picker = page.getByRole('combobox', { name: 'Character name' });
      await expect(picker).toBeFocused();
      await picker.press('ArrowDown'); await picker.press('ArrowRight');
      const draft = page.getByRole('textbox', { name: 'Message Romi Ranger', exact: true });
      await expect(draft).toBeFocused();
      await draft.fill('Draft stays here');
      await draft.press('Shift+Enter');
      await expect(page.locator('#app')).not.toHaveAttribute('data-sends');
      await expect.poll(() => panel.boundingBox()).toEqual(size);
      await draft.evaluate(input => { if (input instanceof HTMLInputElement) input.setSelectionRange(0, 0); });
      await draft.press('ArrowLeft'); await expect(draft).toBeFocused();
      await draft.press('Escape'); await expect(picker).toBeFocused();
    }
    if (['travel', 'switch character', 'whispers'].includes(query)) await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(search).toBeVisible();
  }
});


test('account search offers explicit keep-open and replacement choices', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('acc second');
  const rows = page.locator('#hub').getByRole('option');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Close Main and open Second');
  await expect(rows.nth(1)).toContainText('Open Second');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Account/);
  await search.press('ArrowDown'); await search.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'Account Second open');
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await search.fill('acc second'); await search.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'Account Second replace');
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await search.fill('accounts'); await search.press('Enter');
  await expect(page.locator('#hub').getByRole('option', { name: /Main/ })).toHaveAttribute('aria-disabled', 'true');
});

test('character cards start at the left edge without leading empty slots', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('switch character'); await search.press('Enter');
  await expect(page.locator('.character-switch-list > li').first().locator('button')).toContainText('Fixture Monk');
  const icon = page.locator('.character-switch-row img').first();
  expect(await icon.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  expect((await icon.boundingBox())!.width).toBeGreaterThanOrEqual(40);
  await expect(page.locator('.character-switch-meta').first()).toHaveText('Lv 20 · Kamadan');
});


test('in-game settings stay in Hub and Show Launcher remains explicit', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('checkbox', { name: 'Whispers', exact: true }).uncheck();
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Whispers', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('whispers'); await expect(page.getByText('No matches', { exact: true })).toBeVisible();
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('checkbox', { name: 'Whispers', exact: true }).check();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('combobox', { name: 'Panel style' }).selectOption('obsidian');
  await expect(page.getByRole('combobox', { name: 'Panel style' })).toHaveValue('obsidian');
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.getByRole('combobox', { name: 'Panel style' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('show launcher'); await search.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'Launcher');
});

test('chat pops out and returns to Hub without losing its draft', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('whisper Foo'); await search.press('Enter');
  const draft = page.getByRole('textbox', { name: 'Message foo', exact: true });
  await expect(draft).toBeFocused(); await draft.fill('Keep my draft');
  await draft.press('Home'); await draft.press('ArrowLeft');
  await expect(draft).toBeVisible(); await expect(draft).toHaveValue('Keep my draft');
  await page.getByRole('button', { name: 'Pop out chat', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).not.toBeVisible();
  await expect(draft).toBeVisible(); await expect(draft).toHaveValue('Keep my draft');
  await expect(page.locator('.whisper-popout-host')).toHaveCount(1);
  await page.getByLabel('Chat options', { exact: true }).click();
  await page.getByRole('slider', { name: /Background/ }).fill('60');
  await page.getByRole('button', { name: 'Open in Hub', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Hub', exact: true })).toBeVisible();
  await expect(draft).toHaveValue('Keep my draft');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', 'Whisper');
});

test('pop-out mode owns floating icon toggles until docked', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('whisper Romi'); await search.press('Enter');
  await page.getByRole('button', { name: 'Pop out chat', exact: true }).click();
  const icon = page.getByRole('button', { name: /^Whispers, \d+ unread/ });
  const panel = page.locator('#whisper-window');
  await expect(panel).toBeVisible();
  await icon.click(); await expect(panel).not.toBeVisible();
  await icon.click(); await expect(panel).toBeVisible();
  await expect(page.locator('#hub')).not.toBeVisible();
  await page.getByRole('button', { name: 'Open in Hub', exact: true }).click();
  await expect(page.locator('#hub')).toBeVisible();
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await icon.click(); await expect(page.locator('#hub')).toBeVisible();
});

test('switch search prioritizes characters and Back restores the selected account', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('switch');
  await expect(page.locator('.hub-row').first()).toContainText('Switch Character');
  await search.fill('switch account'); await search.press('Enter');
  await search.fill('Second'); await search.press('Enter');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.hub-caption')).toHaveText('Accounts');
  await expect(search).toHaveValue('Second');
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Second');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('switch account');
});

test('price updates preserve focus and disabled Maps closes only its own view', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('1zkey in a');
  const basis = page.getByRole('combobox', { name: 'Price basis' }); await basis.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-incoming')));
  await expect(basis).toBeFocused();
  await search.fill('maps'); await search.press('Enter');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { tradeChat: false } })));
  await expect(page.locator('.hub-caption')).toHaveText('Maps');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { cartographyEnabled: false } })));
  await expect(page.locator('.hub-map-settings')).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('disabled tool shortcuts are visible but cannot be edited; command examples respect availability', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('checkbox', { name: 'Whispers', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Whispers', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear Whispers', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reset Whispers', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('commands'); await search.press('Enter');
  await expect(page.locator('.hub-results')).toContainText('build monk');
  await expect(page.locator('.hub-results')).not.toContainText('whisper Romi');
  await search.fill('1p in g'); await search.press('Enter');
  await expect(search).toHaveValue('1p in g');
});

test('Trade opens an addressed composer and Back restores the offer and filter', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('trade arms'); await search.press('Enter');
  const contact = page.getByRole('button', { name: /^Whisper Tyria/ });
  await expect(contact).toBeVisible(); await contact.click();
  await expect(page.getByRole('textbox', { name: 'Message Tyria Cartographer', exact: true })).toBeFocused();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', 'Whisper');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.hub-caption')).toHaveText('Trade');
  await expect(page.locator('.trade-search input[type=search]')).toHaveValue('arms');
  await expect(contact).toBeVisible();
});

test('character hint follows custom and cleared bindings', async ({ page }) => {
  await page.goto('/?hub');
  await page.getByRole('button', { name: 'Open Hub', exact: true }).waitFor();
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { shortcutOverrides: { 'character.switch': { key: 'j', shift: false, option: false } } } })));
  await search.fill('switch character'); await expect(page.locator('.hub-row')).toContainText('⌘J');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { shortcutOverrides: { 'character.switch': null } } })));
  await expect(page.locator('.hub-row')).not.toContainText('⌘');
});

test('shortcut recorder presents each modifier and captures without opening another tool', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
  const record = page.getByRole('button', { name: 'Switch Character', exact: true });
  await record.click(); await page.keyboard.press('Control+Alt+Shift+F12');
  await expect(record.locator('kbd')).toHaveText(['⌃', '⌥', '⇧', 'F12']);
  await record.click(); await page.keyboard.press('Escape');
  await expect(record.locator('kbd')).toHaveText(['⌃', '⌥', '⇧', 'F12']);
  await expect(page.locator('.hub-caption')).toHaveText('Settings');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('switch character');
  await expect(page.locator('.hub-row')).toContainText('⌃⌥⇧F12');
});


test('Hub text arrows cannot execute an action or clear a query', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('kamadan');
  await search.press('ArrowRight');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Travel/);
  await search.press('Home'); await search.press('ArrowLeft');
  await expect(search).toHaveValue('kamadan');
});
