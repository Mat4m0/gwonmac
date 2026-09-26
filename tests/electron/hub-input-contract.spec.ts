import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { closeOffline, launchPlayableClient, type OfflineFixture } from './fixtures.mjs';
import { startGameInput } from './input-helpers.js';

/**
 * The Hub input contract at the native boundary (spec §13): which physical key
 * events reach the game canvas while the Hub owns a press. A canvas key recorder
 * stands in for Guild Wars' canvas listeners. Cases marked `fixme` document a
 * current leak and are expected to change when the owning fix lands; the browser
 * fixture's golden matrix (`apps/tools/tests/hub-keyboard-contract.spec.ts`)
 * covers the same keys without the main process.
 */
type RecordingWindow = typeof window & { __hubContractKeys?: string[] };

async function launch(settings: Record<string, unknown> = {}) {
  const fixture = await launchPlayableClient('gw-hub-input-contract-e2e-', {}, userData =>
    writeFile(path.join(userData, 'settings.json'), JSON.stringify({ gwonmacTools: true, buildLibrary: true, ...settings })));
  await startGameInput(fixture.page);
  await fixture.page.evaluate(() => {
    document.getElementById('loading')?.classList.add('gone');
    const canvas = document.getElementById('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#canvas is missing');
    const keys: string[] = [];
    (window as RecordingWindow).__hubContractKeys = keys;
    for (const type of ['keydown', 'keyup'] as const) {
      canvas.addEventListener(type, event => { keys.push(`${type}:${event.code}${event.repeat ? ':repeat' : ''}`); }, true);
    }
    canvas.focus();
  });
  return fixture;
}

const canvasKeys = (page: Page) => page.evaluate(() => [...(window as RecordingWindow).__hubContractKeys ?? []]);
const clearCanvasKeys = (page: Page) => page.evaluate(() => { (window as RecordingWindow).__hubContractKeys?.splice(0); });

/** A physical chord through Electron's input pipeline, so main's shortcut claiming runs. */
async function chord(fixture: OfflineFixture, keyCode: string, modifiers: ('meta' | 'shift')[] = []) {
  await fixture.app.evaluate(({ BrowserWindow }, { url, keyCode, modifiers }) => {
    const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
    if (!contents) throw new Error('Game fixture window is missing');
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { url: fixture.page.url(), keyCode, modifiers });
}

test('Command-R and typed search stay in the Hub, and the game gets the next key after it closes', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = page.getByRole('dialog', { name: 'Hub', exact: true });
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await page.keyboard.type('kam');
    await expect(page.getByRole('combobox', { name: 'Search people, places, builds' })).toHaveValue('kam');
    expect((await canvasKeys(page)).filter(key => /Key[RKAM]/u.test(key))).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(hub).toBeHidden();
    await clearCanvasKeys(page);
    await page.keyboard.press('w');
    expect(await canvasKeys(page)).toEqual(['keydown:KeyW', 'keyup:KeyW']);
  } finally { await closeOffline(fixture); }
});

// HUB-003: a press the Hub owns keeps its key-up and repeats out of the game.
test.fixme('the Escape that closes the Hub never reaches the game, held or tapped', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = page.getByRole('dialog', { name: 'Hub', exact: true });
    for (const repeats of [0, 3]) {
      await page.evaluate(() => window.gwHub?.show());
      await expect(hub).toBeVisible();
      await clearCanvasKeys(page);
      for (let press = 0; press <= repeats; press++) await page.keyboard.down('Escape');
      await page.keyboard.up('Escape');
      await expect(hub).toBeHidden();
      expect(await canvasKeys(page)).toEqual([]);
    }
  } finally { await closeOffline(fixture); }
});

// HUB-037: a shortcut whose tool is off still hands its base letter to the game.
test.fixme('a disabled tool shortcut never hands its letter to the game', async () => {
  const fixture = await launch({ xunlaiStorage: false });
  try {
    await chord(fixture, 'S', ['meta']);
    expect((await canvasKeys(fixture.page)).filter(key => key.includes('KeyS'))).toEqual([]);
  } finally { await closeOffline(fixture); }
});

// D-12: never claim Tab while the game canvas has focus, even with a popout open.
test.fixme('Tab reaches the game while Trade is open and the canvas has focus', async () => {
  const fixture = await launch({ tradeChat: true });
  try {
    const { page } = fixture;
    await chord(fixture, 'K', ['meta']);
    await expect(page.locator('#toolbox-trade .trade-window')).toBeVisible();
    await page.evaluate(() => document.getElementById('canvas')?.focus());
    await clearCanvasKeys(page);
    await page.keyboard.press('Tab');
    expect(await canvasKeys(page)).toEqual(['keydown:Tab', 'keyup:Tab']);
  } finally { await closeOffline(fixture); }
});
