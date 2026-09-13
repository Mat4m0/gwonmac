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

test('Travel and Settings restore their own state after a temporary hide', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('travel'); await search.press('Enter');
  const travel = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
  await travel.fill('kam');
  await expect(travel).toHaveAttribute('aria-activedescendant', /travel-/);
  const selected = await travel.getAttribute('aria-activedescendant');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(travel).toHaveValue('kam'); await expect(travel).toBeFocused();
  await expect(travel).toHaveAttribute('aria-activedescendant', selected!);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByLabel('Panel style', { exact: true }).focus();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(page.getByLabel('Panel style', { exact: true })).toBeFocused();
});

test('Hub placement survives reload, stays locked, and resets durably', async ({ page }) => {
  await page.goto('/?hub');
  const panel = page.locator('.hub-panel');
  await page.getByRole('button', { name: 'Unlock Hub position', exact: true }).click();
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).press('Alt+ArrowRight');
  await page.getByRole('button', { name: 'Resize Hub', exact: true }).press('ArrowLeft');
  const placed = (await panel.boundingBox())!;
  await page.reload();
  const restored = (await panel.boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(restored[key] - placed[key])).toBeLessThanOrEqual(1);
  await expect(panel).toHaveAttribute('data-locked', 'true');
  await page.setViewportSize({ width: 360, height: 500 });
  await expect(page.getByRole('button', { name: 'Close Hub', exact: true })).toBeInViewport();
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Hub position', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('gwonmac.hub-window-placement'))).toBeNull();
  await page.reload(); await expect(panel).not.toHaveAttribute('style', /transform: none/);
});

test('held Enter cannot activate a newly entered target page', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build monk'); await search.press('ArrowDown');
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  await expect(page.locator('.hub-row:focus')).toContainText('Apply to me');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
});


test('held Enter on footer actions and Backspace in ordinary fields keep their scope', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build monk'); await search.press('Enter');
  const apply = page.getByRole('button', { name: 'Apply to me ↵', exact: true });
  await apply.focus();
  expect(await apply.evaluate(button => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })))).toBe(false);
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('team gom afk');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('option', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill(''); await phrase.press('Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Search phrase');
  await expect(phrase).toBeFocused();
});
