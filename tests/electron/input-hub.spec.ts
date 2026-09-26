import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchPlayableClient, closeOffline, isDomActiveElement } from './fixtures.mjs';
import { startGameInput } from './input-helpers.js';

test('Command-R opens Core Hub, keeps editing local and restores game focus', async () => {
  const fixture = await launchPlayableClient('gw-hub-keyboard-e2e-', {}, userData =>
    writeFile(path.join(userData, 'settings.json'), JSON.stringify({ gwonmacTools: true, buildLibrary: true })),
  );
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
    await search.press('ArrowDown'); await page.keyboard.type('1250 gold in p');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('1250 gold in p');
    await expect(hub.getByRole('option')).toContainText('1.25 platinum');
    await expect.poll(() => hub.locator('.hub-conversion-art').evaluateAll(images =>
      images.length === 2 && images.every(image => image instanceof HTMLImageElement && image.naturalWidth > 0),
    )).toBe(true);
    await search.press('Meta+a'); await expect(search).toHaveValue('1250 gold in p');
    await search.fill('');
    await expect(hub.getByRole('option', { name: /Build Library Browse saved builds/ })).toBeVisible();
    await app.evaluate(({ BrowserWindow }, url) => {
      const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
      contents?.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: ['meta'] });
      contents?.sendInputEvent({ type: 'keyUp', keyCode: 'B', modifiers: ['meta'] });
    }, page.url());
    await expect(hub.locator('.hub-caption')).toHaveText('Build Library');
    await expect(page.locator('#toolbox-builds .tools-window')).toBeHidden();
    await expect(hub.getByRole('option', { name: /Guild Wars templates/ })).toBeVisible();
    await search.press('ArrowRight');
    await expect(hub.locator('.hub-caption')).toHaveText('Guild Wars templates');
    await hub.getByRole('button', { name: 'Back', exact: true }).click();
    await hub.getByRole('button', { name: 'Back', exact: true }).click();
    await search.fill('1250 gold in p');
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
    // The first Escape clears the query (D-4); the second closes Hub.
    await search.press('Escape'); await expect(search).toHaveValue('');
    await search.press('Escape'); await expect(hub).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
  } finally { await closeOffline(fixture); }
});

test('Hub list navigation preserves native editing shortcuts, Unicode and composition', async () => {
  const fixture = await launchPlayableClient('gw-hub-editing-e2e-');
  const { app, page } = fixture;
  const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.availableFormats().map(format => ({
    format, bytes: clipboard.readBuffer(format).toString('base64'),
  })));
  try {
    await startGameInput(page);
    await page.evaluate(() => { document.getElementById('loading')?.classList.add('gone'); window.gwHub?.show(); });
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    const row = page.locator('.hub-row[aria-selected=true]');
    await search.fill('sw'); await search.press('ArrowDown');
    await app.evaluate(({ BrowserWindow }, url) => {
      const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
      contents?.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['meta'] });
      contents?.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['meta'] });
    }, page.url());
    await expect(search).toBeFocused();
    await expect.poll(() => search.evaluate(input => input instanceof HTMLInputElement ? [input.selectionStart, input.selectionEnd] : null)).toEqual([0, 2]);
    await search.press('ArrowDown');
    await app.evaluate(({ BrowserWindow, clipboard }, url) => {
      clipboard.writeText('travel');
      const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
      contents?.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['meta'] });
      contents?.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['meta'] });
    }, page.url());
    await expect(search).toHaveValue('travel');
    await search.press('ArrowDown'); await page.keyboard.press('Meta+z');
    await expect(search).toHaveValue('sw');
    await search.press('ArrowDown'); await page.keyboard.press('Meta+Shift+z');
    await expect(search).toHaveValue('travel');
    await search.evaluate(input => { if (input instanceof HTMLInputElement) input.setSelectionRange(0, 1); });
    await search.press('ArrowDown'); await page.keyboard.press('Delete');
    await expect(search).toHaveValue('ravel');
    await search.fill('sw'); await search.press('ArrowDown');
    await expect(search).toBeFocused(); await expect(row).toHaveCount(1);
    // Chromium owns the composed edit; this checks the host path, not an OS input-source UI.
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Dead', code: 'KeyE', modifiers: 1 });
      await expect(search).toBeFocused();
      await cdp.send('Input.insertText', { text: 'é' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Dead', code: 'KeyE', modifiers: 1 });
      await expect(search).toHaveValue('swé');
      await search.fill('sw'); await search.press('ArrowDown');
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Process', windowsVirtualKeyCode: 229 });
      await expect(search).toBeFocused();
      await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
      await expect(search).toHaveValue('sw日本');
      await cdp.send('Input.insertText', { text: '日本' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', windowsVirtualKeyCode: 229 });
      await expect(search).toHaveValue('sw日本');
    } finally { await cdp.detach(); }
    await expect(page.locator('.hub-caption')).toHaveText('Home');
    await search.press('Escape'); await search.press('Escape');
    await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
  } finally {
    await app.evaluate(({ clipboard }, saved) => {
      clipboard.clear();
      for (const item of saved) clipboard.writeBuffer(item.format, Buffer.from(item.bytes, 'base64'));
    }, clipboardBefore);
    await closeOffline(fixture);
  }
});
