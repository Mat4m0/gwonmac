import { expect, test, type Page } from '@playwright/test';

// The fixture's game lifecycle, shortcut routing and main-process models must
// match production, or fixture journeys hide production defects (HUB-239).
const searchName = 'Search people, places, builds';
const lifecycle = (page: Page) => page.getByLabel('Lifecycle state', { exact: true });
const open = async (page: Page, query = '') => {
  await page.goto(`/?hub${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
};
const canvasEvents = (page: Page) => page.evaluate(() => window.gwFixtureCanvas?.events.map(event => `${event.type}:${event.code ?? event.detail}`) ?? []);

test.describe('game lifecycle', () => {
  test('one lifecycle state names the place and gates character switching', async ({ page }) => {
    await open(page, '&lifecycle=pvp-outpost');
    const search = page.getByRole('combobox', { name: searchName });
    await expect(lifecycle(page)).toHaveValue('pvp-outpost');
    await expect(page.locator('.hub-context')).toHaveText('Fixture Monk · Random Arenas');
    await lifecycle(page).selectOption('map-loading');
    await search.fill('char toefte'); await search.press('Enter');
    await expect(page.locator('#hub')).toContainText('Wait until Guild Wars finishes loading');
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
    await lifecycle(page).selectOption('pve-explorable');
    await search.fill('char toefte'); await search.press('Enter');
    await expect(page.locator('#character-switch-title')).toHaveText('Leave this area?');
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
    // The confirmation arms after a moment, so the press that raised it cannot pass it.
    const leave = page.getByRole('button', { name: 'Leave and switch', exact: true });
    await expect(leave).toHaveAttribute('data-armed', '');
    await leave.click();
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'Character toefte');
  });

  test('a Travel arrival moves the lifecycle to the destination outpost', async ({ page }) => {
    await open(page, '&lifecycle=pve-explorable');
    const search = page.getByRole('combobox', { name: searchName });
    await search.fill('kamadan');
    await expect(page.locator('.hub-primary')).toHaveText(/^Travel to Kamadan/);
    await search.press('Enter');
    // The trip is recorded as a game action, like every other command that reaches the game.
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'TRAVEL Kamadan, Jewel of Istan');
    await expect(lifecycle(page)).toHaveValue('outpost');
    await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
    await expect(page.locator('.hub-context')).toHaveText('Fixture Monk · Kamadan, Jewel of Istan');
  });
});

test.describe('shortcuts through commands.ts', () => {
  test('Command-T toggles Travel closed the way the renderer command does', async ({ page }) => {
    await open(page);
    const hub = page.getByRole('dialog', { name: 'Hub', exact: true });
    await page.keyboard.press('Meta+t');
    await expect(page.locator('.hub-caption')).toHaveText('Travel');
    await page.keyboard.press('Meta+t');
    await expect(hub).toBeHidden();
    await expect(page.locator('#canvas')).toBeFocused();
  });

  test('a held Command-R toggles once and its repeats never reach the page', async ({ page }) => {
    await open(page);
    const hub = page.getByRole('dialog', { name: 'Hub', exact: true });
    await page.keyboard.press('Escape');
    await expect(hub).toBeHidden();
    await page.evaluate(() => window.gwFixtureCanvas?.clear());
    await page.keyboard.down('Meta');
    for (let press = 0; press < 4; press++) await page.keyboard.down('r');
    await page.keyboard.up('r'); await page.keyboard.up('Meta');
    await expect(hub).toBeVisible();
    await expect(page.getByRole('combobox', { name: searchName })).toHaveValue('');
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

  // HUB-001: the row promises the confirmation sheet but quits at once. The fixture
  // models production, so this documents the open P0 until its fix lands.
  test('the Quit or Reload row opens the confirmation sheet', async ({ page }) => {
    test.fail(true, 'HUB-001: the Hub row calls requestQuit instead of the Quit-or-Reload sheet');
    await open(page);
    const search = page.getByRole('combobox', { name: searchName });
    await search.fill('reload'); await search.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Quit or reload Guild Wars?' })).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', 'Game quit');
  });
});

test('the canvas ledger records only input that reaches the game', async ({ page }) => {
  await open(page);
  const search = page.getByRole('combobox', { name: searchName });
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
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build swift healer 0001');
  await expect(page.locator('.hub-row').first()).toContainText('Swift Healer 0001');
  expect(await page.evaluate(() => localStorage.getItem('hub-fixture-library'))).toBeNull();
});

test('sample trader quotes carry the sample marker', async ({ page }) => {
  await open(page);
  await page.getByRole('combobox', { name: searchName }).fill('10 ecto in p');
  await expect(page.locator('#hub').getByRole('option', { name: /60 platinum \(sample\).*Buy from trader/ })).toBeVisible();
});
