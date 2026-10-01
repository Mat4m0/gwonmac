import { expect, test, type Page } from '@playwright/test';

// The fixture's game lifecycle, shortcut routing and main-process models must
// match production, or fixture journeys hide production defects (HUB-239).
const lifecycle = (page: Page) => page.getByLabel('Lifecycle state', { exact: true });
const open = async (page: Page, query = '') => {
  await page.goto(`/?hub${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
};
const canvasEvents = (page: Page) => page.evaluate(() => window.gwFixtureCanvas?.events.map(event => `${event.type}:${event.code ?? event.detail}`) ?? []);

test.describe('game lifecycle', () => {
  test('one lifecycle state names the place and gates character switching', async ({ page }) => {
    await open(page, '&lifecycle=pvp-outpost');
    const search = page.locator('.hub-search input');
    await expect(lifecycle(page)).toHaveValue('pvp-outpost');
    await expect(page.locator('.hub-context')).toHaveText('Fixture Monk · Random Arenas · PvP');
    await lifecycle(page).selectOption('map-loading');
    await search.fill('char toefte'); await search.press('Enter');
    await expect(page.locator('#hub')).toContainText('Wait until Guild Wars finishes loading');
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
    await lifecycle(page).selectOption('pve-explorable');
    await search.fill('char toefte'); await search.press('Enter');
    await expect(page.locator('#character-switch-title')).toHaveText('Leave this area and switch to Toefte?');
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
    // The confirmation arms after a moment, so the press that raised it cannot pass it.
    const leave = page.getByRole('button', { name: 'Leave and switch to Toefte', exact: true });
    await expect(leave).toHaveAttribute('data-armed', '');
    await leave.click();
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'Character toefte');
  });

  test('Characters list arrival focuses the current card instead of its prior display setting (HUB-074)', async ({ page }) => {
    await open(page, '&characters-ms=1500');
    await page.keyboard.press('Meta+e');
    await page.getByRole('button', { name: 'Character Switch settings', exact: true }).click();
    const profession = page.getByRole('checkbox', { name: 'Show profession' });
    await profession.focus();
    await expect(profession).toBeFocused();
    const before = await profession.isChecked();
    const current = page.locator('#character-switch-list button[aria-current=true]');
    await expect(current).toBeFocused();
    await page.keyboard.press('Enter');
    expect((await page.evaluate(() => window.gwNative.hubSettings.get())).settings.characterSwitchProfession).toBe(before);
    await expect(current).toBeFocused();
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
  });

  test('a Travel arrival moves the lifecycle to the destination outpost', async ({ page }) => {
    await open(page, '&lifecycle=pve-explorable');
    const search = page.locator('.hub-search input');
    await search.fill('kamadan');
    await expect(page.locator('.hub-primary')).toHaveText(/^Travel to Kamadan/);
    await search.press('Enter');
    // Leaving the explorable area asks first (D-27); the armed Leave starts the trip.
    const leave = page.getByRole('button', { name: 'Leave and travel to Kamadan, Jewel of Istan', exact: true });
    await expect(leave).toHaveAttribute('data-armed', '');
    await leave.click();
    // The trip is recorded as a game action, like every other command that reaches the game.
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'TRAVEL Kamadan, Jewel of Istan');
    await expect(lifecycle(page)).toHaveValue('outpost');
    await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
    await expect(page.locator('.hub-context')).toHaveText('Fixture Monk · Kamadan, Jewel of Istan');
  });
});

test.describe('shortcuts through commands.ts', () => {
  // HUB-172: a direct shortcut for the page on top focuses it; it never stacks history or closes the Hub.
  test('Command-T on Travel keeps Travel and its search, the way the renderer command does', async ({ page }) => {
    await open(page);
    const hub = page.getByRole('dialog', { name: /^Hub(?: — .+)?$/u });
    await page.keyboard.press('Meta+t');
    await expect(page.locator('.hub-caption')).toHaveText('Travel');
    await page.getByRole('button', { name: 'Back', exact: true }).focus();
    await page.keyboard.press('Meta+t');
    await expect(hub).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hub breadcrumb' })).toHaveText('Home›Travel');
    await expect(page.getByRole('combobox', { name: 'Destination, phrase, or friend' })).toBeFocused();
    await page.keyboard.press('Meta+r');
    await page.keyboard.press('Meta+b');
    const search = page.locator('.hub-search input');
    await search.fill('smiter');
    for (let press = 0; press < 3; press++) await page.keyboard.press('Meta+b');
    await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Build Library');
    await expect(search).toHaveValue('smiter'); await expect(search).toBeFocused();
    await page.keyboard.press('Meta+Backspace');
    await expect(page.locator('.hub-caption')).toHaveText('Home');
    await search.fill('settings'); await search.press('Enter');
    await page.getByRole('button', { name: 'Maps', exact: true }).click();
    await page.evaluate(() => window.gwHub?.openSettings());
    await page.evaluate(() => window.gwHub?.openSettings());
    await expect(page.locator('.hub-settings-body h2')).toHaveText('Maps');
    await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Settings');
    await page.keyboard.press('Meta+Backspace');
    await expect(page.locator('.hub-caption')).toHaveText('Home');
  });

  test('Command-T finds a Travel page opened from Home, and a closed Hub starts Travel fresh', async ({ page }) => {
    await open(page);
    const travelSearch = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
    await page.locator('.hub-search input').fill('travel');
    await expect(page.locator('.hub-primary')).toHaveText(/^Browse travel/);
    await page.keyboard.press('Enter');
    await travelSearch.fill('kamadan');
    await page.keyboard.press('Meta+t');
    await expect(page.getByRole('navigation', { name: 'Hub breadcrumb' })).toHaveText('Home›Travel');
    await expect(travelSearch).toHaveValue('kamadan');
    await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
    await page.keyboard.press('Meta+t');
    await expect(travelSearch).toBeFocused();
    await expect(travelSearch).toHaveValue('');
  });

  test('a held Command-R toggles once and its repeats never reach the page', async ({ page }) => {
    await open(page);
    const hub = page.getByRole('dialog', { name: /^Hub(?: — .+)?$/u });
    await page.keyboard.press('Escape');
    await expect(hub).toBeHidden();
    await page.evaluate(() => window.gwFixtureCanvas?.clear());
    await page.keyboard.down('Meta');
    for (let press = 0; press < 4; press++) await page.keyboard.down('r');
    await page.keyboard.up('r'); await page.keyboard.up('Meta');
    await expect(hub).toBeVisible();
    await expect(page.locator('.hub-search input')).toHaveValue('');
    expect((await canvasEvents(page)).filter(event => event.endsWith('KeyR'))).toEqual([]);
  });

  test('Command-Q opens the Quit-or-Reload sheet, and Escape cancels it', async ({ page }) => {
    await open(page);
    const sheet = page.getByRole('dialog', { name: 'Quit or reload Guild Wars?' });
    await page.keyboard.press('Meta+q');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Reload Guild Wars' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'Quit or reload cancelled');
    await page.keyboard.press('Meta+q');
    await sheet.getByRole('button', { name: 'Quit Game' }).click();
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'Game quit');
    await expect(page.locator('.hub-fixture-quit')).toBeVisible();
  });

  // HUB-001: the row promises the confirmation sheet, so it opens it and quits nothing.
  // HUB-250: Cancel hands the task back with its search, as Resign's confirmation does.
  test('the Quit or Reload row opens the confirmation sheet, and Cancel returns to the search', async ({ page }) => {
    await open(page);
    const search = page.locator('.hub-search input');
    const sheet = page.getByRole('dialog', { name: 'Quit or reload Guild Wars?' });
    for (const word of ['reload', 'quit', 'restart']) {
      await search.fill(word);
      await expect(page.locator('#hub .hub-primary')).toContainText('Review options');
      await search.press('Enter');
      await expect(sheet).toBeVisible();
      await expect(page.locator('#hub')).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(page.locator('#app')).toHaveAttribute('data-action', 'Quit or reload cancelled');
      await expect(page.locator('#hub')).toBeVisible();
      await expect(search).toHaveValue(word);
      await expect(search).toBeFocused();
    }
  });

  // PTR-28: a double-click on the row or the footer primary, or a single click on
  // the row, asks for the sheet exactly once; its later click never reaches the game.
  for (const [gesture, clicks, locate] of [
    ['double-click on the row', 2, (page: Page) => page.locator('#hub .hub-row', { hasText: 'Quit or Reload Game' })],
    ['single click on the row', 1, (page: Page) => page.locator('#hub .hub-row', { hasText: 'Quit or Reload Game' })],
    ['double-click on the footer primary', 2, (page: Page) => page.locator('#hub .hub-primary')],
  ] as const) {
    test(`a ${gesture} opens the Quit or Reload sheet once and quits nothing`, async ({ page }) => {
      await open(page);
      const search = page.locator('.hub-search input');
      const sheet = page.getByRole('dialog', { name: 'Quit or reload Guild Wars?' });
      await search.fill('reload');
      await expect(page.locator('#hub .hub-primary')).toContainText('Review options');
      await page.evaluate(() => window.gwFixtureCanvas?.clear());
      await locate(page).click({ clickCount: clicks });
      await expect(sheet).toBeVisible();
      // Past the double-click interval, so a second request would have arrived.
      await page.waitForTimeout(600);
      await expect(sheet).toHaveAttribute('data-requests', '1');
      expect(await canvasEvents(page)).toEqual([]);
      await expect(page.locator('.hub-fixture-quit')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('#app')).toHaveAttribute('data-action', 'Quit or reload cancelled');
      expect(await page.evaluate(() => window.gwFixtureActions?.filter(action => /^(Game|Quit)/u.test(action)))).toEqual(['Quit or reload cancelled']);
    });
  }

  // A native sheet cannot be armed, so it opens only after the press that asked for it:
  // a held Enter never answers "Reload Guild Wars" with its auto-repeat.
  test('a held Enter on the Quit or Reload row opens the sheet only after release', async ({ page }) => {
    await open(page);
    const search = page.locator('.hub-search input');
    const sheet = page.getByRole('dialog', { name: 'Quit or reload Guild Wars?' });
    await search.fill('reload');
    for (let press = 0; press < 6; press++) { await page.keyboard.down('Enter'); await page.waitForTimeout(60); }
    await expect(page.locator('#hub')).toBeHidden();
    await expect(sheet).toBeHidden();
    await page.keyboard.up('Enter');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Reload Guild Wars' })).toBeFocused();
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Game (reload|quit)/u);
    await page.keyboard.press('Escape');
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'Quit or reload cancelled');
  });
});

test('the canvas ledger records only input that reaches the game', async ({ page }) => {
  await open(page);
  const search = page.locator('.hub-search input');
  await search.fill('kam');
  expect(await canvasEvents(page)).toEqual([]);
  await search.fill(''); await search.press('Escape');
  await expect(page.locator('#canvas')).toBeFocused();
  await page.evaluate(() => window.gwFixtureCanvas?.clear());
  await page.keyboard.press('w');
  expect(await canvasEvents(page)).toEqual(['keydown:KeyW', 'keyup:KeyW']);
  await expect(page.locator('.hub-fixture-canvas-count')).toHaveText('Canvas input: 2');
});

test('the library switch loads 1000 builds without replacing saved fixture data', async ({ page }) => {
  await open(page, '&library=1000');
  await expect(page.locator('.hub-fixture-controls')).toContainText('1000 builds');
  const search = page.locator('.hub-search input');
  await search.fill('build swift healer 0001');
  await expect(page.locator('.hub-row').first()).toContainText('Swift Healer 0001');
  expect(await page.evaluate(() => localStorage.getItem('hub-fixture-library'))).toBeNull();
});

test('sample trader quotes carry the sample marker', async ({ page }) => {
  await open(page);
  await page.locator('.hub-search input').fill('10 ecto in p');
  await expect(page.locator('#hub').getByRole('option', { name: /60 platinum \(sample\).*Buy from trader/ })).toBeVisible();
});
