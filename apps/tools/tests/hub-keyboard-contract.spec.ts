import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The keyboard contract as a golden matrix: every key in every view, each cell
 * in a fresh browser context. The golden table records what the Hub does today,
 * so any behaviour change shows up as a reviewed table diff. A branch that
 * changes keyboard behaviour regenerates the table and commits the diff:
 *
 *   KEYBOARD_GOLDEN=update npx playwright test -c <config> hub-keyboard-contract
 *
 * One cell reads: surface (Hub caption, popout or `closed`), focus, selected
 * row, search query, the last recorded game action (trips record `TRAVEL <place>`),
 * the game lifecycle afterwards, and the key-downs, key-ups and pointer events
 * that reached the game canvas during the press. A key-up that leaks after the
 * Hub closes (the owned-press rule, HUB-003) therefore changes the table.
 */
const GOLDEN = new URL('./keyboard-contract.golden.json', import.meta.url);
const updating = process.env.KEYBOARD_GOLDEN === 'update';
const golden: Record<string, Record<string, string>> = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const observed: Record<string, Record<string, string>> = {};

const searchName = 'Search people, places, builds';
const enterHub = async (page: Page, query: string) => {
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill(query); await search.press('Enter');
};
const VIEWS: Record<string, { query?: string; open(page: Page): Promise<void> }> = {
  'closed': { open: page => page.keyboard.press('Escape') },
  'home': { open: async () => {} },
  'home-query': { open: page => page.getByRole('combobox', { name: searchName }).fill('kam') },
  'home-row': { open: async page => { await page.getByRole('combobox', { name: searchName }).fill('sw'); await page.keyboard.press('ArrowDown'); } },
  'explorable-home': { query: '&lifecycle=pve-explorable', open: async () => {} },
  'travel': { open: page => page.keyboard.press('Meta+t') },
  'characters': { open: page => page.keyboard.press('Meta+e') },
  'build-library': { open: page => page.keyboard.press('Meta+b') },
  'build-page': { open: page => enterHub(page, 'build smiter') },
  'person': { open: page => enterHub(page, 'romi') },
  'accounts': { open: async page => { await page.getByRole('combobox', { name: searchName }).fill('switch account'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); } },
  'settings': { open: page => enterHub(page, 'settings') },
  'calculator': { open: page => page.getByRole('combobox', { name: searchName }).fill('10 ecto in p') },
  'trade': { open: async page => { await page.keyboard.press('Escape'); await page.keyboard.press('Meta+k'); } },
  'whispers': { open: page => page.keyboard.press('Meta+d') },
};
const KEYS = ['a', '1', 'Enter', 'Escape', 'Backspace', 'Meta+Backspace', 'ArrowDown', 'ArrowUp', 'Tab', 'Shift+Tab',
  'Home', 'End', 'PageDown', 'Control+n', 'Meta+Enter', 'Meta+j', 'Meta+r'];

/** Two animation frames and the demo hosts' 600 ms travel or apply delays. */
const settle = (page: Page) => page.waitForTimeout(700);

const observe = (page: Page) => page.evaluate(() => {
  const hub = document.getElementById('hub');
  const open = hub instanceof HTMLDialogElement && hub.open;
  const visible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].some(element => element.getClientRects().length > 0);
  const surface = open ? document.querySelector('.hub-caption')?.textContent ?? 'Hub'
    : visible('#toolbox-trade .trade-window') ? 'trade' : visible('#whisper-window') ? 'whispers'
      : document.querySelector('.hub-fixture-quit') ? 'quit' : 'closed';
  const active = document.activeElement;
  const focus = !active || active === document.body ? 'body'
    : active.id === 'canvas' ? 'canvas'
      : active.closest('.hub-row') ? `row:${active.closest<HTMLElement>('.hub-row')!.dataset.id}`
        : active.getAttribute('role') === 'combobox' && hub?.contains(active) ? 'search'
          : active instanceof HTMLElement && active.dataset.characterKey ? `card:${active.dataset.characterKey}`
            : `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}${active.getAttribute('aria-label') ? `[${active.getAttribute('aria-label')}]` : active.classList[0] ? `.${active.classList[0]}` : ''}`;
  const selected = open ? document.querySelector<HTMLElement>('#hub .hub-row[aria-selected="true"]')?.dataset.id ?? '-' : '-';
  const query = open ? document.querySelector<HTMLInputElement>('#hub [role="combobox"]')?.value ?? '' : '';
  const action = document.getElementById('app')?.dataset.action ?? '-';
  const events = window.gwFixtureCanvas?.events ?? [];
  const reached = (types: readonly string[]) => events.filter(event => types.includes(event.type)).length;
  const canvas = `down ${reached(['keydown'])} up ${reached(['keyup'])} pointer ${reached(['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'])}`;
  const life = document.querySelector<HTMLSelectElement>('select[aria-label="Lifecycle state"]')?.value ?? '-';
  // Account profile ids stay out of the repository (forbidden-artifacts policy).
  return `${surface} | focus ${focus} | sel ${selected} | q "${query}" | action ${action} | life ${life} | canvas ${canvas}`
    .replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/giu, '<profile>');
});

test.describe('keyboard contract', () => {
  if (updating) {
    // One worker merges the whole table once.
    test.describe.configure({ mode: 'serial' });
    test.afterAll(() => {
      for (const [view, keys] of Object.entries(observed)) golden[view] = { ...golden[view], ...keys };
      writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 2)}\n`);
    });
  }
  for (const [view, setup] of Object.entries(VIEWS)) {
    for (const key of KEYS) {
      test(`${view} × ${key}`, async ({ page }) => {
        await page.goto(`/?hub${setup.query ?? ''}`);
        await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
        await setup.open(page);
        await settle(page);
        await page.evaluate(() => window.gwFixtureCanvas?.clear());
        await page.keyboard.press(key);
        await settle(page);
        const cell = await observe(page);
        if (updating) { (observed[view] ??= {})[key] = cell; return; }
        expect(cell, `Regenerate keyboard-contract.golden.json with KEYBOARD_GOLDEN=update when ${view} × ${key} changes on purpose`).toBe(golden[view]?.[key]);
      });
    }
  }
});

test.describe('owned press (HUB-003)', () => {
  const canvasKeys = (page: Page) => page.evaluate(() => (window.gwFixtureCanvas?.events ?? []).map(event => `${event.type}:${event.code}${event.repeat ? ':repeat' : ''}`));
  /** Holds a key long enough for three repeats after the press that closes the Hub. */
  const hold = async (page: Page, key: string, repeats = 3) => {
    await page.evaluate(() => window.gwFixtureCanvas?.clear());
    for (let press = 0; press <= repeats; press++) await page.keyboard.down(key);
    await page.keyboard.up(key);
    await settle(page);
    return canvasKeys(page);
  };
  const search = (page: Page) => page.getByRole('combobox', { name: searchName });
  const open = async (page: Page, query = '') => {
    await page.goto(`/?hub${query}`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await expect(search(page)).toBeFocused();
  };

  test('a held Escape that closes the Hub never reaches the game', async ({ page }) => {
    await open(page);
    expect(await hold(page, 'Escape')).toEqual([]);
    await expect(page.locator('#hub')).toBeHidden();
  });

  test('the Enter that invites and closes the Hub keeps its release, and the next key reaches the game', async ({ page }) => {
    await open(page, '&party');
    await search(page).fill('invite Romi Ranger');
    expect(await hold(page, 'Enter', 0)).toEqual([]);
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'PARTY.INVITE Romi Ranger');
    await expect(page.locator('#canvas')).toBeFocused();
    await page.evaluate(() => window.gwFixtureCanvas?.clear());
    await page.keyboard.press('w');
    expect(await canvasKeys(page)).toEqual(['keydown:KeyW', 'keyup:KeyW']);
  });

  test('the Enter that hands a person to Whispers never reaches the game, held or tapped', async ({ page }) => {
    for (const repeats of [0, 3]) {
      await open(page);
      await enterHub(page, 'romi');
      await expect(page.locator('.hub-caption')).toHaveText('Romi Ranger');
      expect(await hold(page, 'Enter', repeats)).toEqual([]);
      await expect(page.locator('#whisper-window')).toBeVisible();
    }
  });
});
