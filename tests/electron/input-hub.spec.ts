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
    // Undo and Redo go through main's claim, not Playwright's injected editing commands (HUB-134).
    const commandZ = (shift: boolean) => app.evaluate(({ BrowserWindow }, { url, shift }) => {
      const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
      const modifiers: ('meta' | 'shift')[] = shift ? ['meta', 'shift'] : ['meta'];
      contents?.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers });
      contents?.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers });
    }, { url: page.url(), shift });
    await search.press('ArrowDown'); await commandZ(false);
    await expect(search).toHaveValue('sw');
    await search.press('ArrowDown'); await commandZ(true);
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

// HUB-244: the trailing clicks of a double-click or triple-click that closed the
// Hub never reach the game, so the client never sees an even press (its
// FLAG_DBL_CLICK) from them; the next deliberate click is one ordinary press.
test('the trailing clicks of a closing double-click never reach the game', async () => {
  const fixture = await launchPlayableClient('gw-hub-pointer-e2e-', {}, userData =>
    writeFile(path.join(userData, 'settings.json'), JSON.stringify({ gwonmacTools: true, buildLibrary: true })),
  );
  try {
    const { app, page } = fixture;
    await startGameInput(page);
    await page.evaluate(() => {
      document.getElementById('loading')?.classList.add('gone');
      const canvas = document.getElementById('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#canvas is missing');
      const presses: string[] = [];
      Object.assign(window, { __hubPointerPresses: presses });
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
        canvas.addEventListener(type, event => { presses.push(`${type}:${(event as MouseEvent).detail}`); }, true);
      }
      canvas.focus();
    });
    type Recording = typeof window & { __hubPointerPresses: string[] };
    const presses = () => page.evaluate(() => [...(window as Recording).__hubPointerPresses]);
    const clearPresses = () => page.evaluate(() => { (window as Recording).__hubPointerPresses.length = 0; });
    const hub = page.getByRole('dialog', { name: 'Hub', exact: true });
    const openHub = async () => {
      await app.evaluate(({ BrowserWindow }, url) => {
        const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
        contents?.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: ['meta'] });
        contents?.sendInputEvent({ type: 'keyUp', keyCode: 'R', modifiers: ['meta'] });
      }, page.url());
      await expect(hub).toBeVisible();
    };
    /** One point pressed `count` times with the click counts macOS reports. */
    const clickRun = async (x: number, y: number, count: number) => {
      await page.mouse.move(x, y);
      for (let clickCount = 1; clickCount <= count; clickCount++) {
        await page.mouse.down({ clickCount }); await page.mouse.up({ clickCount });
        if (clickCount < count) await page.waitForTimeout(120);
      }
      await expect(hub).toBeHidden();
      await page.waitForTimeout(600);
    };
    const close = hub.getByRole('button', { name: 'Close Hub', exact: true });
    for (const count of [2, 3]) {
      await openHub();
      const box = (await close.boundingBox())!;
      await clearPresses();
      await clickRun(box.x + box.width / 2, box.y + box.height / 2, count);
      expect(await presses()).toEqual([]);
    }
    await openHub();
    await clearPresses();
    await clickRun(8, 8, 2);
    expect(await presses()).toEqual([]);
    const canvas = (await page.locator('#canvas').boundingBox())!;
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height - 40);
    await expect.poll(presses).toEqual(['pointerdown:0', 'mousedown:1', 'mouseup:1', 'click:1']);
  } finally { await closeOffline(fixture); }
});

// HUB-244 through the native input path: Electron's own mouse events, as macOS
// delivers them, on a Hub row whose action closes the Hub, on × and on the
// backdrop. The input trace proves input.ts and the double-click flag saw no
// press of the run after the Hub closed (no `run=2`, `run=3` or DOUBLE-CLICK
// row), so the client's FLAG_DBL_CLICK is never set by it.
test('native click runs that close the Hub leave no later press for the game', async () => {
  const fixture = await launchPlayableClient('gw-hub-native-clicks-e2e-', {}, userData =>
    writeFile(path.join(userData, 'settings.json'), JSON.stringify({ gwonmacTools: true, buildLibrary: true, xunlaiStorage: true })),
  );
  try {
    const { app, page } = fixture;
    await startGameInput(page);
    await page.evaluate(() => {
      document.getElementById('loading')?.classList.add('gone');
      document.getElementById('canvas')?.focus();
      window.dispatchEvent(new CustomEvent('gw:input-trace', { detail: true }));
    });
    await expect(page.locator('#input-trace')).toBeVisible();
    const trace = () => page.evaluate(() => [...document.querySelectorAll('#input-trace li')].map(row => row.textContent ?? '').join('\n'));
    const clearTrace = () => page.evaluate(() => document.querySelector<HTMLButtonElement>('#input-trace [data-role="clear"]')?.click());
    const hub = page.getByRole('dialog', { name: 'Hub', exact: true });
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    const send = (events: readonly Record<string, unknown>[]) => app.evaluate(({ BrowserWindow }, { url, events }) => {
      const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
      if (!contents) throw new Error('Game fixture window is missing');
      for (const event of events) contents.sendInputEvent(event as unknown as Electron.MouseInputEvent);
    }, { url: page.url(), events });
    const openHub = async () => {
      await app.evaluate(({ BrowserWindow }, url) => {
        const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
        contents?.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: ['meta'] });
        contents?.sendInputEvent({ type: 'keyUp', keyCode: 'R', modifiers: ['meta'] });
      }, page.url());
      await expect(hub).toBeVisible();
    };
    /** One point pressed `count` times through Electron's native input, 120 ms apart. */
    const nativeClickRun = async (x: number, y: number, count: number) => {
      await send([{ type: 'mouseMove', x, y }]);
      for (let clickCount = 1; clickCount <= count; clickCount++) {
        await send([{ type: 'mouseDown', x, y, button: 'left', clickCount }, { type: 'mouseUp', x, y, button: 'left', clickCount }]);
        if (clickCount < count) await page.waitForTimeout(120);
      }
      await expect(hub).toBeHidden();
      await page.waitForTimeout(600);
    };
    const centre = async (locator: import('@playwright/test').Locator) => {
      const box = (await locator.boundingBox())!;
      return [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] as const;
    };
    const targets: [string, number, () => Promise<readonly [number, number]>][] = [
      ['Open Xunlai Storage row', 2, async () => { await search.fill('storage'); return centre(hub.locator('.hub-row', { hasText: 'Xunlai Storage' }).first()); }],
      ['Open Xunlai Storage row', 3, async () => { await search.fill('storage'); return centre(hub.locator('.hub-row', { hasText: 'Xunlai Storage' }).first()); }],
      ['Close Hub', 2, () => centre(hub.getByRole('button', { name: 'Close Hub', exact: true }))],
      ['Close Hub', 3, () => centre(hub.getByRole('button', { name: 'Close Hub', exact: true }))],
      ['backdrop', 2, async () => [8, 8] as const],
    ];
    for (const [name, count, locate] of targets) {
      await openHub();
      const [x, y] = await locate();
      await clearTrace();
      await nativeClickRun(x, y, count);
      // The first press belonged to the Hub; nothing of the run after it reached input.ts or the flag.
      const rows = await trace();
      expect(rows, `${name} × ${count}`).not.toMatch(/run=[2-9]|DOUBLE-CLICK/u);
      expect(rows, `${name} × ${count}`).not.toContain('press left canvas');
      // The point the run ended on is the game canvas now, so the empty trace is evidence, not a miss.
      expect(await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.id, [x, y])).toBe('canvas');
    }
    // A deliberate click a moment later still reaches the game as one ordinary press.
    await clearTrace();
    await page.waitForTimeout(400);
    await nativeClickRun(8, 8, 1);
    await expect.poll(trace).toContain('press left canvas run=1');
  } finally { await closeOffline(fixture); }
});
