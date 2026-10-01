import { expect, test } from '@playwright/test';

test('a friend page never guesses a game action when Whispers is off', async ({ page }) => {
  await page.goto('/?hub&party');
  const search = page.locator('.hub-search input');
  await expect(search).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { whispersEnabled: false } })));
  await search.fill('Romi'); await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Romi Ranger');
  await expect(search).not.toHaveAttribute('aria-activedescendant', /.+/u);
  await search.press('Enter');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL|INVITE/u);
  await expect(page.locator('#hub')).toBeVisible();
  await search.press('ArrowDown');
  await expect(page.locator('.hub-primary')).toContainText('Travel');
});

test('a friend root Actions menu exposes the same four explicit person actions', async ({ page }) => {
  await page.goto('/?hub&party');
  const search = page.locator('.hub-search input');
  await search.fill('Romi');
  await search.press('Meta+j');
  const menu = page.getByRole('menu', { name: 'Actions', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toContainText(['View actions', 'Write whisper', 'Travel to', 'Invite Romi Ranger', 'Travel and invite Romi Ranger']);
  await expect(menu.getByRole('menuitem', { name: 'Travel and invite Romi Ranger', exact: true })).toHaveAttribute('aria-description', 'You are already in this outpost');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL|INVITE/u);
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await search.press('Enter');
  await expect(page.locator('#hub').getByRole('option')).toContainText(['Whisper', 'Travel to outpost', 'Invite to party', 'Travel and invite']);
});


test('Whispers has one hide control and its resize grip stays outside normal Tab order', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('whisper Foo'); await search.press('Enter');
  const window = page.locator('#whisper-window');
  await expect(window).toBeVisible();
  await expect(window.getByRole('button', { name: /Hide Whispers|Collapse whispers/u })).toHaveCount(1);
  await expect(window.getByRole('button', { name: 'Resize whispers', exact: true })).toHaveAttribute('tabindex', '-1');
});


test('a withdrawn selected friend announces the loss and never substitutes a game action', async ({ page }) => {
  await page.goto('/?hub&party');
  const search = page.locator('.hub-search input');
  await search.fill('Romi');
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Romi Ranger');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-withdraw')));
  await expect(search).not.toHaveAttribute('aria-activedescendant', /.+/u);
  await expect(page.locator('.hub-status')).toHaveText('The previous selection is no longer available. Choose a result.');
  await search.press('Enter');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL|INVITE/u);
});
