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
