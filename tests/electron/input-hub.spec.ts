import { expect, test } from '@playwright/test';
import { launchPlayableClient, closeOffline, isDomActiveElement } from './fixtures.mjs';
import { startGameInput } from './input-helpers.js';

test('Command-R opens Core Hub, keeps editing local and restores game focus', async () => {
  const fixture = await launchPlayableClient('gw-hub-keyboard-e2e-');
  try {
    const { app, page } = fixture;
    await startGameInput(page);
    await page.evaluate(() => { document.getElementById('loading')?.classList.add('gone'); document.getElementById('canvas')?.focus(); });
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      contents?.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: ['meta'] });
      contents?.sendInputEvent({ type: 'keyUp', keyCode: 'R', modifiers: ['meta'] });
    });
    const hub = page.getByRole('dialog', { name: 'Hub', exact: true });
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await expect(hub).toBeVisible(); await expect(search).toBeFocused();
    await search.fill('1250 gold in p');
    await expect(hub.getByRole('option')).toContainText('1.25 platinum');
    await search.press('Meta+a'); await expect(search).toHaveValue('1250 gold in p');
    await search.press('Escape'); await expect(hub).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
  } finally { await closeOffline(fixture); }
});
