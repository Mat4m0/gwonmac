import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Trade as a popout over the game (the Hub fixture): the ledger is one keyboard
 * listbox where ↵ whispers the seller and ⌘↵ opens their listings (D-10), the
 * selection keeps its seller through re-posts and new searches, and no view change
 * drops the keyboard to the page.
 */
const hubSearch = (page: Page) => page.getByRole('combobox', { name: 'Search people, places, builds' });
const tradeWindow = (page: Page) => page.getByRole('dialog', { name: 'Trade Chat' });
const tradeSearch = (trade: Locator) => trade.getByRole('searchbox', { name: 'Search offers or character names' });
const offer = (trade: Locator, sender: string) => trade.getByRole('option', { name: new RegExp(`^${sender}: `, 'u') });

/** Trade opened with ⌘K from the game, its search holding the keyboard. */
async function openTrade(page: Page) {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  const trade = tradeWindow(page);
  await expect(tradeSearch(trade)).toBeFocused();
  // Geometry is compared only once the interface fonts have settled.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return trade;
}

/** Trade opened from the Hub with `trade <query>`, as a player types it. */
async function searchFromHub(page: Page, query: string) {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await hubSearch(page).fill(`trade ${query}`);
  await hubSearch(page).press('Enter');
  const trade = tradeWindow(page);
  await expect(trade.getByText(`Results for “${query}”`, { exact: true })).toBeVisible();
  return trade;
}

/** Every seller Trade asked Whispers to address, in order. */
async function recordWhispers(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.whispers = '';
    window.addEventListener('gw:whisper-person', event => {
      if (event instanceof CustomEvent) document.documentElement.dataset.whispers += `${event.detail}|`;
    });
  });
  return async () => (await page.evaluate(() => document.documentElement.dataset.whispers ?? '')).split('|').filter(Boolean);
}

test('↵ on a ledger row whispers its seller once, even while held (HUB-024, D-10)', async ({ page }) => {
  const trade = await openTrade(page);
  const whispers = await recordWhispers(page);
  await page.keyboard.type('ember');
  await page.keyboard.press('ArrowDown');
  await expect(offer(trade, 'Quiet Ember')).toBeFocused();
  for (let press = 0; press < 6; press++) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  const message = page.getByRole('textbox', { name: 'Message Quiet Ember', exact: true });
  await expect(message).toBeFocused();
  await expect(message).toHaveValue('');
  expect(await whispers()).toEqual(['Quiet Ember']);
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', 'Whisper');
  await expect(trade).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(offer(trade, 'Quiet Ember')).toBeFocused();
  await trade.getByRole('button', { name: 'Whisper Quiet Ember', exact: true }).dblclick();
  await expect(message).toBeFocused();
  expect(await whispers()).toEqual(['Quiet Ember', 'Quiet Ember']);
});

test('⌘↵ opens a seller\'s listings; ⌘⌫ and the mouse back button return to the same row (HUB-024, HUB-025)', async ({ page }) => {
  const trade = await searchFromHub(page, 'wts');
  const whispers = await recordWhispers(page);
  const search = tradeSearch(trade);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  const ember = offer(trade, 'Quiet Ember');
  await expect(ember).toBeFocused();
  await page.keyboard.press('Meta+Enter');
  await expect(trade.getByRole('button', { name: /Back to results/u })).toBeVisible();
  await expect(trade.getByRole('option')).toHaveCount(1);
  await expect(trade.getByRole('option')).toBeFocused();
  // ⌘⌫ in the search goes back one level and leaves the text alone.
  await search.click();
  await page.keyboard.press('Meta+Backspace');
  await expect(trade.getByText('Results for “wts”', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('wts');
  await expect(ember).toBeFocused();
  await expect(ember).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Meta+Enter');
  await expect(trade.getByRole('button', { name: /Back to results/u })).toBeVisible();
  await trade.dispatchEvent('mouseup', { button: 3 });
  await expect(ember).toBeFocused();
  // At the listings neither goes anywhere.
  await trade.dispatchEvent('mouseup', { button: 3 });
  await page.keyboard.press('Meta+Backspace');
  await expect(trade).toBeVisible();
  await expect(ember).toBeFocused();
  expect(await whispers()).toEqual([]);
});

test('the inspector names what ↵ and ⌘↵ do for the focused offer (HUB-024)', async ({ page }) => {
  const trade = await openTrade(page);
  const whisper = trade.locator('.inspector-whisper');
  // In the search, ↵ searches: its key sits on that action, not on Whisper.
  await page.keyboard.type('a');
  await expect(trade.getByRole('button', { name: 'Search Kamadan history', exact: true }).locator('kbd')).toBeVisible();
  await expect(whisper.locator('kbd')).toBeHidden();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowDown');
  await expect(whisper).toHaveText('Whisper Tyria Cartographer↵');
  await expect(whisper.locator('kbd')).toBeVisible();
  await expect(trade.locator('.inspector-listings kbd')).toHaveText('⌘↵');
  const height = await trade.locator('.inspector-actions').evaluate(element => element.getBoundingClientRect().height);
  await page.keyboard.press('ArrowDown');
  await expect(whisper).toHaveText('Whisper Rin of the Isles↵');
  expect(await trade.locator('.inspector-actions').evaluate(element => element.getBoundingClientRect().height)).toBe(height);
});

test('Whisper says why it cannot open and leaves nothing waiting for ⌘D (HUB-129)', async ({ page }) => {
  const trade = await openTrade(page);
  const whispers = await recordWhispers(page);
  const notice = trade.locator('.trade-notice');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { whispersEnabled: false } })));
  await page.keyboard.press('ArrowDown');
  await expect(trade.locator('.inspector-whisper')).toBeDisabled();
  await expect(trade.getByText('Whispers is off', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(notice).toHaveText('Turn on Whispers in Settings to write to Tyria Cartographer.');
  expect(await whispers()).toEqual([]);
  // On, while Guild Wars chat is not ready: refused, said, and not queued.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { whispersEnabled: true } }));
    window.dispatchEvent(new Event('hub-fixture-unavailable'));
  });
  await expect(trade.locator('.inspector-whisper')).toBeEnabled();
  await offer(trade, 'Tyria Cartographer').first().focus();
  await page.keyboard.press('Enter');
  await expect(notice).toHaveText('Whispers is unavailable. Wait for Guild Wars chat, then try again.');
  await expect(notice).toHaveAttribute('data-tone', 'warning');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-available')));
  await page.keyboard.press('Meta+d');
  await expect(page.locator('#whisper-window')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Tyria Cartographer', exact: true })).toHaveCount(0);
});

test('closing a whisper started from Trade returns the keyboard to its row (HUB-132)', async ({ page }) => {
  const trade = await openTrade(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Message Tyria Cartographer', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#whisper-window')).toBeHidden();
  await expect(offer(trade, 'Tyria Cartographer').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(offer(trade, 'Rin of the Isles')).toBeFocused();
  const whisper = trade.getByRole('button', { name: 'Whisper Rin of the Isles', exact: true });
  await whisper.click();
  await expect(page.getByRole('textbox', { name: 'Message Rin of the Isles', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(whisper).toBeFocused();
});

test('a re-post by the selected seller keeps them selected in search results (HUB-013)', async ({ page }) => {
  const trade = await searchFromHub(page, 'wts');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await expect(offer(trade, 'Quiet Ember')).toBeFocused();
  await page.evaluate(() => window.gwTradeFixture?.repost('Quiet Ember', 'WTS unded Polar Bear 90a'));
  const reposted = trade.getByRole('option', { name: 'Quiet Ember: WTS unded Polar Bear 90a', exact: true });
  await expect(reposted).toBeFocused();
  await expect(reposted).toHaveAttribute('aria-selected', 'true');
  await expect(trade.getByRole('option')).toHaveCount(4);
  await expect(trade.getByRole('region', { name: 'Offer from Quiet Ember' })).toContainText('Polar Bear 90a');
  const whispers = await recordWhispers(page);
  await page.keyboard.press('Enter');
  await expect.poll(whispers).toEqual(['Quiet Ember']);
});

test('a re-post while the live feed is scrolled keeps the selected seller and the reading position (HUB-013)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 464 });
  const trade = await openTrade(page);
  const list = trade.getByRole('listbox', { name: 'Trade offers' });
  await offer(trade, 'Acolyte Mira').click();
  await list.evaluate(element => { element.scrollTop = 60; });
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(40);
  await page.evaluate(() => window.gwTradeFixture?.repost('Acolyte Mira', 'WTS bunnies 3e'));
  const inspector = trade.getByRole('region', { name: 'Offer from Acolyte Mira' });
  await expect(inspector).toContainText('chocolate bunnies');
  await expect(trade.getByRole('button', { name: 'Whisper Acolyte Mira', exact: true })).toBeAttached();
  await expect(trade.locator('.trade-result-status')).toContainText('7 offers');
  await expect(offer(trade, 'Acolyte Mira')).toBeFocused();
  expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(40);
  // Back at the top the queued re-post merges and the selection follows it.
  await list.evaluate(element => { element.scrollTop = 0; });
  await expect(inspector).toContainText('WTS bunnies 3e');
  await expect(trade.getByRole('option', { name: 'Acolyte Mira: WTS bunnies 3e', exact: true })).toBeFocused();
});

test('a new Trade search drops a saved offer the inspector showed (HUB-118)', async ({ page }) => {
  const trade = await openTrade(page);
  const rin = offer(trade, 'Rin of the Isles');
  await rin.hover();
  await rin.getByRole('button', { name: 'Save offer from Rin of the Isles' }).click();
  await trade.getByRole('button', { name: /Saved 1/u }).click();
  await trade.getByRole('complementary', { name: 'Saved trade items' }).getByRole('button', { name: /^Rin of the Isles/u }).click();
  await expect(trade.getByRole('region', { name: 'Offer from Rin of the Isles' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await hubSearch(page).fill('trade consets');
  await hubSearch(page).press('Enter');
  await expect(trade.getByText('Results for “consets”', { exact: true })).toBeVisible();
  await expect(trade.getByRole('region', { name: 'Offer from Silver Wayfarer' })).toBeVisible();
});

test('typing narrows the loaded offers and keeps the selected one; ↵ searches the feed (D-10, HUB-013)', async ({ page }) => {
  const trade = await openTrade(page);
  const search = tradeSearch(trade);
  const whispers = await recordWhispers(page);
  await offer(trade, 'Acolyte Mira').click();
  await search.click();
  await page.keyboard.type('wts');
  await expect(trade.getByRole('option')).toHaveCount(4);
  await expect(trade.locator('.trade-result-status')).toContainText('4 offers');
  await expect(trade.getByRole('region', { name: 'Offer from Acolyte Mira' })).toBeVisible();
  await page.keyboard.type('x');
  await expect(trade.getByText('No loaded offers match “wtsx”', { exact: true })).toBeVisible();
  await expect(trade.getByRole('region', { name: 'Offer detail' })).toContainText('Choose an offer');
  await page.keyboard.press('Backspace');
  await expect(trade.getByRole('region', { name: 'Offer from Acolyte Mira' })).toBeVisible();
  for (const chord of ['Shift+Enter', 'Meta+Enter', 'Control+Enter', 'Alt+Enter']) {
    await search.press(chord);
    await expect(trade.getByText('Results for “wts”', { exact: true })).toHaveCount(0);
    await expect(search).toHaveValue('wts');
  }
  await page.keyboard.press('Enter');
  await expect(trade.getByText('Results for “wts”', { exact: true })).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('wts');
  expect(await whispers()).toEqual([]);
});

test('matches the intent filter hides are counted and one key shows them (HUB-125)', async ({ page }) => {
  const trade = await openTrade(page);
  await trade.getByRole('button', { name: 'Buying', exact: true }).click();
  await tradeSearch(trade).click();
  await page.keyboard.type('polar');
  await page.keyboard.press('Enter');
  await expect(trade.getByText('1 offer hidden by Buying', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(trade.getByRole('button', { name: 'Show all', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(offer(trade, 'Quiet Ember')).toBeVisible();
});

test('Trade keeps the keyboard inside as its views change (HUB-025)', async ({ page }) => {
  const trade = await openTrade(page);
  const pricesButton = trade.getByRole('button', { name: 'Trader prices', exact: true });
  await pricesButton.focus();
  await page.keyboard.press('Enter');
  await expect(trade.getByRole('searchbox', { name: 'Search trader items' })).toBeFocused();
  await page.keyboard.press('Meta+Backspace');
  await expect(pricesButton).toBeFocused();
  const tyria = offer(trade, 'Tyria Cartographer').first();
  await tyria.hover();
  await tyria.getByRole('button', { name: 'Save offer from Tyria Cartographer' }).click();
  await tyria.getByRole('button', { name: 'Follow Tyria Cartographer' }).click();
  const drawer = trade.getByRole('complementary', { name: 'Saved trade items' });
  await trade.getByRole('button', { name: /Saved 2/u }).focus();
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: /^Tyria Cartographer/u }).focus();
  await page.keyboard.press('Enter');
  await expect(tyria).toBeFocused();
  await trade.getByRole('button', { name: /Saved 2/u }).focus();
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: /^Players 1/u }).click();
  await drawer.getByRole('button', { name: /^Tyria Cartographer/u }).focus();
  await page.keyboard.press('Enter');
  await expect(trade.getByRole('button', { name: /Back to offers/u })).toBeVisible();
  await expect(trade.getByRole('option').first()).toBeFocused();
});

test('narrow Trade walks the ledger without its sheet, and the sheet has focus targets (HUB-025)', async ({ page }) => {
  await page.setViewportSize({ width: 672, height: 552 });
  const trade = await openTrade(page);
  const inspector = trade.locator('.trade-inspector');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(offer(trade, 'Silver Wayfarer')).toBeFocused();
  await expect(inspector).toBeHidden();
  await offer(trade, 'Acolyte Mira').click();
  await expect(trade.getByRole('button', { name: 'Whisper Acolyte Mira', exact: true })).toBeFocused();
  await trade.getByRole('button', { name: 'Back to offers', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(inspector).toBeHidden();
  await expect(offer(trade, 'Acolyte Mira')).toBeFocused();
});

test('Trader prices: the item search reaches the catalogue, and ↵ opens the first match (HUB-230)', async ({ page }) => {
  const trade = await openTrade(page);
  await trade.getByRole('button', { name: 'Trader prices', exact: true }).click();
  const itemSearch = trade.getByRole('searchbox', { name: 'Search trader items' });
  await itemSearch.click();
  await page.keyboard.type('vigor');
  await page.keyboard.press('ArrowDown');
  await expect(trade.getByRole('option', { name: /Rune of Superior Vigor/u })).toBeFocused();
  await page.setViewportSize({ width: 672, height: 552 });
  await itemSearch.click();
  await page.keyboard.press('Enter');
  await expect(trade.getByRole('region', { name: 'Rune of Superior Vigor price history' })).toBeFocused();
});

test('Actions is a keyboard menu: ⌘J opens it on its first item and ⌘⌫ closes only the menu (HUB-131)', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const trade = await openTrade(page);
  const summary = trade.locator('.offer-actions > summary');
  const whispers = await recordWhispers(page);
  // Mouse and keyboard open the same menu on its first action.
  await summary.click();
  await expect(trade.getByRole('menuitem', { name: 'Whisper Tyria Cartographer' })).toBeFocused();
  await page.keyboard.press('Meta+Backspace');
  await expect(summary).toBeFocused();
  await offer(trade, 'Quiet Ember').click({ button: 'right' });
  await expect(trade.getByRole('menuitem', { name: 'Whisper Quiet Ember' })).toBeFocused();
  expect(await whispers()).toEqual([]);
  await page.keyboard.press('Meta+Backspace');
  await tradeSearch(trade).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Meta+Enter');
  await expect(trade.getByRole('button', { name: /Back to offers/u })).toBeVisible();
  await page.keyboard.press('Meta+j');
  await expect(trade.getByRole('menuitem', { name: 'Whisper Tyria Cartographer' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(trade.getByRole('menuitem', { name: 'Open Kamadan feed ↗' })).toBeFocused();
  await page.keyboard.press('Meta+Backspace');
  await expect(trade.getByRole('menu', { name: 'Offer actions' })).toBeHidden();
  await expect(summary).toBeFocused();
  await expect(trade.getByRole('button', { name: /Back to offers/u })).toBeVisible();
  await page.keyboard.press('Meta+Backspace');
  await expect(trade.getByText('Latest messages', { exact: true })).toBeVisible();
  // ↵ opens it from Actions; the list keys walk it; ↵ runs the item.
  await summary.focus();
  await page.keyboard.press('Enter');
  for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowDown');
  await expect(trade.getByRole('menuitem', { name: 'Copy name' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trade.locator('.offer-copy-name')).toHaveText('Character name copied');
  await expect(trade.locator('.offer-copy-name')).toBeFocused();
  await expect(trade.locator('.trade-notice')).toHaveCount(0);
  await page.keyboard.press('Meta+Backspace');
  await expect(summary).toBeFocused();
});

test('Actions opens over the ledger and copy feedback stays on the action: neither moves a control (HUB-122, HUB-123)', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const trade = await openTrade(page);
  await page.keyboard.press('ArrowDown');
  const summary = trade.locator('.offer-actions > summary');
  const whisper = trade.locator('.inspector-whisper');
  const list = trade.getByRole('listbox', { name: 'Trade offers' });
  const before = { summary: await summary.boundingBox(), whisper: await whisper.boundingBox(), list: await list.boundingBox() };
  await summary.click();
  const menu = trade.getByRole('menu', { name: 'Offer actions' });
  await expect(menu).toBeVisible();
  expect(await summary.boundingBox()).toEqual(before.summary);
  expect(await list.boundingBox()).toEqual(before.list);
  const frame = (await trade.boundingBox())!;
  for (const item of await menu.locator('[role^=menuitem]').all()) {
    const box = (await item.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(frame.y);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
  }
  await menu.getByRole('menuitem', { name: 'Copy name' }).click();
  await expect(trade.locator('.offer-copy-name')).toHaveText('Character name copied');
  await expect(menu).toBeVisible();
  await expect(trade.locator('.offer-copy-name')).toBeFocused();
  await expect(trade.locator('.trade-notice')).toHaveCount(0);
  expect(await whisper.boundingBox()).toEqual(before.whisper);
  expect(await list.boundingBox()).toEqual(before.list);
  // Saving shows in the row and the Saved count; nothing else speaks.
  await expect(trade.locator('.offer-copy-name')).toHaveText('Copy name', { timeout: 10_000 });
  await page.keyboard.press('Meta+Backspace');
  await summary.click();
  await menu.getByRole('menuitemcheckbox', { name: 'Save offer' }).click();
  await expect(trade.locator('.saved-count')).toHaveText('1');
  await page.waitForTimeout(300);
  await expect(trade.locator('.trade-notice')).toHaveCount(0);
});

test('beside the game Trade shows at least four offers, and a short window keeps its actions inside (HUB-126, HUB-127, HUB-227)', async ({ page }) => {
  await page.setViewportSize({ width: 672, height: 552 });
  const trade = await openTrade(page);
  expect((await trade.boundingBox())!.width).toBe(608);
  await expect(trade.locator('.trade-brand svg')).toBeVisible();
  const fullyVisible = await trade.getByRole('listbox', { name: 'Trade offers' }).evaluate(list => {
    const box = list.getBoundingClientRect();
    return [...list.querySelectorAll('[role=option]')].filter(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= box.top && rect.bottom <= box.bottom;
    }).length;
  });
  expect(fullyVisible).toBeGreaterThanOrEqual(4);
  await page.setViewportSize({ width: 1280, height: 464 });
  const frame = (await trade.boundingBox())!;
  expect(frame.height).toBe(400);
  for (const control of [trade.locator('.inspector-whisper'), trade.locator('.offer-actions > summary')]) {
    const box = (await control.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
  }
});

test('Tab into Trade from nowhere lands in its search (HUB-225)', async ({ page }) => {
  const trade = await openTrade(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(tradeSearch(trade)).toBeFocused();
  // The production bundle mounts late. Only the still-current shortcut may take focus.
  for (const destination of ['trade', 'game', 'hub'] as const) {
    await page.goto('/?hub&trade-load-ms=1000');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+k');
    if (destination === 'game') await page.keyboard.press('w');
    if (destination === 'hub') await page.keyboard.press('Meta+r');
    await expect(tradeWindow(page)).toBeVisible();
    const target = destination === 'trade' ? tradeSearch(tradeWindow(page))
      : destination === 'game' ? page.locator('#canvas') : hubSearch(page);
    await expect(target).toBeFocused();
  }
});

test('the popout the player used last is on top, Trade or Whispers (HUB-108)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+d');
  const whispers = page.locator('#whisper-window');
  await expect(whispers).toBeVisible();
  await page.keyboard.press('Meta+k');
  const trade = tradeWindow(page);
  await expect(trade).toBeVisible();
  const topAt = async () => page.evaluate(() => {
    const a = document.querySelector('#whisper-window')!.getBoundingClientRect();
    const b = document.querySelector('#toolbox-trade .trade-window')!.getBoundingClientRect();
    const x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    const y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
    const hit = document.elementFromPoint(x, y);
    return hit?.closest('#whisper-window') ? 'whispers' : hit?.closest('.trade-window') ? 'trade' : 'none';
  });
  expect(await topAt()).toBe('trade');
  // Trade covers Whispers here, so the player's press on Whispers is dispatched.
  await whispers.dispatchEvent('pointerdown');
  expect(await topAt()).toBe('whispers');
});
