import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The pointer contract (HUB-242, HUB-244, HUB-248, D-24). Every double-click is
 * a human one: two presses at one point, click count 1 then 2, with a gap. A
 * row that changes the game or the account selects on a click and runs on the
 * footer primary or its own double-click; a navigational row opens at once and
 * the rest of the click run dies with the page it started on. Trailing clicks
 * of a run that closed the Hub never reach the game canvas.
 */
const GAPS = [0, 120, 450] as const;

async function open(page: Page, query = '') {
  await page.goto(`/?hub${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  // Every game action in order, including repeats of the same action.
  await page.evaluate(() => {
    const app = document.getElementById('app')!;
    const ledger: string[] = [];
    Object.assign(window, { ledger });
    new MutationObserver(records => {
      records.forEach((record, index) => {
        const value = index + 1 < records.length ? records[index + 1]!.oldValue : app.dataset.action;
        if (value) ledger.push(value);
      });
    }).observe(app, { attributes: true, attributeFilter: ['data-action'], attributeOldValue: true });
    window.gwFixtureCanvas?.clear();
  });
}
const ledger = (page: Page) => page.evaluate(() => (window as unknown as { ledger: string[] }).ledger);
const canvas = (page: Page) => page.evaluate(() => window.gwFixtureCanvas?.events.filter(event => event.type !== 'keyup' || event.code).map(event => `${event.type}:${event.code ?? event.detail}`) ?? []);
const search = (page: Page) => page.locator('.hub-search input');
const row = (page: Page, text: string | RegExp) => page.locator('#hub .hub-row', { hasText: text }).first();
const primary = (page: Page) => page.locator('.hub-primary');
const caption = (page: Page) => page.locator('.hub-caption');
async function enter(page: Page, query: string) { await search(page).fill(query); await search(page).press('Enter'); }

/** Presses one point `count` times with the click counts macOS reports, like a person. */
async function clicks(page: Page, target: Locator, count: number, gap = 120, at?: { x: number; y: number }) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + (at?.x ?? box.width / 2), box.y + (at?.y ?? box.height / 2));
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await page.mouse.down({ clickCount }); await page.mouse.up({ clickCount });
    if (clickCount < count && gap) await page.waitForTimeout(gap);
  }
  await page.waitForTimeout(600);
}

/** Rows whose primary changes the game or the account (D-24), opened on their own page. */
const consequential: Record<string, { query?: string; open(page: Page): Promise<Locator>; footer: RegExp; ran: string[] }> = {
  'Continue Eye of the North': { open: async page => row(page, 'Eye of the North'), footer: /^Travel to Eye of the North/, ran: ['TRAVEL Eye of the North'] },
  'Apply to me': { open: async page => { await enter(page, 'build smiter'); return page.getByRole('option', { name: /Apply to me/ }); }, footer: /^Apply Smiter to Fixture Monk/, ran: ['apply-build', 'command:1', 'command:2'] },
  'Open Second': { open: async page => { await enter(page, 'acc s'); return page.locator('.hub-row[data-id$=":open"]'); }, footer: /^Open Second/, ran: ['Account Second open'] },
  'Close Main and open Second': { open: async page => { await enter(page, 'acc s'); return row(page, 'Close Main and open Second'); }, footer: /^Close Main and open Second/, ran: [] },
  'character card': { open: async page => { await page.keyboard.press('Meta+e'); return page.locator('button[data-character-key="mesmer"]'); }, footer: /^Switch to Fixture Mesmer/, ran: ['Character mesmer'] },
  'Invite to party': { query: '&party', open: async page => { await enter(page, 'zed delta'); await expect(caption(page)).toHaveText('Zed Delta'); return row(page, 'Invite to party'); }, footer: /^Invite Zed Delta/, ran: ['PARTY.INVITE Zed Delta'] },
};

test.describe('a row that changes the game', () => {
  for (const [name, subject] of Object.entries(consequential)) {
    test(`${name}: a click selects and names the primary; it runs nothing`, async ({ page }) => {
      await open(page, subject.query);
      const target = await subject.open(page);
      await page.waitForTimeout(600);
      await clicks(page, target, 1);
      await expect(target).toHaveAttribute('aria-selected', 'true');
      await expect(name === 'character card' ? page.locator('#hub .hub-primary') : primary(page)).toHaveText(subject.footer);
      expect(await ledger(page)).toEqual([]);
      await expect(page.locator('#hub')).toBeVisible();
    });
    for (const gap of GAPS) {
      test(`${name}: a double-click (${gap} ms) runs it exactly once`, async ({ page }) => {
        await open(page, subject.query);
        const target = await subject.open(page);
        await page.waitForTimeout(600);
        await clicks(page, target, 2, gap);
        if (name === 'Close Main and open Second') {
          // Replacing the running game passes an armed confirmation first.
          await expect(caption(page)).toHaveText('Close Main?');
          expect(await ledger(page)).toEqual([]);
          return;
        }
        await expect.poll(() => ledger(page)).toEqual(subject.ran);
        expect(await canvas(page)).toEqual([]);
      });
    }
  }

  test('a triple-click on Apply to me applies once and nothing runs after it', async ({ page }) => {
    await open(page);
    await enter(page, 'build smiter');
    await clicks(page, page.getByRole('option', { name: /Apply to me/ }), 3);
    await expect.poll(() => ledger(page)).toEqual(['apply-build', 'command:1', 'command:2']);
    expect((await canvas(page)).filter(event => !/:(0|1)$/u.test(event))).toEqual([]);
  });

  test('a triple-click on a Travel recent travels once and runs no Home row after it', async ({ page }) => {
    await open(page);
    await search(page).press('ArrowDown');
    await row(page, /^Travel/).and(page.locator('[data-id="travel"]')).waitFor();
    while (await page.locator('.hub-row[aria-selected="true"]').getAttribute('data-id') !== 'travel') await search(page).press('ArrowDown');
    await search(page).press('Enter');
    await expect(caption(page)).toHaveText('Travel');
    await clicks(page, page.locator('.travel-recent').first(), 3);
    await expect.poll(() => ledger(page)).toEqual(['TRAVEL Kamadan, Jewel of Istan']);
    await expect(caption(page)).not.toHaveText(/Characters|Trade/);
    expect((await canvas(page)).filter(event => !/:(0|1)$/u.test(event))).toEqual([]);
  });

  test('a double-click whose second press lands on another row runs nothing', async ({ page }) => {
    await open(page);
    const kamadan = row(page, 'Kamadan');
    const kaineng = row(page, 'Kaineng Center');
    await clicks(page, kamadan, 1, 0);
    const box = (await kaineng.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
    await page.waitForTimeout(600);
    expect(await ledger(page)).toEqual([]);
    await expect(page.locator('#hub')).toBeVisible();
    const named = (await primary(page).textContent())!;
    const selected = (await page.locator('.hub-row[aria-selected="true"] .hub-title').textContent())!;
    expect(named).toContain(selected.split(',')[0]!);
  });

  test('pressing on one row and releasing on another activates neither', async ({ page }) => {
    await open(page);
    for (const [from, to] of [['Kamadan', 'Kaineng Center'], ['Settings', 'Show Launcher']] as const) {
      const start = row(page, from); await start.scrollIntoViewIfNeeded();
      const a = (await start.boundingBox())!;
      const b = (await row(page, to).boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      expect(await ledger(page)).toEqual([]);
      await expect(caption(page)).toHaveText('Home');
      await expect(search(page)).toBeFocused();
    }
  });
});

test.describe('a navigational row', () => {
  const navigational: Record<string, { query?: string; open(page: Page): Promise<Locator>; lands: string }> = {
    'Build Library': { open: async page => row(page, 'Build Library'), lands: 'Build Library' },
    'Settings': { open: async page => page.locator('.hub-row[data-id="settings"]'), lands: 'Settings' },
    'Commands': { open: async page => page.locator('.hub-row[data-id="commands"]'), lands: 'Commands' },
    'Travel': { open: async page => page.locator('.hub-row[data-id="travel"]'), lands: 'Travel' },
    'Smiter': { open: async page => { await search(page).fill('build mo'); return row(page, 'Smiter'); }, lands: 'Smiter' },
    'Second': { open: async page => { await search(page).fill('acc s'); return row(page, 'Second'); }, lands: 'Second' },
    'Zed Beta': { query: '&party', open: async page => { await search(page).fill('zed'); return row(page, 'Zed Beta'); }, lands: 'Zed Beta' },
    'Switch Character': { open: async page => { await search(page).fill('char'); return row(page, 'Switch Character'); }, lands: 'Characters' },
    'Apply to hero': { open: async page => { await enter(page, 'build smiter'); return row(page, 'Apply to hero'); }, lands: 'Heroes' },
  };
  for (const [name, subject] of Object.entries(navigational)) {
    for (const gap of [0, 120, 450]) {
      test(`${name}: a double-click (${gap} ms) opens exactly one level`, async ({ page }) => {
        await open(page, subject.query);
        const target = await subject.open(page);
        const crumbs = await page.locator('.hub-crumb').count();
        await clicks(page, target, 2, gap);
        await expect(caption(page)).toHaveText(subject.lands);
        await expect(page.locator('.hub-crumb')).toHaveCount(crumbs + 1);
        expect(await ledger(page)).toEqual([]);
        await expect(page.locator('#hub')).toBeVisible();
        const focus = await page.evaluate(() => document.activeElement?.tagName);
        expect(['BODY', 'DIALOG']).not.toContain(focus);
      });
    }
  }

  test('a single click opens a navigational row at once, with one level', async ({ page }) => {
    await open(page);
    await clicks(page, page.locator('.hub-row[data-id="settings"]'), 1);
    await expect(caption(page)).toHaveText('Settings');
    await expect(page.locator('.hub-crumb')).toHaveCount(1);
  });

  test('a double-click that opens Settings never toggles a setting', async ({ page }) => {
    await open(page);
    const settings = () => page.evaluate(() => JSON.stringify(window.gwToolsSettings?.()));
    const before = await settings();
    const target = page.locator('.hub-row[data-id="settings"]');
    for (const fraction of [0.25, 0.5, 0.9]) {
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      await clicks(page, target, 2, 120, { x: box.width * fraction, y: box.height / 2 });
      await expect(caption(page)).toHaveText('Settings');
      expect(await settings()).toBe(before);
      await page.getByRole('button', { name: 'Home', exact: true }).click();
    }
    await search(page).fill('settings');
    await clicks(page, page.locator('.hub-row').first(), 2);
    await expect(caption(page)).toHaveText('Settings');
    expect(await settings()).toBe(before);
    // A deliberate single click still toggles exactly once.
    await page.getByText('Whispers', { exact: true }).first().click();
    await expect.poll(settings).not.toBe(before);
  });

  test('a double-click on the footer primary never runs the next page\'s primary', async ({ page }) => {
    await open(page);
    await search(page).fill('build smiter');
    await expect(primary(page)).toHaveText(/^Choose target/);
    await clicks(page, primary(page), 2);
    await expect(caption(page)).toHaveText('Smiter');
    await expect(primary(page)).toHaveText(/^Apply Smiter to Fixture Monk/);
    await expect(primary(page)).toBeEnabled();
    await search(page).press('Meta+Backspace');
    await search(page).fill('team gom');
    await expect(primary(page)).toHaveText(/^Review GOM AFK/);
    await clicks(page, primary(page), 2);
    await expect(caption(page)).toHaveText('GOM AFK');
    // The review keeps the Hub footer: its named primary is Apply, enabled and not run. It opens
    // at its top with the page itself focused, not the Apply control (HUB-084).
    await expect(primary(page)).toHaveText('Apply team GOM AFK↵');
    await expect(primary(page)).toBeEnabled();
    await expect(page.locator('.hub-build-review')).toBeFocused();
    await expect(page.getByRole('heading', { name: 'GOM AFK', exact: true })).toBeInViewport();
    expect(await page.locator('.hub-view').evaluate(view => view.scrollTop)).toBe(0);
    expect(await ledger(page)).toEqual([]);
    await clicks(page, primary(page), 3);
    await expect.poll(() => ledger(page)).toEqual(expect.arrayContaining(['apply-team']));
    expect((await ledger(page)).filter(entry => entry === 'apply-team')).toHaveLength(1);
  });
});

test.describe('trailing clicks never reach the game', () => {
  const closing: Record<string, { query?: string; open(page: Page): Promise<Locator> }> = {
    'Continue row': { open: async page => row(page, 'Eye of the North') },
    'Close button': { open: async page => page.getByRole('button', { name: 'Close Hub', exact: true }) },
    'backdrop': { open: async page => page.locator('#hub') },
    'Xunlai Storage': { open: async page => { await search(page).fill('storage'); return row(page, 'Xunlai Storage'); } },
    'character card': { open: async page => { await page.keyboard.press('Meta+e'); return page.locator('button[data-character-key="mesmer"]'); } },
  };
  for (const [name, subject] of Object.entries(closing)) {
    test(`${name}: a closing double-click and triple-click leave the canvas untouched`, async ({ page }) => {
      await open(page, subject.query);
      const target = await subject.open(page);
      if (name === 'backdrop') {
        await page.mouse.move(20, 20);
        await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
        await page.waitForTimeout(120);
        await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
        await page.waitForTimeout(600);
      } else await clicks(page, target, name === 'Close button' ? 3 : 2);
      await expect(page.locator('#hub')).toBeHidden();
      expect(await canvas(page)).toEqual([]);
      // A fresh click a moment later reaches the game as one press.
      await page.waitForTimeout(400);
      await page.mouse.move(30, 300);
      await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
      await expect.poll(() => canvas(page)).toEqual(['pointerdown:0', 'mousedown:1', 'mouseup:1', 'click:1']);
    });
  }

  test('a player\'s slower Double-click speed still keeps the trailing press from the game', async ({ page }) => {
    // Main passes the macOS setting (Accessibility › Double-click speed); here it is 1.5 s.
    for (const gap of [700, 1200]) {
      await open(page, '&double-click-ms=1500');
      await clicks(page, page.getByRole('button', { name: 'Close Hub', exact: true }), 2, gap);
      await expect(page.locator('#hub')).toBeHidden();
      expect(await canvas(page), `${gap} ms`).toEqual([]);
    }
    // Past the player's interval, a press is a fresh one and reaches the game whole.
    await page.waitForTimeout(1000);
    await page.mouse.move(30, 300);
    await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
    await expect.poll(() => canvas(page)).toEqual(['pointerdown:0', 'mousedown:1', 'mouseup:1', 'click:1']);
  });

  // TRV-09 in the fixture: the Travel view is its own surface page, and its closing trip
  // keeps the whole run out of the game. The Electron playable client has no travel host.
  for (const gap of [120, 450]) {
    test(`Travel: a double-clicked recent (${gap} ms) travels once and leaves the game untouched`, async ({ page }) => {
      const kamadan = (view: Page) => view.locator('.travel-recent', { hasText: 'Kamadan' }).first();
      // Where a keyboard trip leaves focus is where the double-click must leave it too.
      await open(page);
      await page.keyboard.press('Meta+t');
      await expect(kamadan(page)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Enter');
      await expect(page.locator('#hub')).toBeHidden();
      const keyboardFocus = await page.evaluate(() => document.activeElement?.id);
      await open(page);
      await page.keyboard.press('Meta+t');
      await expect(caption(page)).toHaveText('Travel');
      await page.evaluate(() => window.gwFixtureCanvas?.clear());
      await clicks(page, kamadan(page), 2, gap);
      await expect(page.locator('#hub')).toBeHidden();
      expect(await ledger(page)).toEqual(['TRAVEL Kamadan, Jewel of Istan']);
      expect(await canvas(page)).toEqual([]);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(keyboardFocus);
      // A fresh click a second later reaches the game as one ordinary press.
      await page.waitForTimeout(1000);
      await page.mouse.move(30, 300);
      await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
      await expect.poll(() => canvas(page)).toEqual(['pointerdown:0', 'mousedown:1', 'mouseup:1', 'click:1']);
      expect(await ledger(page)).toEqual(['TRAVEL Kamadan, Jewel of Istan']);
    });
  }

  for (const [name, query, pick, destination] of [
    ['whisper romi', 'whisper romi', '', '#whisper-window'],
    ['Whispers tool', '', 'whispers', '#whisper-window'],
    ['trade arms', 'trade arms', '', '#toolbox-trade'],
    ['Trade Chat tool', '', 'trade', '#toolbox-trade'],
  ] as const) {
    test(`a double-clicked ${name} handoff keeps typing in its destination`, async ({ page }) => {
      await open(page);
      await search(page).fill(query);
      await clicks(page, pick ? page.locator(`#hub .hub-row[data-id="${pick}"]`) : page.locator('#hub .hub-row').first(), 2);
      await page.keyboard.type('w1 hi');
      const focused = await page.evaluate(selector => { const active = document.activeElement as HTMLInputElement | null; return { value: active?.value, inside: !!active?.closest(selector) }; }, destination);
      expect(focused).toEqual({ value: expect.stringContaining('w1 hi'), inside: true });
      expect(await canvas(page)).toEqual([]);
    });
  }
});

test('Travel: a click selects a destination and the footer travels once', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Meta+t');
  const kaineng = page.locator('.travel-recent', { hasText: 'Kaineng Center' });
  await clicks(page, kaineng, 1);
  await page.waitForTimeout(400);
  await expect(kaineng).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#hub .hub-primary')).toHaveText('Travel to Kaineng Center · Any district↵');
  await expect(page.locator('#travel-search-input')).toBeFocused();
  expect(await ledger(page)).toEqual([]);
  await page.locator('#hub .hub-primary').click();
  await expect.poll(() => ledger(page)).toEqual(['TRAVEL Kaineng Center']);
});

/** Moves the pointer in small steps like a hand, and returns the other options it crossed. */
async function glide(page: Page, from: Locator, to: Locator) {
  await page.evaluate(() => {
    const crossed = new Set<string>();
    Object.assign(window, { crossed });
    document.addEventListener('pointermove', event => {
      const option = (event.target as Element).closest('[role="option"]');
      if (option?.id) crossed.add(option.id);
    }, true);
  });
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  const origin = await from.getAttribute('id');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 24 });
  return (await page.evaluate(() => [...(window as unknown as { crossed: Set<string> }).crossed])).filter(id => id !== origin);
}

test.describe('a clicked row keeps the footer while the pointer crosses other rows to it (D-24)', () => {
  const subjects: Record<string, { open(page: Page): Promise<Locator>; footer: string; named: RegExp; ran: string[] }> = {
    'Home: Continue Eye of the North': { open: async page => row(page, 'Eye of the North'), footer: '.hub-primary', named: /^Travel to Eye of the North/, ran: ['TRAVEL Eye of the North'] },
    'Travel: Kaineng Center (TRV-07)': { open: async page => { await page.keyboard.press('Meta+t'); return page.locator('.travel-recent', { hasText: 'Kaineng Center' }); }, footer: '#hub .hub-primary', named: /^Travel to Kaineng Center · Any district/, ran: ['TRAVEL Kaineng Center'] },
    'build target: Apply to me (BLD-09)': { open: async page => { await enter(page, 'build smiter'); return page.getByRole('option', { name: /Apply to me/ }); }, footer: '.hub-primary', named: /^Apply Smiter to Fixture Monk/, ran: ['apply-build', 'command:1', 'command:2'] },
  };
  for (const [name, subject] of Object.entries(subjects)) {
    test(name, async ({ page }) => {
      await open(page);
      const target = await subject.open(page);
      await page.waitForTimeout(400);
      await clicks(page, target, 1);
      await expect(page.locator(subject.footer)).toHaveText(subject.named);
      const crossed = await glide(page, target, page.locator(subject.footer));
      // The path really crossed other rows, as a hand's path to the footer does.
      expect(crossed.length).toBeGreaterThan(0);
      await expect(target).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator(subject.footer)).toHaveText(subject.named);
      await page.mouse.down(); await page.mouse.up();
      await expect.poll(() => ledger(page)).toEqual(subject.ran);
    });
  }

  test('hover selects again once the pointer leaves the list or a key moves the selection', async ({ page }) => {
    await open(page);
    const eye = row(page, 'Eye of the North');
    await clicks(page, eye, 1);
    await glide(page, eye, primary(page));
    await expect(eye).toHaveAttribute('aria-selected', 'true');
    // Back in the list after leaving it, a real move selects the row under the pointer.
    const kaineng = row(page, 'Kaineng Center');
    const box = (await kaineng.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await expect(kaineng).toHaveAttribute('aria-selected', 'true');
    // A key moves the selection past a click's hold too.
    await clicks(page, kaineng, 1);
    await search(page).press('ArrowDown');
    await expect(kaineng).toHaveAttribute('aria-selected', 'false');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 2);
    await expect(kaineng).toHaveAttribute('aria-selected', 'true');
    expect(await ledger(page)).toEqual([]);
  });
});

test('Travel: a view that opens under a resting pointer keeps its selection (HUB-012)', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Meta+t');
  const favourite = page.locator('#travel-favorite-0');
  const box = (await favourite.boundingBox())!;
  await page.keyboard.press('Meta+Backspace');
  await expect(caption(page)).toHaveText('Home');
  // The pointer rests where the favourite will appear; Travel opens under it by keyboard and by a click.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Meta+t');
  await page.waitForTimeout(400);
  await expect(page.locator('#travel-recent-449')).toHaveAttribute('aria-selected', 'true');
  await expect(favourite).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#hub .hub-primary')).toHaveText(/^Travel to Kamadan/);
  // A wheel under the still pointer leaves it too; only a real move selects.
  await page.mouse.wheel(0, 30);
  await page.waitForTimeout(200);
  await expect(page.locator('#travel-recent-449')).toHaveAttribute('aria-selected', 'true');
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2);
  await expect(favourite).toHaveAttribute('aria-selected', 'true');
  // The outpost the player stands in (Lion's Arch) is no trip: hover, its digit and Enter pass it by.
  const current = page.locator('#travel-favorite-1');
  await expect(current).toBeDisabled();
  const here = (await current.boundingBox())!;
  await page.mouse.move(here.x + here.width / 2, here.y + here.height / 2, { steps: 3 });
  await expect(current).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('2');
  await expect(page.locator('#hub .travel-palette')).toContainText('You are already in Lion\'s Arch.');
  expect(await ledger(page)).toEqual([]);
});

test('Characters: rapid clicks on an unchanged page still count', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Meta+e');
  await expect(page.locator('button[data-character-key="monk"]')).toHaveAttribute('aria-selected', 'true');
  await clicks(page, page.getByRole('button', { name: 'Next character' }), 2);
  await expect(page.locator('button[data-character-key="mesmer"]')).toHaveAttribute('aria-selected', 'true');
  expect(await ledger(page)).toEqual([]);
});

test('Characters: a double-click that raises Leave this area? never confirms it', async ({ page }) => {
  for (const count of [2, 3]) {
    await open(page, '&lifecycle=pve-explorable');
    await page.keyboard.press('Meta+e');
    await page.keyboard.press('End');
    await clicks(page, page.locator('button[data-character-key="toefte"]'), count, 120, { x: 60, y: 12 });
    await expect(page.locator('#character-switch-title')).toHaveText('Leave this area and switch to Toefte?');
    const leave = page.getByRole('button', { name: 'Leave and switch to Toefte', exact: true });
    await expect(leave).toBeVisible();
    expect(await ledger(page)).toEqual([]);
    await expect(leave).toHaveAttribute('data-armed', '');
    await leave.click();
    await expect.poll(() => ledger(page)).toEqual(['Character toefte']);
  }
});

test('Accounts: keeping the running game open is the default; a replace needs one deliberate armed confirmation', async ({ page }) => {
  await open(page);
  await search(page).fill('acc second');
  // D-23: Open Second is row 0 and selected; the replace is second and reads as destructive.
  await expect(page.locator('.hub-row').nth(0)).toHaveAttribute('data-id', /:open$/);
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Open Second');
  await expect(primary(page)).toHaveText(/^Open Second/);
  await expect(page.locator('.hub-row[data-destructive="true"]')).toContainText('Close Main and open Second');
  await search(page).press('ArrowDown');
  await expect(primary(page)).toHaveText(/^Close Main and open Second/);
  await expect(primary(page)).toHaveAttribute('data-variant', 'danger');
  await search(page).press('Enter');
  await expect(caption(page)).toHaveText('Close Main?');
  // The confirmation keeps the Hub footer: the armed destructive primary names it, Keep Main is the secondary.
  const confirm = primary(page);
  await expect(confirm).toHaveText(/^Close Main and open Second/);
  await expect(confirm).toHaveAttribute('data-variant', 'danger');
  await expect(page.locator('.hub-actions')).toHaveText('Keep Main');
  await expect(page.locator('.hub-legend')).toContainText('Back');
  await expect(page.locator('.hub-confirm')).toBeFocused();
  // An Enter or a multi-click before it arms confirms nothing.
  await page.keyboard.press('Enter');
  expect(await ledger(page)).toEqual([]);
  await expect(confirm).toHaveAttribute('data-armed', '');
  await clicks(page, confirm, 2, 0);
  expect(await ledger(page)).toEqual(['Account Second replace']);
  // Back cancels it.
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await search(page).fill('acc second'); await search(page).press('ArrowDown'); await search(page).press('Enter');
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Close Main and open Second');
  expect(await ledger(page)).toEqual(['Account Second replace']);
});

test('Accounts: a double-click on an account opens its page on Open Second and runs nothing (PPL-35)', async ({ page }) => {
  for (const gap of GAPS) {
    await open(page);
    await enter(page, 'switch account');
    await expect(caption(page)).toHaveText('Accounts');
    await clicks(page, row(page, /^Second/), 2, gap);
    await expect(caption(page)).toHaveText('Second');
    await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', /:open$/);
    await expect(primary(page)).toHaveText(/^Open Second/);
    expect(await ledger(page)).toEqual([]);
    expect(await canvas(page)).toEqual([]);
  }
});

test('Hub preferences: Move up keeps focus and a double-click moves the same pin twice (PTR-12)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => localStorage.setItem('hub-fixture-shortcuts', JSON.stringify(['place:449', 'place:194', 'place:642'].map(id => ({ id, phrase: '', pinned: true })))));
  await open(page);
  const saved = () => page.evaluate(() => (JSON.parse(localStorage.getItem('hub-fixture-shortcuts') ?? '[]') as { id: string }[]).map(entry => entry.id));
  await enter(page, 'hub preferences');
  const list = page.getByRole('listbox', { name: 'Pins and search phrases' });
  const options = list.getByRole('option');
  await expect(options).toHaveText([/^Kamadan/, /^Kaineng Center/, /^Eye of the North/]);
  // The list takes focus, never a Remove button; the footer names what Enter does.
  await expect(list).toBeFocused();
  await expect(primary(page)).toHaveText(/^Set phrase for Kamadan/);
  await options.nth(2).click();
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
  const up = page.getByRole('button', { name: 'Move up', exact: true });
  for (const gap of [0, 120]) {
    await clicks(page, up, 2, gap);
    await expect(options).toHaveText([/^Eye of the North/, /^Kamadan/, /^Kaineng Center/]);
    await expect(up).toBeFocused();
    await expect(up).toHaveAttribute('aria-disabled', 'true');
    await expect.poll(saved).toEqual(['place:642', 'place:449', 'place:194']);
    if (!gap) { await page.keyboard.press('Alt+Meta+ArrowDown'); await page.keyboard.press('Alt+Meta+ArrowDown'); await expect(options.nth(2)).toHaveText(/^Eye of the North/); }
  }
  // ⌥⌘↓ from the list moves the selected pin; ↓ only selects.
  await list.focus();
  await page.keyboard.press('Alt+Meta+ArrowDown');
  await expect(options).toHaveText([/^Kamadan/, /^Eye of the North/, /^Kaineng Center/]);
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(saved).toEqual(['place:449', 'place:642', 'place:194']);
  // Removal names its target and passes an armed confirmation.
  await expect(page.locator('.hub-actions')).toHaveText('Remove Eye of the North…');
  await page.locator('.hub-actions').click();
  await expect(caption(page)).toHaveText('Remove Eye of the North?');
  await page.keyboard.press('Enter');
  expect(await saved()).toHaveLength(3);
  await expect(primary(page)).toHaveAttribute('data-armed', '');
  await page.keyboard.press('Enter');
  await expect(caption(page)).toHaveText('Hub preferences');
  await expect(options).toHaveText([/^Kamadan/, /^Kaineng Center/]);
  await expect.poll(saved).toEqual(['place:449', 'place:194']);
  expect(await ledger(page)).toEqual([]);
});

test('every Hub view keeps the footer with a key legend and a named primary', async ({ page }) => {
  await open(page);
  for (const [query, title, named] of [['settings', 'Settings', /^Done$/], ['hub preferences', 'Hub preferences', /^Done$/], ['team gom', 'GOM AFK', /^Apply team GOM AFK↵$/]] as const) {
    await enter(page, query);
    await expect(caption(page)).toHaveText(title);
    await expect(page.locator('.hub-footer')).toBeVisible();
    await expect(page.locator('.hub-legend')).toContainText('Back');
    await expect(primary(page)).toHaveText(named);
    await page.keyboard.press('Meta+Backspace');
    await expect(caption(page)).toHaveText('Home');
  }
  // Done steps back one level.
  await enter(page, 'settings');
  await primary(page).click();
  await expect(caption(page)).toHaveText('Home');
});

test('right-click selects a row and opens its Actions', async ({ page }) => {
  await open(page);
  await row(page, 'Eye of the North').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions' });
  await expect(menu.getByRole('menuitem')).toHaveText([/^Travel to Eye of the North/, 'Pin to Hub', 'Set search phrase…']);
  await expect(caption(page)).toHaveText('Home');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(search(page)).toBeFocused();
  await expect(row(page, 'Eye of the North')).toHaveAttribute('aria-selected', 'true');
  expect(await ledger(page)).toEqual([]);
});

test('right-click selects a Travel destination or a character card and runs nothing', async ({ page }) => {
  /** A right press as a person makes it; returns whether the native menu was suppressed. */
  const rightClick = async (target: Locator) => {
    // The Hub dialog stops the event on its way up, so read it once its dispatch has ended.
    await page.evaluate(() => window.addEventListener('contextmenu', event => { setTimeout(() => { (window as unknown as { menu: boolean }).menu = !event.defaultPrevented; }); }, { capture: true, once: true }));
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    const menu = () => page.evaluate(() => (window as unknown as { menu?: boolean }).menu);
    await expect.poll(menu).not.toBeUndefined();
    const shown = await menu();
    await page.evaluate(() => { delete (window as unknown as { menu?: boolean }).menu; });
    return shown;
  };
  await open(page);
  await page.keyboard.press('Meta+t');
  await expect(page.locator('#travel-recent-449')).toHaveAttribute('aria-selected', 'true');
  for (const [target, named] of [['#travel-favorite-0', /^Travel to Ascalon City/], ['#travel-recent-194', /^Travel to Kaineng Center/]] as const) {
    expect(await rightClick(page.locator(target)), target).toBe(false);
    await expect(page.locator(target)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#hub .hub-primary')).toHaveText(named);
    await expect(page.locator('#travel-search-input')).toBeFocused();
  }
  // The outpost the player stands in is no trip, so a right-click cannot select it either.
  expect(await rightClick(page.locator('#travel-favorite-1'))).toBe(false);
  await expect(page.locator('#travel-favorite-1')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#travel-recent-194')).toHaveAttribute('aria-selected', 'true');
  await expect(caption(page)).toHaveText('Travel');
  await page.keyboard.press('Meta+e');
  const card = page.locator('button[data-character-key="mesmer"]');
  expect(await rightClick(card)).toBe(false);
  await expect(card).toHaveAttribute('aria-selected', 'true');
  await expect(card).toBeFocused();
  await expect(page.locator('#hub .hub-primary')).toHaveText(/^Switch to Fixture Mesmer/);
  await page.waitForTimeout(600);
  expect(await ledger(page)).toEqual([]);
  expect(await canvas(page)).toEqual([]);
});

test('the footer slots keep their place from page to page', async ({ page }) => {
  await open(page);
  const slot = async () => {
    const actions = page.locator('.hub-actions');
    await expect(actions).toBeVisible();
    const box = (await actions.boundingBox())!;
    return [Math.round(box.x), Math.round(box.width), Math.round((await primary(page).boundingBox())!.x + (await primary(page).boundingBox())!.width)];
  };
  const home = await slot();
  await enter(page, 'build smiter');
  await expect(page.getByRole('button', { name: 'Actions', exact: true })).toBeEnabled();
  expect(await slot()).toEqual(home);
});

test('a double-click on the calculator card copies once', async ({ page }) => {
  await open(page);
  await search(page).fill('10 ecto in p');
  const card = page.locator('#hub .hub-conversion').first();
  await expect(card).toBeVisible();
  await clicks(page, card, 2);
  await expect.poll(async () => (await ledger(page)).filter(entry => entry.startsWith('Copied'))).toHaveLength(1);
  // One named receipt, in the status line of the Hub that stays open (D-8).
  await expect(page.locator('#hub .hub-status')).toHaveText(/^Copied “.*60 platinum/);
  if (await page.locator('#hub').isHidden()) await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await search(page).fill('10 ecto in p');
  await clicks(page, page.locator('#hub .hub-conversion').first(), 3);
  expect((await ledger(page)).filter(entry => entry.startsWith('Copied'))).toHaveLength(2);
  expect((await canvas(page)).filter(event => !/:(0|1)$/u.test(event))).toEqual([]);
});

test('a click on blank space keeps the keyboard where it was (HUB-246)', async ({ page }) => {
  await open(page);
  const typedInto = async (click: () => Promise<void>) => {
    await click();
    await page.keyboard.type('mo');
    return page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | null;
      return `${active?.tagName}:${active?.value ?? ''}`;
    });
  };
  await search(page).fill('acc second');
  expect(await typedInto(() => page.locator('.hub-results').click({ position: { x: 300, y: 250 } }))).toBe('INPUT:acc secondmo');
  await search(page).fill('');
  expect(await typedInto(() => page.locator('.hub-group').first().click())).toBe('INPUT:mo');
  await page.keyboard.press('Meta+t');
  expect(await typedInto(() => page.locator('#travel-panel').click({ position: { x: 300, y: 330 } }))).toBe('INPUT:mo');
  await page.keyboard.press('Meta+e');
  await expect(page.locator('button[data-character-key="monk"]')).toBeFocused();
  // Characters is card-first: typing from the card it returns to moves to its search.
  expect(await typedInto(() => page.locator('.character-switch-panel').click({ position: { x: 300, y: 300 } }))).toBe('INPUT:mo');
  await expect(page.locator('#character-switch-query')).toBeFocused();
});

test('a person page\'s world actions only select on a click', async ({ page }) => {
  await open(page, '&party');
  await enter(page, 'zed delta');
  await expect(caption(page)).toHaveText('Zed Delta');
  await page.waitForTimeout(600);
  for (const [title, footer] of [['Invite to party', /^Invite Zed Delta/], ['Travel and invite', /^Travel and invite Zed Delta/], ['Travel to outpost', /^Travel to \S/]] as const) {
    const target = row(page, title);
    if (!await target.count()) continue;
    await clicks(page, target, 1);
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await expect(primary(page)).toHaveText(footer);
  }
  expect(await ledger(page)).toEqual([]);
  await expect(page.locator('#hub')).toBeVisible();
});

test('a double-click on a recently applied build opens its target page and applies nothing', async ({ page }) => {
  await open(page);
  await enter(page, 'build smiter');
  await page.keyboard.press('Enter');
  await expect.poll(() => ledger(page)).toContain('apply-build');
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  const before = (await ledger(page)).length;
  await clicks(page, row(page, 'Recently applied'), 2);
  await expect(caption(page)).not.toHaveText('Home');
  await expect(page.locator('#hub')).toBeVisible();
  expect((await ledger(page)).length).toBe(before);
});
