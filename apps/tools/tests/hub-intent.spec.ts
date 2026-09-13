import { expect, test } from '@playwright/test';

const searchName = 'Search people, places, builds';
test('character entry is card-first and Back restores the launching result', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('sw'); await search.press('ArrowDown'); await page.keyboard.press('Enter');
  const card = page.locator('#character-switch-list button:focus');
  await expect(card).toHaveCount(1);
  const first = await card.getAttribute('data-character-key');
  await page.keyboard.press('ArrowRight');
  await expect(card).not.toHaveAttribute('data-character-key', first!);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#character-switch-query')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue('sw');
  await expect(page.locator('.hub-row[data-id="character"]')).toBeFocused();
});

test('account actions restore each visited account and command row', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('switch account'); await search.press('ArrowDown'); await page.keyboard.press('Enter');
  const account = page.locator('.hub-row:focus');
  await expect(account).toContainText('Second');
  const identity = await account.getAttribute('data-id');
  await page.keyboard.press('Enter');
  await expect(page.locator('.hub-row:focus')).toContainText('Close');
  await page.keyboard.press('Backspace');
  await expect(page.locator(`.hub-row[data-id="${identity}"]`)).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.hub-row[data-id="accounts"]')).toBeFocused();
  await expect(search).toHaveValue('switch account');
  await page.keyboard.press('ArrowUp'); await expect(search).toBeFocused();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Account/);
});

test('temporary blur resumes the stage and focus while explicit close starts fresh', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build monk'); await search.press('ArrowDown'); await page.keyboard.press('Enter');
  const selected = await page.locator('.hub-row:focus').getAttribute('data-id');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#hub')).not.toBeVisible();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(page.locator('.hub-summary')).toContainText('Protection');
  await expect(page.locator(`.hub-row[data-id="${selected}"]`)).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(search).toHaveValue('build monk');
  await expect(page.locator('.hub-row:focus')).toContainText('Protection');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(search).toHaveValue(''); await expect(search).toBeFocused();
});

test('native editing shortcuts from results return to the same search', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build monk'); await search.press('ArrowDown');
  await page.keyboard.press('Meta+a'); await expect(search).toBeFocused();
  await page.keyboard.type('sw'); await expect(search).toHaveValue('sw');
  await search.press('ArrowDown'); await page.keyboard.type('itch');
  await expect(search).toHaveValue('switch');
});
