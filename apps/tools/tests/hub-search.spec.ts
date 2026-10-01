import { expect, test, type Page } from '@playwright/test';

/**
 * Hub search answers with its best row: exact names and aliases first, then names that start
 * with the query, then words, then keywords; sections follow their best row (HUB-008, HUB-058).
 * The selected row is what Enter runs, so the footer primary is the answer under test.
 */
const open = async (page: Page, shortcuts: readonly { id: string; phrase: string; pinned: boolean }[] = []) => {
  await page.addInitScript(value => localStorage.setItem('hub-fixture-shortcuts', value), JSON.stringify(shortcuts));
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
};
const search = (page: Page) => page.locator('.hub-search input');
const primary = (page: Page) => page.locator('#hub .hub-primary');

const answers: [query: string, primary: RegExp, finding: string][] = [
  ['trade chat', /^Open Trade Chat/, 'HUB-008: a tool’s own name wins'],
  ['toa', /^Travel to Temple of the Ages/, 'HUB-010: a catalogue alias is a name'],
  ['gtob', /^Travel to Great Temple of Balthazar/, 'HUB-010: a catalogue alias is a name'],
  ['gh', /^Travel to Guild Hall/, 'HUB-010: Guild Hall is a place'],
  ['Seeker’s Passage', /^Travel to Seeker's Passage/, 'HUB-143: typographic apostrophes fold'],
  ['tp kamadan', /^Travel to Kamadan/, 'HUB-142: scope aliases'],
  ['tra', /^Browse travel/, 'HUB-058: a name that starts with the query beats a later word'],
  ['ascalon city', /^Travel to Ascalon City/, 'HUB-056: the available exact place, not the disabled pre-Searing one'],
  ['trader prices', /^Open Trade Chat/, 'HUB-224: trader finds Trade Chat'],
  ['rate', /^Choose rates/, 'HUB-063: the rates editor by its word'],
  ['title', /^Open calculator/, 'HUB-063: the title calculator by its word'],
  ['shortcuts', /^Open Shortcuts settings/, 'HUB-064: a Settings section by its name'],
  ['theme', /^Open Appearance settings/, 'HUB-064: a Settings section by its words'],
  ['10 ecto', /^Copy 60 platinum/, 'HUB-102: a conversion without its target uses the labelled default, runs nothing'],
];

test('a typed search selects its best answer', async ({ page }) => {
  await open(page);
  for (const [query, expected, finding] of answers) {
    await search(page).fill(query);
    await expect(primary(page), finding).toHaveText(expected);
    await expect(primary(page), finding).toBeEnabled();
  }
  for (const [query, title] of [['title', 'Title calculator'], ['calc', 'Title calculator'], ['party', 'Title calculator'], ['rate', 'Conversion rates'], ['currency', 'Conversion rates']] as const) {
    await search(page).fill(query);
    await expect(page.locator('.hub-title', { hasText: title }).filter({ hasText: new RegExp(`^${title}$`) })).toHaveCount(1);
  }
  expect(await page.locator('#app').getAttribute('data-action')).toBeNull();
});

test('a Settings section result opens that section (HUB-064)', async ({ page }) => {
  await open(page);
  for (const [query, section] of [['shortcuts', 'Shortcuts'], ['theme', 'Appearance']] as const) {
    await search(page).fill(query);
    await search(page).press('Enter');
    await expect(page.locator('.hub-settings nav [aria-current="true"]')).toHaveText(section);
    await page.keyboard.press('Meta+Backspace');
    await expect(page.locator('.hub-caption')).not.toHaveText('Settings');
  }
});

test('travel <friend> offers the trip to that friend\'s outpost after the places (HUB-142)', async ({ page }) => {
  await page.goto('/?hub&party');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await search(page).fill('travel zed alpha');
  const row = page.locator('#hub .hub-row[data-id="person:travel:alpha"]');
  await expect(row).toContainText('Zed Alpha');
  await row.click();
  await expect(primary(page)).toHaveText(/^Travel to Kamadan, Jewel of Istan/);
  expect(await page.locator('#app').getAttribute('data-action')).toBeNull();
});

test('places rank before the cap, and the rest are one row away in Travel (HUB-057)', async ({ page }) => {
  await open(page);
  await search(page).fill('k');
  const results = page.locator('#hub-results');
  await expect(results.getByRole('option', { name: /Kamadan, Jewel of Istan/ })).toBeVisible();
  const more = results.getByRole('option', { name: /^All \d+ places/ });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('.hub-caption')).toHaveText('Travel');
  await expect(page.getByRole('combobox', { name: 'Destination, phrase, or friend' })).toHaveValue('k');
});

test('a saved phrase wins over a name, and pins on an empty Home keep a selection (HUB-008, HUB-060)', async ({ page }) => {
  await open(page, [{ id: 'travel', phrase: '', pinned: true }, { id: 'settings', phrase: 'kam', pinned: true }]);
  await expect(primary(page)).toHaveText(/^(Browse|Open) [Tt]ravel/);
  await search(page).fill('kam');
  await expect(primary(page)).toHaveText(/^Open Settings/);
});

test('the first screen stays on the game: Launcher and the website wait for a typed search (HUB-185)', async ({ page }) => {
  await open(page);
  await expect(page.locator('#hub [role="option"]', { hasText: 'Show Launcher' })).toHaveCount(0);
  await search(page).fill('launcher');
  await expect(primary(page)).toHaveText(/^Show Launcher/);
});

test('a profession code is also the start of a word while typing (HUB-059, D-17)', async ({ page }) => {
  await page.goto('/?hub&library=20');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const build = page.locator('#hub-results').getByRole('option', { name: /Deep Healer 0008/ });
  // `d` is the Dervish code; it no longer hides a Monk build with a word that starts with d.
  await search(page).fill('build healer d');
  await expect(build).toBeVisible();
  // A full profession name still filters by primary profession.
  await search(page).fill('build healer dervish');
  await expect(build).toHaveCount(0);
});


test('Commands is findable by ? and groups its fill-only examples by job (HUB-093, HUB-094)', async ({ page }) => {
  await open(page);
  await search(page).fill('?');
  await expect(primary(page)).toHaveText(/^Browse commands/);
  await search(page).press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Commands');
  await expect(search(page)).toHaveAttribute('placeholder', 'Search commands…');
  await expect(search(page)).toHaveAccessibleName('Search commands…');
  const groups = await page.locator('.hub-group').allTextContents();
  expect(groups.length).toBeGreaterThanOrEqual(6);
  expect(groups).toContain('Keys & shortcuts');
  await page.locator('.hub-row[data-id="example:0"]').click();
  await expect(search(page)).toHaveValue('travel ');
  expect(await search(page).evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([7, 7]);
  expect(await page.locator('#app').getAttribute('data-action')).toBeNull();
});


test('an exact tool title has no scope chip and scoped Trade names the query (HUB-008)', async ({ page }) => {
  await open(page);
  await search(page).fill('trade chat');
  await expect(page.locator('.hub-scope')).toBeHidden();
  await expect(primary(page)).toHaveText(/^Open Trade Chat/);
  await search(page).fill('trade ecto');
  await expect(page.locator('.hub-scope')).toHaveText('trade');
  await expect(primary(page)).toHaveText(/^Search Trade for ecto/);
});

test('a Commands footer names the example it fills (HUB-094)', async ({ page }) => {
  await open(page);
  await search(page).fill('commands'); await search(page).press('Enter');
  await expect(primary(page)).toHaveText(/^Fill search with build <name or profession>/);
});


test('an exact catalogue alias and exact build name require a choice (HUB-008)', async ({ page }) => {
  const library = { version: 3, tags: [], teams: [], hubShortcuts: [], builds: [{ id: 'alias-tie', name: 'Toa', professions: ['Mo', null], skills: [null, null, null, null, null, null, null, null], attributes: {}, tags: [], favourite: false, parent: null, notes: '', lastUsed: null, origin: null }] };
  await page.addInitScript(value => localStorage.setItem('hub-fixture-library', value), JSON.stringify(library));
  await open(page);
  await search(page).fill('toa');
  await expect(page.locator('.hub-row')).toHaveCount(2);
  await expect(page.locator('.hub-row[aria-selected=true]')).toHaveCount(0);
  await expect(primary(page)).toBeDisabled();
  await search(page).press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  expect(await page.locator('#app').getAttribute('data-action')).toBeNull();
});
