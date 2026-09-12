import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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
    // Exercise the production gw:// asset route, not only the Vite fixture.
    await expect.poll(() => hub.locator('.ui-frame-artwork').evaluate(element => {
      if (!(element instanceof HTMLCanvasElement) || !element.width) return 0;
      return element.getContext('2d')?.getImageData(element.width / 2, 20 * devicePixelRatio, 1, 1).data[3] ?? 0;
    })).toBeGreaterThan(0);
    await search.fill('1250 gold in p');
    await expect(hub.getByRole('option')).toContainText('1.25 platinum');
    await expect.poll(() => hub.locator('.hub-conversion-art').evaluateAll(images =>
      images.length === 2 && images.every(image => image instanceof HTMLImageElement && image.naturalWidth > 0),
    )).toBe(true);
    await search.press('Meta+a'); await expect(search).toHaveValue('1250 gold in p');
    await app.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url);
      if (!win) throw new Error('Game fixture window is missing');
      win.setSize(1280, 960); win.webContents.setZoomFactor(2);
    }, page.url());
    await expect(search).toBeInViewport();
    await expect(hub.getByRole('button', { name: 'Close Hub', exact: true })).toBeInViewport();
    await expect.poll(() => hub.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    // Electron's native capture preserves the full window at non-default zoom.
    const png = await app.evaluate(async ({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url);
      if (!win) throw new Error('Game fixture window is missing');
      return (await win.webContents.capturePage()).toPNG().toString('base64');
    }, page.url());
    await writeFile(test.info().outputPath('hub-200-percent.png'), Buffer.from(png, 'base64'));
    await search.press('Escape'); await expect(hub).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
  } finally { await closeOffline(fixture); }
});
