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
type RecordingWindow = typeof window & { __hubContractKeys?: string[]; __hubContractPointer?: string[]; __hubContractTrips?: number[] };
type DialogRecord = { __hubContractDialogs?: string[] };
type Modifier = 'meta' | 'shift' | 'isautorepeat';

async function launch(settings: Record<string, unknown> = {}) {
  const fixture = await launchPlayableClient('gw-hub-input-contract-e2e-', {}, userData =>
    writeFile(path.join(userData, 'settings.json'), JSON.stringify({ gwonmacTools: true, buildLibrary: true, ...settings })));
  await startGameInput(fixture.page);
  await fixture.page.evaluate(() => {
    document.getElementById('loading')?.classList.add('gone');
    const canvas = document.getElementById('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#canvas is missing');
    const keys: string[] = [];
    const pointer: string[] = [];
    Object.assign(window as RecordingWindow, { __hubContractKeys: keys, __hubContractPointer: pointer });
    // A synthetic key is the buffered character-select Enter that input.ts sends in place of a physical one.
    for (const type of ['keydown', 'keyup'] as const) {
      canvas.addEventListener(type, event => { keys.push(`${type}:${event.code}${event.repeat ? ':repeat' : ''}${event.isTrusted ? '' : ':synthetic'}`); }, true);
    }
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick'] as const) {
      canvas.addEventListener(type, event => { pointer.push(`${type}:${event.detail}`); }, true);
    }
    canvas.focus();
  });
  return fixture;
}

const canvasKeys = (page: Page) => page.evaluate(() => [...(window as RecordingWindow).__hubContractKeys ?? []]);
const clearCanvasKeys = (page: Page) => page.evaluate(() => { (window as RecordingWindow).__hubContractKeys?.splice(0); });
const canvasPointer = (page: Page) => page.evaluate(() => [...(window as RecordingWindow).__hubContractPointer ?? []]);
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
/**
 * A held key as macOS delivers it: one press, then (after `whilePressed`, which
 * waits for the press to close its surface) three auto-repeats and the release.
 */
async function hold(fixture: OfflineFixture, keyCode: string, whilePressed: () => Promise<void>) {
  await sendKey(fixture, 'keyDown', keyCode);
  await whilePressed();
  for (let repeat = 0; repeat < 3; repeat++) await sendKey(fixture, 'keyDown', keyCode, ['isautorepeat']);
  await sendKey(fixture, 'keyUp', keyCode);
}
/** Electron's own mouse events at one point, `count` presses 120 ms apart, with the click counts macOS reports. */
async function nativeClickRun(fixture: OfflineFixture, x: number, y: number, count: number) {
  const send = (events: readonly Record<string, unknown>[]) => fixture.app.evaluate(({ BrowserWindow }, { url, events }) => {
    const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
    if (!contents) throw new Error('Game fixture window is missing');
    for (const event of events) contents.sendInputEvent(event as unknown as Electron.MouseInputEvent);
  }, { url: fixture.page.url(), events });
  await send([{ type: 'mouseMove', x, y }]);
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await send([{ type: 'mouseDown', x, y, button: 'left', clickCount }, { type: 'mouseUp', x, y, button: 'left', clickCount }]);
    if (clickCount < count) await fixture.page.waitForTimeout(120);
  }
}
/** Replaces the native Quit or Reload sheet with Cancel and records each message it would show. */
async function stubQuitOrReloadSheet(fixture: OfflineFixture) {
  await fixture.app.evaluate(({ dialog }) => {
    const record: string[] = [];
    (globalThis as DialogRecord).__hubContractDialogs = record;
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      // The sheet's Cancel button (cancelId 2).
      value: async (_window: unknown, options: { message?: string }) => { record.push(options.message ?? ''); return { response: 2, checkboxChecked: false }; },
    });
  });
  return {
    dialogs: () => fixture.app.evaluate(() => [...(globalThis as DialogRecord).__hubContractDialogs ?? []]),
    clear: () => fixture.app.evaluate(() => { (globalThis as DialogRecord).__hubContractDialogs?.splice(0); }),
  };
}
/** An outpost-ready Travel whose trips are recorded and arrive at once, so the next trip is not refused as in progress. */
async function installReadyTravel(page: Page) {
  await page.evaluate(async () => {
    const specifier = './travel-palette.js';
    const module = await import(specifier) as typeof import('../../src/renderer/travel-palette.js');
    const trips: number[] = [];
    (window as RecordingWindow).__hubContractTrips = trips;
    const ready = (mapId: number) => ({
      status: 'ready', mapId, travelContext: 'world', characterKey: null, guildHall: false, hasGuildHall: false, explorable: false,
      unlockedMapWords: Array.from({ length: 28 }, () => 0xffff_ffff),
    } as const);
    const palette = module.createTravelPalette(document.body, {
      travel: request => { trips.push(request.mapId); setTimeout(() => palette.update(ready(request.mapId)), 0); },
      guildHall: () => undefined, guildHallUnavailable: () => null, unavailable: () => null,
    });
    palette.setEnabled(true);
    // Beacon's Perch: neither Kamadan nor favourite 1 (Ascalon City), so both are trips.
    palette.update(ready(133));
  });
}
const trips = (page: Page) => page.evaluate(() => [...(window as RecordingWindow).__hubContractTrips ?? []]);

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
    // The Build Library loads after launch, and until then Command-B honestly refuses with
    // "Build Library is loading". Wait until the Hub offers it, so the race cannot decide the case.
    await searchOf(page).fill('build library');
    await expect(hub.locator('.hub-row[data-id="builds"]')).toHaveAttribute('aria-disabled', 'false');
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
    const { page } = fixture;
    const { dialogs } = await stubQuitOrReloadSheet(fixture);
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

const openWindows = (fixture: OfflineFixture) => fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => !win.isDestroyed()).length);

// HUB-001: the Hub row promises this sheet, so it opens it and never quits directly.
test('the Hub "Quit or Reload Game…" row opens the same native sheet and quits nothing', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const { dialogs } = await stubQuitOrReloadSheet(fixture);
    await chord(fixture, 'R', ['meta']);
    await expect(hubOf(page)).toBeVisible();
    await searchOf(page).fill('reload');
    await clearCanvasKeys(page);
    await page.keyboard.press('Enter');
    await expect.poll(dialogs).toEqual(['Quit or reload Guild Wars?']);
    await expect(hubOf(page)).toBeHidden();
    expect(await openWindows(fixture)).toBeGreaterThan(0);
    expect(page.isClosed()).toBe(false);
    expect(await canvasKeysFor(page, 'Enter')).toEqual([]);
  } finally { await closeOffline(fixture); }
});

// PTR-28 (HUB-001, HUB-242): a human double-click on the row or on the footer
// primary, or one click on the row, asks for the sheet once. The Hub closes on
// the first click, so the second lands on the game canvas and must stay there.
test('clicks on the "Quit or Reload Game…" row or its footer primary show the sheet once and quit nothing', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    const sheet = await stubQuitOrReloadSheet(fixture);
    const centre = async (locator: import('@playwright/test').Locator) => {
      const box = (await locator.boundingBox())!;
      return [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] as const;
    };
    const cases: [string, number, () => import('@playwright/test').Locator][] = [
      ['row double-click', 2, () => hub.locator('.hub-row', { hasText: 'Quit or Reload Game' }).first()],
      ['row click', 1, () => hub.locator('.hub-row', { hasText: 'Quit or Reload Game' }).first()],
      ['footer double-click', 2, () => hub.locator('.hub-primary')],
    ];
    for (const [name, count, target] of cases) {
      await chord(fixture, 'R', ['meta']);
      await expect(hub).toBeVisible();
      await searchOf(page).fill('reload');
      await expect(hub.locator('.hub-primary'), name).toContainText('Review options');
      const [x, y] = await centre(target());
      await sheet.clear();
      await page.evaluate(() => { (window as RecordingWindow).__hubContractPointer?.splice(0); });
      await nativeClickRun(fixture, x, y, count);
      await expect(hub, name).toBeHidden();
      await expect.poll(sheet.dialogs, { message: name }).toEqual(['Quit or reload Guild Wars?']);
      // Past the double-click interval, so a second request or a trailing click would have arrived.
      await page.waitForTimeout(800);
      expect(await sheet.dialogs(), name).toEqual(['Quit or reload Guild Wars?']);
      expect(await canvasPointer(page), name).toEqual([]);
      expect(await openWindows(fixture), name).toBeGreaterThan(0);
      expect(page.isClosed(), name).toBe(false);
      expect(await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.id, [x, y]), name).toBe('canvas');
    }
  } finally { await closeOffline(fixture); }
});

test('Shift-Tab moves focus inside the open Hub and never reaches the game', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await expect(searchOf(page)).toBeFocused();
    await clearCanvasKeys(page);
    await chord(fixture, 'Tab', ['shift']);
    await expect(searchOf(page)).not.toBeFocused();
    expect(await page.evaluate(() => document.getElementById('hub')?.contains(document.activeElement) ?? false)).toBe(true);
    expect(await canvasKeysFor(page, 'Tab')).toEqual([]);
  } finally { await closeOffline(fixture); }
});

// HUB-003: a press the Hub owns keeps its key-up and repeats out of the game.
test('the Escape that closes the Hub never reaches the game, held or tapped', async () => {
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

// KEY-23 (HUB-003): Command-Backspace is the game's while the Hub is closed. In the Hub
// it is Back, one level per physical press, and neither its repeats nor its release
// reach the game; a later key does.
test('Command-Backspace reaches chat unchanged with the Hub closed, and a held one in the Hub goes back one level only', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    const caption = hub.locator('.hub-caption');
    // (a) The Hub is closed and the game's chat field has text.
    await page.evaluate(() => {
      const field = document.getElementById('osk-input-text');
      if (!(field instanceof HTMLInputElement)) throw new Error('#osk-input-text is missing');
      const chat: string[] = [];
      Object.assign(window, { __hubContractChat: chat });
      for (const type of ['keydown', 'keyup'] as const) {
        field.addEventListener(type, event => { chat.push(`${type}:${event.code}${event.metaKey ? ':meta' : ''}${event.repeat ? ':repeat' : ''}`); });
      }
      field.value = 'hello there';
      field.focus();
      (window.Module as { oskActiveInput?: Element | null }).oskActiveInput = field;
    });
    const chat = () => page.evaluate(() => [...(window as typeof window & { __hubContractChat: string[] }).__hubContractChat]);
    await chord(fixture, 'Backspace', ['meta']);
    await expect.poll(chat).toEqual(['keydown:Backspace:meta', 'keyup:Backspace:meta']);
    await expect(hub).toBeHidden();
    // (b) Home › Commands, then Command-Backspace held with five auto-repeats.
    await page.evaluate(() => document.getElementById('canvas')?.focus());
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await searchOf(page).fill('commands');
    await expect(hub.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'commands');
    await page.keyboard.press('Enter');
    await expect(caption).toHaveText('Commands');
    await clearCanvasKeys(page);
    await sendKey(fixture, 'keyDown', 'Backspace', ['meta']);
    await expect(caption).toHaveText('Home');
    for (let repeat = 0; repeat < 5; repeat++) await sendKey(fixture, 'keyDown', 'Backspace', ['meta', 'isautorepeat']);
    await sendKey(fixture, 'keyUp', 'Backspace', ['meta']);
    await page.waitForTimeout(200);
    await expect(hub).toBeVisible();
    await expect(caption).toHaveText('Home');
    await expect(searchOf(page)).toHaveValue('commands');
    await expect(searchOf(page)).toBeFocused();
    expect(await canvasKeys(page)).toEqual([]);
    // (c) After the Hub closes, a fresh W and a fresh Backspace belong to the game again.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(hub).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
    await clearCanvasKeys(page);
    await page.keyboard.press('w');
    await page.keyboard.press('Backspace');
    expect(await canvasKeys(page)).toEqual(['keydown:KeyW', 'keyup:KeyW', 'keydown:Backspace', 'keyup:Backspace']);
  } finally { await closeOffline(fixture); }
});

// CALC-33 (HUB-003, HUB-048): a held Backspace in search only deletes text, well past an empty query.
test('a held Backspace on a calculator query empties it and never reaches the game', async () => {
  const fixture = await launch();
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await searchOf(page).fill('10 ectos in p');
    await clearCanvasKeys(page);
    // About three seconds of auto-repeat: 13 characters, then some 80 repeats on an empty query.
    await sendKey(fixture, 'keyDown', 'Backspace');
    for (let repeat = 0; repeat < 90; repeat++) await sendKey(fixture, 'keyDown', 'Backspace', ['isautorepeat']);
    await sendKey(fixture, 'keyUp', 'Backspace');
    await expect(searchOf(page)).toHaveValue('');
    await page.waitForTimeout(200);
    await expect(hub).toBeVisible();
    await expect(hub.locator('.hub-caption')).toHaveText('Home');
    await expect(searchOf(page)).toBeFocused();
    expect(await canvasKeys(page)).toEqual([]);
  } finally { await closeOffline(fixture); }
});

// HUB-003: Escape that a view answers itself (Travel clearing its query) is never claimed
// by the surface controller, so its repeats and release rest on the owned press alone.
test('a held Escape that Travel answers, then the one that closes the Hub, never reach the game', async () => {
  const fixture = await launch({ travelPalette: true });
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    await installReadyTravel(page);
    await page.evaluate(() => document.getElementById('canvas')?.focus());
    await chord(fixture, 'T', ['meta']);
    await expect(hub.locator('.hub-caption')).toHaveText('Travel');
    const travel = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
    await expect.poll(() => isDomActiveElement(travel)).toBe(true);
    await page.keyboard.type('kam');
    await expect(travel).toHaveValue('kam');
    await clearCanvasKeys(page);
    // The first held Escape clears Travel's query and takes one step only.
    await hold(fixture, 'Escape', () => expect(travel).toHaveValue(''));
    await page.waitForTimeout(200);
    await expect(hub).toBeVisible();
    await expect(hub.locator('.hub-caption')).toHaveText('Travel');
    expect(await canvasKeys(page)).toEqual([]);
    // The next closes the Hub (Travel opened directly, D-4); the game has focus before its repeats and release.
    await hold(fixture, 'Escape', async () => {
      await expect(hub).toBeHidden();
      await expect.poll(() => isDomActiveElement(page.locator('#canvas'))).toBe(true);
    });
    await page.waitForTimeout(200);
    expect(await canvasKeys(page)).toEqual([]);
    expect(await trips(page)).toEqual([]);
    await page.keyboard.press('w');
    expect(await canvasKeys(page)).toEqual(['keydown:KeyW', 'keyup:KeyW']);
  } finally { await closeOffline(fixture); }
});

// KEY-33, TRV-10 (HUB-003): Enter held through a trip, with native auto-repeat.
// The trip closes the Hub while Enter is down; its repeats and release then
// land on the game canvas and belong to the press the Hub owned.
test('a held Enter that travels runs one trip and never reaches the game, while a chat Enter keeps its release', async () => {
  const fixture = await launch({ travelPalette: true });
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    const canvas = page.locator('#canvas');
    await installReadyTravel(page);
    const closedOnCanvas = async () => {
      await expect(hub).toBeHidden();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);
    };
    // (a) Command-R, `travel kam`, hold Enter.
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await searchOf(page).fill('travel kam');
    await expect(hub.locator('.hub-primary')).toContainText('Travel to Kamadan');
    await clearCanvasKeys(page);
    await hold(fixture, 'Enter', closedOnCanvas);
    await page.waitForTimeout(300);
    expect(await trips(page)).toEqual([449]);
    expect(await canvasKeys(page)).toEqual([]);
    // (b) Command-T, favourite 1 selects, hold Enter.
    await chord(fixture, 'T', ['meta']);
    await expect(hub.locator('.hub-caption')).toHaveText('Travel');
    await chord(fixture, '1');
    expect(await trips(page)).toEqual([449]);
    await hold(fixture, 'Enter', closedOnCanvas);
    await page.waitForTimeout(300);
    expect(await trips(page)).toEqual([449, 81]);
    expect(await canvasKeys(page)).toEqual([]);
    // A fresh key after the release belongs to the game.
    await page.keyboard.press('w');
    expect(await canvasKeys(page)).toEqual(['keydown:KeyW', 'keyup:KeyW']);
    // A press that began in the game's chat proxy is the game's own: its release is delivered.
    await page.evaluate(() => {
      const field = document.getElementById('osk-input-text');
      if (!(field instanceof HTMLInputElement)) throw new Error('#osk-input-text is missing');
      const chat: string[] = [];
      Object.assign(window, { __hubContractChat: chat });
      for (const type of ['keydown', 'keyup'] as const) {
        field.addEventListener(type, event => { chat.push(`${type}:${event.code}${event.repeat ? ':repeat' : ''}`); });
      }
      field.focus();
      (window.Module as { oskActiveInput?: Element | null }).oskActiveInput = field;
    });
    await hold(fixture, 'Enter', async () => {});
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __hubContractChat: string[] }).__hubContractChat))
      .toContain('keyup:Enter');
    expect(await trips(page)).toEqual([449, 81]);
  } finally { await closeOffline(fixture); }
});

// KEY-33 (d), TRV-22 (HUB-003): at character selection input.ts buffers the
// first fresh canvas Enter and sends it again ~180 ms later. A held Enter the
// Hub owned must reach the canvas neither as a repeat nor as that synthetic
// Enter; a fresh physical Enter is still buffered exactly once.
test('a held Enter at character selection never becomes a fresh Enter', async () => {
  const fixture = await launch({ characterSwitchEnabled: true, xunlaiStorage: true });
  try {
    const { page } = fixture;
    const hub = hubOf(page);
    const canvas = page.locator('#canvas');
    await page.evaluate(() => {
      const characters = ['Fixture Monk', 'Toefte'].map((name, index) => ({
        name, characterKey: (index + 1).toString(16).padStart(16, '0'), primaryProfession: 3, secondaryProfession: 0,
        characterType: 'roleplaying' as const, campaign: 1, level: 20, mapId: 55,
      }));
      const requests: string[] = [];
      const listeners = new Set<() => void>();
      let switching = false;
      Object.assign(window, { __hubContractSwitches: requests });
      window.gwCharacterSwitchHost?.attach({
        characters: { status: 'ready', sequence: 1, selectedIndex: 0, characters },
        get action() { return switching ? ({ status: 'switching', stage: 'logout' } as const) : ({ status: 'idle' } as const); },
        context: 'outpost',
        request(characterKey) {
          requests.push(characterKey);
          switching = true;
          for (const listener of listeners) listener();
        },
        confirm() {}, cancelConfirmation() {}, reset() {},
        diagnostics: () => ({ version: 1, stage: 'unavailable', lastCode: 'play-path-unproved' }),
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      });
    });
    const switches = () => page.evaluate(() => [...(window as typeof window & { __hubContractSwitches: string[] }).__hubContractSwitches]);
    // The account token request is production's signal that character selection is next (8 s window).
    const expectCharacterSelection = () => page.evaluate(() => { new XMLHttpRequest().open('POST', '/webgate/my_account/token.xml'); });
    const closedOnCanvas = async () => {
      await expect(hub).toBeHidden();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);
    };
    const enterReached = async () => (await canvasKeys(page)).filter(key => key.includes(':Enter'));

    // Command-E, move to the other card, hold Enter: the switch closes the Hub while Enter is down.
    // A card is a button, which Enter activates through the keypress of a key-down that
    // carries text. sendInputEvent's key-down carries none, so this press and its
    // auto-repeats go through Chromium's DevTools input instead.
    await expectCharacterSelection();
    await chord(fixture, 'E', ['meta']);
    await expect(hub).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await clearCanvasKeys(page);
    await page.keyboard.down('Enter');
    await closedOnCanvas();
    for (let repeat = 0; repeat < 3; repeat++) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    // Longer than the buffered Enter's delay.
    await page.waitForTimeout(420);
    expect(await switches()).toEqual(['0000000000000002']);
    expect(await enterReached()).toEqual([]);

    // `storage` on Home, hold Enter.
    await chord(fixture, 'R', ['meta']);
    await expect(hub).toBeVisible();
    await searchOf(page).fill('storage');
    await expect(hub.locator('.hub-primary')).toContainText('Xunlai Storage');
    await expectCharacterSelection();
    await clearCanvasKeys(page);
    await hold(fixture, 'Enter', () => expect(hub).toBeHidden());
    await page.waitForTimeout(420);
    expect(await enterReached()).toEqual([]);

    // A fresh physical Enter on the canvas inside the window is still buffered, once.
    await page.evaluate(() => document.getElementById('canvas')?.focus());
    await page.keyboard.press('Enter');
    await expect.poll(enterReached).toEqual(['keydown:Enter:synthetic', 'keyup:Enter:synthetic']);
    await page.waitForTimeout(420);
    expect(await enterReached()).toEqual(['keydown:Enter:synthetic', 'keyup:Enter:synthetic']);
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

// D-12 (KEY-35): never claim Tab while the game canvas has focus, even with a popout open.
test('Trade focuses search on its shortcut, keeps slash inside its controls, and leaves game chat and Tab with the canvas', async () => {
  const fixture = await launch({ tradeChat: true });
  try {
    const { page } = fixture;
    const trade = page.locator('#toolbox-trade .trade-window');
    await chord(fixture, 'K', ['meta']);
    await expect(trade).toBeVisible();
    const search = trade.getByRole('searchbox', { name: 'Search offers or character names' });
    await expect(search).toBeFocused();
    await trade.getByRole('button', { name: /Saved 0/u }).focus();
    await clearCanvasKeys(page);
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    expect(await canvasKeysFor(page, 'Slash')).toEqual([]);
    await page.evaluate(() => document.getElementById('canvas')?.focus());
    await clearCanvasKeys(page);
    await page.keyboard.press('/');
    await page.keyboard.type('w1');
    expect(await canvasKeysFor(page, 'Slash')).toEqual(['keydown:Slash', 'keyup:Slash']);
    expect(await isDomActiveElement(page.locator('#canvas'))).toBe(true);
    await expect(search).toHaveValue('');
    await clearCanvasKeys(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    expect(await canvasKeys(page)).toEqual(['keydown:Tab', 'keyup:Tab', 'keydown:Space', 'keyup:Space']);
    expect(await isDomActiveElement(page.locator('#canvas'))).toBe(true);
    await expect(trade).toBeVisible();
  } finally { await closeOffline(fixture); }
});
