import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { closeOffline, isDomActiveElement, launchPlayableClient, type OfflineFixture } from './fixtures.mjs';
import { startGameInput } from './input-helpers.js';

/**
 * The Hub input contract at the native boundary (spec §13): physical shortcut
 * interception in main, key releases, game focus restoration, direct scopes and
 * native-dialog priority. A canvas key recorder stands in for Guild Wars' canvas
 * listeners. A key can reach the game only while the canvas has focus, so each
 * release check sends the key-up after the press has moved focus back to the
 * canvas. Cases marked `fixme` document a current leak and change when the
 * owning fix lands; the browser fixture's golden matrix
 * (`apps/tools/tests/hub-keyboard-contract.spec.ts`) covers the same keys
 * without the main process.
 */
type RecordingWindow = typeof window & { __hubContractKeys?: string[] };
type DialogRecord = { __hubContractDialogs?: string[] };
type Modifier = 'meta' | 'shift';

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
const canvasKeysFor = async (page: Page, code: string) => (await canvasKeys(page)).filter(key => key.includes(code));

/** One physical key event through Electron's input pipeline, so main's shortcut claiming runs. */
async function sendKey(fixture: OfflineFixture, type: 'keyDown' | 'keyUp', keyCode: string, modifiers: Modifier[] = []) {
  await fixture.app.evaluate(({ BrowserWindow }, { url, type, keyCode, modifiers }) => {
    const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
    if (!contents) throw new Error('Game fixture window is missing');
    contents.sendInputEvent({ type, keyCode, modifiers });
  }, { url: fixture.page.url(), type, keyCode, modifiers });
}
async function chord(fixture: OfflineFixture, keyCode: string, modifiers: Modifier[] = []) {
  await sendKey(fixture, 'keyDown', keyCode, modifiers);
  await sendKey(fixture, 'keyUp', keyCode, modifiers);
}

const hubOf = (page: Page) => page.getByRole('dialog', { name: 'Hub', exact: true });
const searchOf = (page: Page) => page.getByRole('combobox', { name: 'Search people, places, builds' });

test('Command-R and typed search stay in the Hub, and the game gets the next key after it closes', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await page.keyboard.type('kam');
    await expect(searchOf(page)).toHaveValue('kam');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(hub).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
    await clearCanvasKeys(page);
    await page.keyboard.press('w');
    expect(await canvasKeys(page)).toEqual(['keydown:KeyW', 'keyup:KeyW']);
  } finally { await closeOffline(fixture); }
});

test('the Command-R that closes the Hub keeps its release out of the game', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await searchOf(page).fill('kam');
    await clearCanvasKeys(page);
    // Hold Command-R: the Hub closes and the game gets focus back before R is released.
    await sendKey(fixture, 'keyDown', 'R', ['meta']);
    await expect(hub).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
    await sendKey(fixture, 'keyUp', 'R', ['meta']);
    await page.keyboard.press('w');
    // The release belongs to the claimed press; the next key belongs to the game.
    expect(await canvasKeys(page)).toEqual(['keydown:KeyW', 'keyup:KeyW']);
  } finally { await closeOffline(fixture); }
});

test('Command-B and Command-T open their scope in the open Hub and never type into search', async () => {
  const fixture = await launch({ travelPalette: true });
  try {
    const { page } = fixture;
    await page.evaluate(async () => {
      const specifier = './travel-palette.js';
      const module = await import(specifier) as typeof import('../../src/renderer/travel-palette.js');
      module.createTravelPalette(document.body, {
        travel: () => undefined, guildHall: () => undefined, guildHallUnavailable: () => null, unavailable: () => null,
      }).setEnabled(true);
    });
    const hub = hubOf(page);
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await searchOf(page).fill('kam');
    await chord(fixture, 'B', ['meta']);
    await expect(hub.locator('.hub-caption')).toHaveText('Build Library');
    await expect(searchOf(page)).toBeFocused();
    await expect(searchOf(page)).toHaveValue('');
    await chord(fixture, 'T', ['meta']);
    await expect(hub.locator('.hub-caption')).toHaveText('Travel');
    const travel = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
    await expect.poll(() => isDomActiveElement(travel)).toBe(true);
    await expect(travel).toHaveValue('');
    expect([...await canvasKeysFor(page, 'KeyB'), ...await canvasKeysFor(page, 'KeyT')]).toEqual([]);
  } finally { await closeOffline(fixture); }
});

test('Command-D hands the open Hub to Whispers, and its closing release stays out of the game', async () => {
  const fixture = await launch({ whispersEnabled: true });
  try {
    const { page } = fixture;
    await page.evaluate(async () => {
      const modelPath = './shared/whisper-session.js';
      const surfacePath = './whisper-surface.js';
      const model = await import(modelPath) as typeof import('../../src/shared/whisper-session.js');
      const surface = await import(surfacePath) as typeof import('../../src/renderer/whisper-surface.js');
      const session = model.createWhisperSession(async () => {});
      session.setAvailable(true);
      surface.createWhisperSurface(document.body, session);
    });
    await expect(page.locator('#whisper-window')).toBeAttached();
    const hub = hubOf(page);
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await chord(fixture, 'D', ['meta']);
    await expect(hub).toBeHidden();
    await expect(page.locator('#whisper-person')).toBeFocused();
    await clearCanvasKeys(page);
    // Held Command-D closes Whispers and returns focus to the game before D is released.
    await sendKey(fixture, 'keyDown', 'D', ['meta']);
    await expect(page.locator('#whisper-window')).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
    await sendKey(fixture, 'keyUp', 'D', ['meta']);
    await page.keyboard.press('w');
    expect(await canvasKeys(page)).toEqual(['keydown:KeyW', 'keyup:KeyW']);
  } finally { await closeOffline(fixture); }
});

test('Command-Q opens the native Quit or Reload sheet over the open Hub, and Cancel leaves the Hub as it was', async () => {
  const fixture = await launch();
  try {
    const { app, page } = fixture;
    await app.evaluate(({ dialog }) => {
      const record: string[] = [];
      (globalThis as DialogRecord).__hubContractDialogs = record;
      Object.defineProperty(dialog, 'showMessageBox', {
        configurable: true,
        // The sheet's Cancel button (cancelId 2).
        value: async (_window: unknown, options: { message?: string }) => { record.push(options.message ?? ''); return { response: 2, checkboxChecked: false }; },
      });
    });
    const dialogs = () => app.evaluate(() => [...(globalThis as DialogRecord).__hubContractDialogs ?? []]);
    const hub = hubOf(page);
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await searchOf(page).fill('kam');
    await clearCanvasKeys(page);
    await sendKey(fixture, 'keyDown', 'Q', ['meta']);
    await expect.poll(dialogs).toEqual(['Quit or reload Guild Wars?']);
    await sendKey(fixture, 'keyUp', 'Q', ['meta']);
    // Main owns Command-Q before the Hub: nothing reaches search or the game, and the task survives.
    await expect(hub).toBeVisible();
    await expect(searchOf(page)).toHaveValue('kam');
    await expect(searchOf(page)).toBeFocused();
    expect(await canvasKeysFor(page, 'KeyQ')).toEqual([]);
    expect(await dialogs()).toEqual(['Quit or reload Guild Wars?']);
  } finally { await closeOffline(fixture); }
});

// HUB-003: a press the Hub owns keeps its key-up and repeats out of the game.
test.fixme('the Escape that closes the Hub never reaches the game, held or tapped', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = hubOf(page);
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
    expect(await canvasKeysFor(fixture.page, 'KeyS')).toEqual([]);
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
