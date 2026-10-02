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
  ['ma', /^Adjust maps/, 'HUB-058: a tool named by the query leads places that start the same'],
  ['tra', /^Browse travel/, 'HUB-058: a name that starts with the query beats a later word'],
  ['ascalon city', /^Travel to Ascalon City/, 'HUB-056: the available exact place, not the disabled pre-Searing one'],
  ['char f', /^Show Fixture Ranger in Characters/, 'HUB-056: the eligible character'],
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
  for (const [query, id, label] of [['ascalon city', 'place:81', 'Travel to Ascalon City↵'], ['char f', 'character:ranger', 'Show Fixture Ranger in Characters↵']] as const) {
    await search(page).fill(query);
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id', id);
    await expect(primary(page)).toHaveText(label);
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
  const pins = ['travel', 'settings', 'commands', 'hub-preferences', 'maps'];
  for (const count of [2, 5]) {
    await open(page, pins.slice(0, count).map(id => ({ id, phrase: '', pinned: true })));
    await expect(page.getByRole('group', { name: 'Pinned', exact: true }).locator('.hub-row')).toHaveCount(count);
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id', 'travel');
    await expect(primary(page)).toHaveText('Browse travel↵');
  }
  await open(page, [{ id: 'place:194', phrase: 'ranger', pinned: false }, { id: 'settings', phrase: 'kam', pinned: false }]);
  for (const library of [true, false]) {
    await page.evaluate(buildLibrary => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { buildLibrary } })), library);
    for (const [query, id, label] of [['ranger', 'place:194', 'Travel to Kaineng Center↵'], ['kam', 'settings', 'Open Settings↵'], ['eye of the north', 'place:642', 'Travel to Eye of the North↵']] as const) {
      await search(page).fill(query);
      await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id', id);
      await expect(primary(page)).toHaveText(label);
    }
  }
});

test('the first screen stays on the game: Launcher and the website wait for a typed search (HUB-185)', async ({ page }) => {
  await open(page);
  await expect(page.locator('#hub [role="option"]', { hasText: 'Show Launcher' })).toHaveCount(0);
  // Commands, the way into everything else, leads its group.
  await expect(page.locator('#hub [role="group"]', { has: page.locator('.hub-group', { hasText: /^Commands$/ }) }).locator('.hub-row').first()).toHaveAttribute('data-id', 'commands');
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
  for (const [action, id, labels] of [['travel.open', 'travel', ['⇧', '⌘', 'Y']], ['character.switch', 'character', ['⇧', '⌘', 'Y']], ['tools.toggle', 'builds', ['⇧', '⌘', 'Y']], ['trade.toggle', 'trade', ['⇧', '⌘', 'Y']], ['whispers.toggle', 'whispers', ['⇧', '⌘', 'Y']]] as const) {
    for (const binding of [{ key: 'y', shift: true, option: false }, null]) {
      await page.evaluate(({ action, binding }) => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { shortcutOverrides: { [action]: binding } } })), { action, binding });
      await page.keyboard.press('Meta+r'); await search(page).fill('?'); await search(page).press('Enter');
      const row = page.locator(`.hub-row[data-id="key:${id}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator('kbd')).toHaveText(binding ? labels : []);
      if (!binding) await expect(row.locator('.hub-detail')).toHaveText('Not set');
    }
  }
  const examples = [
    ['travel <place>', 'travel ', [7, 7]], ['char <name>', 'char ', [5, 5]],
    ['build <name or profession>', 'build ', [6, 6]], ['team <name>', 'team ', [5, 5]],
    ['build folder:<folder> <name>', 'build folder:', [6, 13]], ['build Mo/Me', 'build Mo/Me', [6, 11]],
    ['whisper <name>', 'whisper ', [8, 8]], ['invite <name>', 'invite ', [7, 7]],
    ['trade <item>', 'trade ', [6, 6]], ['acc <name>', 'acc ', [4, 4]],
    ['1p in g', '1p in g', [0, 7]], ['10e in p', '10e in p', [0, 8]],
    ['2 * 250 + 75', '2 * 250 + 75', [0, 12]], ['titles', 'titles', [0, 6]],
  ] as const;
  expect((await page.locator('.hub-row[data-id^="example:"] .hub-title').allTextContents()).sort()).toEqual(examples.map(([title]) => title).sort());
  for (const [title, value, selection] of examples) {
    await page.locator('.hub-row').filter({ has: page.locator('.hub-title', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).click();
    await expect(search(page)).toHaveValue(value);
    expect(await search(page).evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]), title).toEqual(selection);
    expect(await page.locator('#app').getAttribute('data-action')).toBeNull();
    await search(page).fill('?'); await search(page).press('Enter');
  }
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
  const library = { version: 3, tags: [], teams: [], hubShortcuts: [], builds: ['Toa', 'Eye of the North farmer', 'Toefte'].map((name, index) => ({ id: `collision-${index}`, name, professions: ['Mo', null], skills: [null, null, null, null, null, null, null, null], attributes: {}, tags: [], favourite: false, parent: null, notes: '', lastUsed: null, origin: null })) };
  await page.addInitScript(value => localStorage.setItem('hub-fixture-library', value), JSON.stringify(library));
  await open(page);
  await page.evaluate(() => {
    const source = window.gwCharacterSwitch!;
    if (source.characters.status !== 'ready') throw new Error('Expected fixture characters');
    Object.assign(source.characters, { characters: [...source.characters.characters, { ...source.characters.characters[1]!, name: 'Eye Of The Northern Star', characterKey: 'eye-prefix' }] });
  });
  for (const library of [true, false]) {
    await page.evaluate(buildLibrary => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { buildLibrary } })), library);
    await search(page).fill('eye of the north');
    await expect(page.locator('#hub-results').getByRole('option', { name: 'Eye of the North farmer', exact: true })).toHaveCount(library ? 1 : 0);
    await expect(page.locator('.hub-title', { hasText: /^Eye Of The Northern Star$/ })).toHaveCount(1);
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id', 'place:642');
    await expect(primary(page)).toHaveText('Travel to Eye of the North↵');
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { buildLibrary: true } })));
  for (const query of ['toa', 'toefte']) {
    await search(page).fill(query);
    await expect(page.locator('.hub-row')).toHaveCount(2);
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveCount(0);
    await expect(primary(page)).toBeDisabled();
    await search(page).press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Home');
    expect(await page.locator('#app').getAttribute('data-action')).toBeNull();
  }
});

test('bare team and invite scopes explain their lists (HUB-141)', async ({ page }) => {
  await open(page);
  for (const [query, chip, titles] of [['team ', 'team', ['Balanced vanquish', 'Classic Discordway', 'GOM AFK', 'Story and missions']], ['invite ', 'invite', ['Romi']]] as const) {
    await search(page).fill(query);
    await expect(page.locator('.hub-scope')).toHaveText(chip);
    await expect(page.locator('#hub-results .hub-title')).toHaveText(titles);
  }
});
