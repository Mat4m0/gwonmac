import { expect, test, type Page } from '@playwright/test';

/**
 * One keyboard model across the Hub and its popouts: the shared list keys never
 * wrap, ↑ at the top of a list stays, and Escape and ⌘⌫ leave the innermost level
 * first (a disclosure, a prompt, a drawer, a typed query) before a page or a popout.
 */
const searchName = 'Search people, places, builds';
const hubSearch = (page: Page) => page.getByRole('combobox', { name: searchName });
const openHub = async (page: Page, query = '') => {
  await page.goto(`/?hub${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(hubSearch(page)).toBeFocused();
};
const canvasKeys = (page: Page) => page.evaluate(() => (window.gwFixtureCanvas?.events ?? []).filter(event => event.type.startsWith('key')).length);

test('Travel moves one selection with the shared list keys and never wraps (HUB-044, HUB-137)', async ({ page }) => {
  await openHub(page);
  await page.keyboard.press('Meta+t');
  const travel = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
  await expect(travel).toBeFocused();
  const active = () => travel.getAttribute('aria-activedescendant');
  const first = await active();
  await page.keyboard.press('ArrowUp');
  expect(await active()).toBe(first);
  await page.keyboard.press('End');
  const last = await active();
  expect(last).not.toBe(first);
  await page.keyboard.press('ArrowDown');
  expect(await active()).toBe(last);
  await page.keyboard.press('Home');
  expect(await active()).toBe(first);
  await page.keyboard.press('Control+n');
  expect(await active()).not.toBe(first);
  await page.keyboard.press('Control+p');
  expect(await active()).toBe(first);
  await page.keyboard.press('PageDown');
  expect(await active()).not.toBe(first);
  await expect(travel).toBeFocused();
  await travel.fill('a');
  await page.keyboard.press('End');
  await expect(page.locator(`#${await active()}`)).toBeInViewport();
  await expect(travel).toBeFocused();
});

test('Characters: search leads the Tab order, the cards are one roving Tab stop, and ↑ in search stays (HUB-137, HUB-138)', async ({ page }) => {
  await openHub(page);
  await page.keyboard.press('Meta+e');
  const card = page.locator('#character-switch-list button[data-selected=true]');
  await expect(card).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  const chosen = await card.getAttribute('data-character-key');
  await expect(page.locator('#character-switch-list button[tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('#character-switch-list button[tabindex="0"]')).toHaveAttribute('data-character-key', chosen!);
  const query = page.locator('#character-switch-query');
  // In DOM order the search comes before the heading, where it is drawn.
  expect(await page.evaluate(() => {
    const search = document.querySelector('#character-switch-query')!;
    const heading = document.querySelector('#character-switch-title')!;
    return Boolean(search.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await page.keyboard.press('ArrowUp'); await expect(query).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(query).toBeFocused();
  // Tab from the search reaches the selected card, not the first one.
  for (let press = 0; press < 6 && !(await card.evaluate(element => element === document.activeElement)); press++) await page.keyboard.press('Tab');
  await expect(card).toBeFocused();
  await expect(card).toHaveAttribute('data-character-key', chosen!);
  await expect(page.locator('.character-switch-list-hints')).toContainText('↑ search');
  await expect(page.locator('.character-switch-list-hints')).not.toContainText('Back');
});

test('Settings arrows stay in their column: sections do not wrap, → enters a section, ← returns (HUB-054)', async ({ page }) => {
  await openHub(page);
  await hubSearch(page).fill('settings'); await page.keyboard.press('Enter');
  const tools = page.getByRole('button', { name: 'Tools', exact: true });
  await expect(tools).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(tools).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const enable = page.getByRole('checkbox', { name: 'Enable Tools' });
  await expect(enable).toBeFocused();
  const heading = page.locator('.hub-settings-body h2');
  for (let press = 0; press < 16; press++) {
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.hub-settings nav button:focus')).toHaveCount(0);
  }
  await expect(heading).toHaveText('Tools');
  await page.keyboard.press('ArrowLeft');
  await expect(tools).toBeFocused();
  await page.keyboard.press('End');
  await expect(heading).toHaveText('Chat & characters');
  await page.keyboard.press('ArrowDown');
  await expect(heading).toHaveText('Chat & characters');
  // → enters the first usable control even where the first one is disabled.
  await page.getByRole('button', { name: 'Shortcuts', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(heading).toHaveText('Shortcuts');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.hub-settings-body :focus')).toBeEnabled();
});

test('arrow keys scroll Build details and never jump to Back (HUB-088)', async ({ page }) => {
  await openHub(page);
  await hubSearch(page).fill('build smiter'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Details' }).click();
  const details = page.locator('.hub-build-details');
  await expect(details).toBeFocused();
  for (let press = 0; press < 3; press++) await page.keyboard.press('ArrowDown');
  await expect.poll(() => details.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  for (let press = 0; press < 3; press++) await page.keyboard.press('ArrowUp');
  await expect.poll(() => details.evaluate(element => element.scrollTop)).toBe(0);
  await expect(details).toBeFocused();
});

test('the Trade ledger moves with the shared list keys (HUB-044)', async ({ page }) => {
  await openHub(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  const trade = page.getByRole('dialog', { name: 'Trade Chat' });
  const rows = trade.locator('.trade-list [data-timestamp]');
  await rows.first().focus();
  await page.keyboard.press('End');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('Control+n');
  await expect(rows.nth(1)).toBeFocused();
});
