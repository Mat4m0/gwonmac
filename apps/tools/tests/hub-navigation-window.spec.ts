import { expect, test } from '@playwright/test';

test('Hub has a locked frame, invisible corner hit area and bounded movable geometry', async ({ page }, info) => {
  await page.goto('/?hub');
  const panel = page.locator('.hub-panel');
  const head = page.locator('.hub-heading');
  const grip = page.getByRole('button', { name: 'Resize Hub', exact: true });
  const initial = (await panel.boundingBox())!;
  await expect(panel).toHaveAttribute('data-locked', 'true');
  await expect(grip).toBeHidden();
  const heading = (await head.boundingBox())!;
  await page.mouse.move(heading.x + heading.width / 2, heading.y + 12);
  await page.mouse.down(); await page.mouse.move(heading.x + heading.width / 2 + 60, heading.y + 45); await page.mouse.up();
  expect(await panel.boundingBox()).toEqual(initial);
  await page.getByRole('button', { name: 'Unlock Hub position', exact: true }).click();
  await expect(grip).toBeVisible();
  await page.mouse.move(heading.x + heading.width / 2, heading.y + 12);
  await page.mouse.down(); await page.mouse.move(heading.x + heading.width / 2 - 60, heading.y + 36); await page.mouse.up();
  expect((await panel.boundingBox())!.x).toBeCloseTo(initial.x - 60);
  const corner = (await grip.boundingBox())!;
  expect(corner.width).toBeGreaterThanOrEqual(32);
  await page.mouse.move(corner.x + 10, corner.y + 10);
  await page.mouse.down(); await page.mouse.move(corner.x - 40, corner.y - 40); await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeLessThan(initial.width);
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).click();
  const placement = await panel.boundingBox();
  await expect(grip).toBeHidden();
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('maps'); await search.press('Enter');
  expect(await panel.boundingBox()).toEqual(placement);
  await expect(page.getByRole('navigation', { name: 'Hub breadcrumb' })).toContainText('Home');
  await page.screenshot({ path: info.outputPath('hub-maps-breadcrumb.png') });
});

test('Command-Backspace and breadcrumb ancestors restore history; Backspace only edits text', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const back = page.locator('.hub-back');
  await expect(back).toBeHidden();
  await search.fill('accounts'); await search.press('Enter');
  await search.fill('second'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Accounts›Second');
  await expect(back).toHaveAttribute('title', 'Back (⌘⌫)');
  await expect(back).toHaveAttribute('aria-keyshortcuts', 'Meta+Backspace');
  await expect(back).toHaveAttribute('aria-description', 'Return to Accounts');
  await expect(page.locator('.hub-legend')).toContainText('⌘⌫ Back');
  await search.fill('keep'); await search.press('Backspace');
  await expect(search).toHaveValue('kee');
  await expect(page.locator('.hub-caption')).toHaveText('Second');
  // An empty query is a no-op for Backspace, held or not: it never leaves the page.
  await search.fill('');
  for (let press = 0; press < 4; press++) await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Second');
  // Command-Backspace goes back exactly one level, without clearing the child query first,
  // and a held one never goes further.
  await search.fill('child');
  await page.keyboard.down('Meta');
  for (let press = 0; press < 4; press++) await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace'); await page.keyboard.up('Meta');
  await expect(search).toHaveValue('second');
  await expect(page.locator('.hub-caption')).toHaveText('Accounts');
  // Focus stays in search, so its description names the page a screen reader has returned to.
  await expect(search).toHaveAttribute('aria-description', 'Accounts: search actions');
  await page.keyboard.press('Meta+Backspace');
  await expect(search).toHaveAttribute('aria-description', 'Home: search tools or use a command example');
  await search.press('Enter');
  await page.getByRole('navigation', { name: 'Hub breadcrumb' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(search).toHaveValue('accounts');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('.hub-back')).toBeHidden();
});

test('arrows connect Hub results, character carousel, search and Back', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('switch character'); await search.press('ArrowDown');
  // D-2: arrows move the selection while focus stays in search; no wrap at the top.
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Switch Character');
  await page.keyboard.press('ArrowUp'); await expect(search).toBeFocused();
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Switch Character');
  await search.press('Enter');
  const selected = page.locator('.character-switch-row[data-selected=true]');
  await expect(selected).toBeFocused();
  await page.screenshot({ path: info.outputPath('hub-characters.png') });
  await page.keyboard.press('ArrowRight'); await expect(selected).toContainText('Fixture Ranger');
  await page.keyboard.press('ArrowLeft'); await expect(selected).toContainText('Fixture Monk');
  await page.keyboard.press('ArrowUp');
  const picker = page.locator('.character-switch-search input');
  await expect(picker).toBeFocused();
  // The search is the top of the view: ↑ there stays (HUB-137).
  await page.keyboard.press('ArrowUp'); await expect(picker).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(selected).toBeFocused();
  // Backspace never navigates; Command-Backspace returns from the card to Home.
  await page.keyboard.press('Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Characters');
  await page.keyboard.press('Meta+Backspace');
  await expect(search).toHaveValue('switch character');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
});

for (const material of ['Guild Wars', 'Modern']) test(`floating Whispers paints one complete ${material} frame and preserves a draft across hide/show`, async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByLabel('Panel style', { exact: true }).selectOption({ label: material });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('whisper Romi'); await search.press('Enter');
  const panel = page.locator('#whisper-window');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(panel.locator('.ui-window-lock')).toHaveCount(0);
  const draft = page.getByRole('textbox', { name: 'Message Romi Ranger', exact: true });
  await draft.fill('Keep this draft');
  await page.getByRole('button', { name: 'Hide Whispers' }).click();
  await page.keyboard.press('Meta+d');
  await expect(draft).toHaveValue('Keep this draft');
  const geometry = await panel.evaluate(element => {
    const head = element.querySelector('.whisper-frame-head')!;
    const title = head.querySelector('h2')!;
    const header = head.getBoundingClientRect(), label = title.getBoundingClientRect();
    const paint = getComputedStyle(element, '::before');
    return { boxSizing: getComputedStyle(element).boxSizing, fill: paint.backgroundColor, mask: paint.maskImage, z: paint.zIndex, delta: Math.abs((header.top + header.bottom - label.top - label.bottom) / 2) };
  });
  expect(geometry.boxSizing).toBe('border-box'); expect(geometry.fill).not.toBe('rgba(0, 0, 0, 0)'); expect(geometry.delta).toBeLessThan(2);
  expect(geometry.mask).toBe('none'); expect(Number(geometry.z)).toBeLessThan(0);
  await page.screenshot({ path: info.outputPath('whisper-floating.png') });
});

test('one list move keeps focus in search: arrows, Control-N/P, pages and ends never wrap', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const rows = page.locator('.hub-row');
  const selected = page.locator('.hub-row[aria-selected="true"]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(8);
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowUp'); await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('Control+n'); await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('Control+p'); await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('PageDown');
  expect(await selected.getAttribute('id')).not.toBe('hub-result-0');
  await search.press('End');
  await expect(rows.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(count - 1)).toBeInViewport();
  await search.press('ArrowDown'); await expect(rows.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
  await search.press('Home'); await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-activedescendant', 'hub-result-0');
  // The results scroller is no Tab stop (HUB-045).
  await expect(page.locator('#hub-results')).toHaveAttribute('tabindex', '-1');
  // A click on a navigational row opens it and leaves the keyboard in search.
  await page.locator('.hub-row[data-id="commands"]').click();
  await expect(page.locator('.hub-caption')).toHaveText('Commands');
  await expect(search).toBeFocused();
});

test('the Characters carousel takes the same list move and never wraps', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Meta+e');
  const cards = page.locator('.character-switch-list button[data-row]');
  const focusedRow = () => page.evaluate(() => Number((document.activeElement as HTMLElement | null)?.dataset.row ?? -1));
  const count = await page.evaluate(() => window.gwCharacterSwitch?.characters.status === 'ready' ? window.gwCharacterSwitch.characters.characters.length : 0);
  expect(count).toBeGreaterThan(5);
  await expect(cards.first()).toBeFocused();
  const previous = page.getByRole('button', { name: 'Previous character' });
  const next = page.getByRole('button', { name: 'Next character' });
  await expect(previous).toBeDisabled();
  // Up leaves the cards for the character search (plan §3), so it is no list step here.
  for (const key of ['ArrowLeft', 'Home', 'PageUp', 'Control+p']) { await page.keyboard.press(key); expect(await focusedRow(), key).toBe(0); }
  await page.keyboard.press('Control+n'); expect(await focusedRow()).toBe(1);
  await page.keyboard.press('ArrowRight'); expect(await focusedRow()).toBe(2);
  await page.keyboard.press('End'); expect(await focusedRow()).toBe(count - 1);
  await expect(next).toBeDisabled();
  for (const key of ['ArrowRight', 'ArrowDown', 'End', 'PageDown', 'Control+n']) { await page.keyboard.press(key); expect(await focusedRow(), key).toBe(count - 1); }
  await page.keyboard.press('PageUp'); expect(await focusedRow()).toBeLessThan(count - 1);
  await page.keyboard.press('Home'); expect(await focusedRow()).toBe(0);
  await expect(page.locator('.character-switch-list button[aria-selected="true"], .character-switch-list button[data-selected="true"]').first()).toBeFocused();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
});

test('one list move from no selection: End lands on the last result, every other move on the first', async ({ page }) => {
  await page.goto('/?hub&party');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const rows = page.locator('.hub-row');
  const selected = page.locator('.hub-row[aria-selected="true"]');
  // A bare consequential scope preselects nothing, so Enter can never invite on a guess.
  for (const [key, last] of [['End', true], ['Home', false], ['PageUp', false], ['ArrowUp', false], ['ArrowDown', false], ['Control+n', false], ['PageDown', false]] as const) {
    await search.fill('invite ');
    await expect(rows.nth(2)).toBeVisible();
    await expect(selected).toHaveCount(0);
    const count = await rows.count();
    await search.press(key);
    await expect(rows.nth(last ? count - 1 : 0), key).toHaveAttribute('aria-selected', 'true');
    await expect(search).toBeFocused();
  }
});

test('list keys without results keep the caret and the text selection in search', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('qqqzzz');
  await expect(page.locator('.hub-empty')).toBeVisible();
  for (const key of ['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'Control+n']) {
    await search.evaluate(input => (input as HTMLInputElement).setSelectionRange(1, 3));
    await search.press(key);
    expect(await search.evaluate(input => [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd]), key).toEqual([1, 3]);
  }
  await page.keyboard.press('Delete');
  await expect(search).toHaveValue('qzzz');
});

test('a view whose first buttons are disabled still takes focus, and Command-Backspace leaves it', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('hub preferences'); await page.keyboard.down('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Hub preferences');
  // Nothing is pinned, so Reset aliases is disabled; focus goes to the first usable control.
  await expect(page.getByRole('button', { name: 'Reset aliases', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reset Hub position', exact: true })).toBeFocused();
  await page.keyboard.up('Enter');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(search).toHaveValue('hub preferences');
  await expect(search).toBeFocused();
});

test('Command-Backspace goes back one Build Library level, restores the parent and speaks its title (BLD-24)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const announced = page.locator('#hub .hub-announce');
  await expect(announced).toHaveAttribute('aria-live', 'polite');
  await expect(announced).toHaveText('');
  await search.fill('build smi');
  await search.press('ArrowLeft'); await search.press('ArrowLeft');
  await expect(page.locator('#hub .hub-row[aria-selected="true"]')).toContainText('Smiter');
  await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Smiter');
  await search.press('ArrowDown'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Smiter›Heroes');
  await page.keyboard.type('liv');
  // One press: back to the target page without clearing the child query first, and the title is spoken.
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Smiter');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.locator('#hub .hub-row[aria-selected="true"]')).toContainText('Apply to hero');
  await expect(announced).toHaveText('Smiter');
  // A held press goes back one more level only, to the query with its caret and selection.
  await page.keyboard.down('Meta');
  for (let press = 0; press < 26; press++) await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace'); await page.keyboard.up('Meta');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home');
  await expect(search).toHaveValue('build smi');
  expect(await search.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])).toEqual([7, 7]);
  await expect(page.locator('#hub .hub-row[aria-selected="true"]')).toContainText('Smiter');
  await expect(announced).toHaveText('Home');
  // The same destination twice still changes the region's text, so it is spoken again.
  await search.press('Enter');
  await page.keyboard.press('Meta+Backspace');
  await expect.poll(() => announced.evaluate(region => region.textContent)).toBe('Home\u00a0');
  expect(await page.evaluate(() => window.gwFixtureCanvas?.events.length)).toBe(0);
});

test('a page opened directly returns to the real Home, and Home ignores Command-Backspace', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('kam');
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(search).toHaveValue('kam');
  await expect(page.locator('.hub-legend')).not.toContainText('⌘⌫');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(page.locator('#hub')).toBeHidden();
  // Command-E opens Characters with no parent page; Back from its focused card goes to Home.
  await page.keyboard.press('Meta+e');
  await expect(page.locator('.hub-caption')).toHaveText('Characters');
  await expect(page.locator('.character-switch-row[data-selected=true]')).toBeFocused();
  await expect(page.locator('.hub-back')).toBeVisible();
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(search).toBeFocused();
});

test('Command-Backspace steps out of a view\'s own inner level before it leaves the view', async ({ page }) => {
  await page.goto('/?hub&lifecycle=pve-explorable');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const caption = page.locator('.hub-caption');
  // On a confirmation it acts as Cancel, like Esc and Stay here. One a Hub row asked for
  // returns to that row (HUB-075); one a card asked for returns to the cards.
  await search.fill('char toefte'); await search.press('Enter');
  await expect(page.locator('#character-switch-title')).toHaveText('Leave this area and switch to Toefte?');
  await page.keyboard.press('Meta+Backspace');
  await expect(caption).toHaveText('Home');
  await expect(search).toHaveValue('char toefte');
  await page.keyboard.press('Meta+e');
  await expect(caption).toHaveText('Characters');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(page.locator('#character-switch-title')).toHaveText('Leave this area and switch to Fixture Warrior?');
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('#character-switch-title')).toHaveText('Switch Character');
  await expect(caption).toHaveText('Characters');
  await expect(page.locator('.character-switch-row[data-selected=true]')).toBeFocused();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
  // Characters settings return to the cards; the next press leaves Characters.
  await page.getByRole('button', { name: 'Character Switch settings', exact: true }).click();
  await expect(page.locator('.character-switch-settings')).toBeVisible();
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.character-switch-settings')).toBeHidden();
  await expect(caption).toHaveText('Characters');
  await page.keyboard.press('Meta+Backspace');
  await expect(caption).toHaveText('Home');
  await expect(search).toHaveValue('char toefte');
  // Travel Customize returns to the destination list; an open picker closes first.
  await page.keyboard.press('Meta+t');
  await page.getByRole('button', { name: 'Customize Travel', exact: true }).click();
  const customize = page.locator('#travel-customize-panel');
  await expect(customize).toBeVisible();
  await customize.getByRole('button', { name: /shortcut 1\b/ }).click();
  const picker = customize.locator('details.travel-destination-picker');
  await picker.locator('summary').click();
  await expect(picker).toHaveAttribute('open', '');
  await page.keyboard.press('Meta+Backspace');
  await expect(picker).not.toHaveAttribute('open', '');
  await expect(customize).toBeVisible();
  await page.keyboard.press('Meta+Backspace');
  await expect(customize).toBeHidden();
  await expect(caption).toHaveText('Travel');
  await expect(page.locator('#travel-search-input')).toBeFocused();
  await page.keyboard.press('Meta+Backspace');
  await expect(caption).toHaveText('Home');
});

test('Backspace on a focused footer button edits the search and returns focus to it', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('kam'); await page.keyboard.press('Tab');
  await expect(page.locator('.hub-primary')).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('ka');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
});

test('the mouse back button goes back one level and never closes the Hub', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('accounts'); await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Accounts');
  const back = () => page.locator('.hub-panel').dispatchEvent('mouseup', { button: 3 });
  await back();
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(search).toHaveValue('accounts');
  await back();
  await expect(page.locator('#hub')).toBeVisible();
});

// HUB-048: a held Backspace only edits; it never leaves Travel or its picker, nor eats Home's query.
test('a held Backspace empties Travel\'s search and leaves Travel, its picker and Home\'s query alone', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const caption = page.locator('.hub-caption');
  await search.fill('trav');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'travel');
  await search.press('Enter');
  await expect(caption).toHaveText('Travel');
  const travelSearch = page.locator('#travel-search-input');
  await travelSearch.fill('kam');
  for (let press = 0; press < 7; press++) await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace');
  await expect(caption).toHaveText('Travel');
  await expect(travelSearch).toHaveValue('');
  await expect(travelSearch).toBeFocused();
  await page.getByRole('button', { name: 'Customize Travel', exact: true }).click();
  const customize = page.locator('#travel-customize-panel');
  await customize.getByRole('button', { name: /shortcut 1\b/ }).click();
  const picker = customize.locator('details.travel-destination-picker');
  await picker.locator('summary').click();
  const pickerSearch = picker.locator('input').first();
  await pickerSearch.focus();
  await expect(pickerSearch).toHaveValue('');
  for (let press = 0; press < 7; press++) await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace');
  await expect(customize).toBeVisible();
  await expect(caption).toHaveText('Travel');
  await page.keyboard.press('Meta+Backspace');
  await page.keyboard.press('Meta+Backspace');
  await page.keyboard.press('Meta+Backspace');
  await expect(caption).toHaveText('Home');
  await expect(search).toHaveValue('trav');
});
