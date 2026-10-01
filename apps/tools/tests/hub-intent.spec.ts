import { expect, test } from '@playwright/test';

const searchName = /^Search (?:people, places, builds|in .+)…$/u;

test('character entry is card-first and Back restores the launching result', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('sw'); await search.press('Enter');
  const card = page.locator('#character-switch-list button:focus');
  await expect(card).toHaveCount(1);
  const first = await card.getAttribute('data-character-key');
  await page.keyboard.press('ArrowRight');
  await expect(card).not.toHaveAttribute('data-character-key', first!);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#character-switch-query')).toBeFocused();
  // The search is the top of the view: ↑ there stays (HUB-137).
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#character-switch-query')).toBeFocused();
  await page.keyboard.press('Meta+Backspace');
  await expect(search).toHaveValue('sw');
  await expect(page.locator('.hub-row[data-id="character"]')).toHaveAttribute('aria-selected', 'true');
  await expect(search).toBeFocused();
});

test('account actions restore each visited account and command row', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('switch account'); await search.press('Enter');
  const account = page.locator('.hub-row[aria-selected="true"]');
  await expect(account).toContainText('Second');
  const identity = await account.getAttribute('data-id');
  await page.keyboard.press('Enter');
  // D-23: the page opens on keeping Main running, never on the replace.
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Open Second');
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator(`.hub-row[data-id="${identity}"]`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-row[data-id="accounts"]')).toHaveAttribute('aria-selected', 'true');
  await expect(search).toHaveValue('switch account'); await expect(search).toBeFocused();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Account/);
});

test('→ on the current account opens no actions, as Enter opens none (HUB-175)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  const selected = page.locator('.hub-row[aria-selected="true"]');
  await search.fill('switch account'); await search.press('Enter');
  await expect(selected).toContainText('Second');
  await page.keyboard.press('ArrowUp');
  await expect(selected).toContainText('Main');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Accounts');
  await expect(selected).toContainText('Main');
});

test('accounts that finish loading take the selection, so Enter acts on them (HUB-232)', async ({ page }) => {
  await page.goto('/?hub&accounts-load-ms=600');
  const search = page.locator('.hub-search input');
  await search.fill('switch account'); await search.press('Enter');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Second');
  await expect(page.locator('#hub .hub-primary')).toBeEnabled();
});

test('a changed account list returns to one refreshed Accounts page (HUB-174)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('switch account'); await search.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Accounts›Second');
  await page.evaluate(() => window.gwFixtureAccounts?.renameSecond('Alt'));
  await page.keyboard.press('Enter');
  // The Accounts page it came from, not a second copy over the stale Second actions.
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Accounts');
  await expect(page.locator('.hub-status')).toHaveText('Accounts changed. Choose from the refreshed list.');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Alt');
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Account/);
});

test('temporary blur resumes the stage and focus while explicit close starts fresh', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  const selected = await page.locator('.hub-row[aria-selected="true"]').getAttribute('data-id');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#hub')).not.toBeVisible();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(page.locator('.hub-summary')).toContainText('Protection');
  await expect(page.locator(`.hub-row[data-id="${selected}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(search).toBeFocused();
  await page.keyboard.press('Meta+Backspace');
  await expect(search).toHaveValue('build monk');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Protection');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(search).toHaveValue(''); await expect(search).toBeFocused();
});

test('native editing shortcuts from results return to the same search', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('ArrowDown');
  await page.keyboard.press('Meta+a'); await expect(search).toBeFocused();
  await page.keyboard.type('sw'); await expect(search).toHaveValue('sw');
  await search.press('ArrowDown'); await page.keyboard.type('itch');
  await expect(search).toHaveValue('switch');
});

test('Travel and Settings restore their own state after a temporary hide', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('travel'); await search.press('Enter');
  const travel = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
  await travel.fill('kam');
  await expect(travel).toHaveAttribute('aria-activedescendant', /travel-/);
  const selected = await travel.getAttribute('aria-activedescendant');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(travel).toHaveValue('kam'); await expect(travel).toBeFocused();
  await expect(travel).toHaveAttribute('aria-activedescendant', selected!);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByLabel('Panel style', { exact: true }).focus();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(page.getByLabel('Panel style', { exact: true })).toBeFocused();
});

test('Hub placement survives reload, stays locked, and resets durably', async ({ page }) => {
  await page.goto('/?hub');
  const panel = page.locator('.hub-panel');
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).click();
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).press('Alt+ArrowRight');
  await page.getByRole('button', { name: 'Resize Hub', exact: true }).press('ArrowLeft');
  const placed = (await panel.boundingBox())!;
  await page.reload();
  const restored = (await panel.boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(restored[key] - placed[key])).toBeLessThanOrEqual(1);
  await expect(panel).toHaveAttribute('data-locked', 'true');
  await page.setViewportSize({ width: 360, height: 500 });
  await expect(page.getByRole('button', { name: 'Close Hub', exact: true })).toBeInViewport();
  const search = page.locator('.hub-search input');
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Hub position', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('gwonmac.hub-window-placement'))).toBeNull();
  await page.reload(); await expect(panel).not.toHaveAttribute('style', /transform: none/);
});

test('held Enter cannot activate a newly entered target page', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk');
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Apply to me');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
});

test('a modified Enter never runs the primary; only a plain Enter does', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build smiter'); await search.press('Enter');
  await expect(page.locator('.hub-primary')).toHaveText(/^Apply Smiter to Fixture Monk/);
  for (const chord of ['Meta+Enter', 'Control+Enter', 'Alt+Enter', 'Shift+Enter']) {
    await search.press(chord);
    await expect(page.locator('#hub')).toBeVisible();
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  }
  await search.fill('kamadan'); await search.press('Meta+Enter');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /travel/i);
  // Travel's own search follows the same rule.
  await page.keyboard.press('Meta+t');
  const travel = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
  await expect(travel).toBeFocused();
  for (const chord of ['Meta+Enter', 'Control+Enter', 'Alt+Enter', 'Shift+Enter']) await travel.press(chord);
  await page.waitForTimeout(700);
  await expect(page.locator('#hub')).toBeVisible();
  await expect(travel).toBeFocused();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /travel/i);
});


test('held Enter on footer actions and Backspace in ordinary fields keep their scope', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  const apply = page.getByRole('button', { name: /^Apply .+ to Fixture Monk ↵$/ });
  await apply.focus();
  expect(await apply.evaluate(button => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })))).toBe(false);
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('team gom afk');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill(''); await phrase.press('Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Search phrase');
  await expect(phrase).toBeFocused();
  // Command-Backspace is Back from a form field too; the form keeps its draft for the session.
  await phrase.fill('keep me'); await phrase.press('Meta+Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(phrase).toHaveCount(0);
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  await expect(phrase).toHaveValue('keep me');
  await expect(phrase).toBeFocused();
  // A closed and reopened Hub still has it.
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await expect(page.locator('#hub')).toBeHidden();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await search.fill('team gom afk');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  await expect(phrase).toHaveValue('keep me');
});

test('a legacy phrase that is now a scope word keeps its pins and only stops matching', async ({ page }) => {
  await page.goto('/?hub');
  const legacy = JSON.stringify([{ id: 'whispers', phrase: 'invite', pinned: true }, { id: 'travel', phrase: '', pinned: true }]);
  await page.evaluate(value => localStorage.setItem('hub-fixture-shortcuts', value), legacy);
  await page.reload();
  const search = page.locator('.hub-search input');
  await expect(page.locator('.hub-group').first()).toHaveText('Pinned');
  await expect(page.locator('.hub-row').nth(0)).toContainText('Whispers');
  await expect(page.locator('.hub-row').nth(1)).toContainText('Travel');
  await search.pressSequentially('invite ');
  await expect(page.locator('.hub-scope')).toHaveText('invite');
  await expect(page.locator('.hub-row[data-id="whispers"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('hub-fixture-shortcuts'))).toBe(legacy);
});

test('the phrase editor refuses a new phrase that starts with a scope word', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('team gom afk');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill('invite x'); await phrase.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('“invite x” starts with the command word “invite”. Choose another phrase.');
  await phrase.fill('gom night'); await phrase.press('Enter');
  // A saved phrase returns to the page that asked and says what it now finds (HUB-152).
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('#hub .hub-status')).toHaveText('“gom night” now finds GOM AFK.');
});

test('the phrase editor refuses a phrase that is already another result’s name, and saves nothing (HUB-062)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('open xunlai storage');
  await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill('Maps'); await phrase.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('“maps” already finds Maps. Choose another phrase.');
  await expect(page.locator('.hub-caption')).toHaveText('Search phrase');
  expect(await page.evaluate(() => localStorage.getItem('hub-fixture-shortcuts'))).toBeNull();
  // A friend's name is a real result too.
  await phrase.fill('romi'); await phrase.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('“romi” already finds Romi. Choose another phrase.');
  await page.keyboard.press('Meta+Backspace');
  await search.fill('maps');
  await expect(page.locator('#hub .hub-row')).toHaveCount(1);
  await expect(page.locator('#hub .hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'maps');
});

test('the phrase form stacks its label, names its error, submits with Command-Enter and keeps a draft through Esc (HUB-152)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  const openForm = async () => {
    await search.fill('team gom afk');
    await page.keyboard.press('Meta+j');
    await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  };
  await openForm();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await expect(phrase).toBeFocused();
  const label = await page.locator('.hub-view label').boundingBox(); const field = await phrase.boundingBox();
  expect(label!.y + label!.height).toBeLessThanOrEqual(field!.y);
  await expect(phrase).toHaveAccessibleDescription(/Type this exact phrase in Hub to find GOM AFK/);
  // Esc leaves the form; the draft is still there when the player comes back.
  await phrase.fill('keep me'); await phrase.press('Escape');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await openForm();
  await expect(phrase).toHaveValue('keep me');
  await phrase.fill('invite x'); await phrase.press('Meta+Enter');
  await expect(phrase).toHaveAttribute('aria-invalid', 'true');
  await expect(phrase).toHaveAccessibleDescription(/^“invite x” starts with the command word “invite”\. Choose another phrase\./);
  await expect(phrase).toBeFocused();
  // Typing clears the error; Command-Enter saves from the field and returns.
  await phrase.fill('gom evening');
  await expect(phrase).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toBeHidden();
  await phrase.press('Meta+Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('#hub .hub-status')).toHaveText('“gom evening” now finds GOM AFK.');
  await search.fill('gom evening');
  await expect(page.locator('#hub .hub-row').first()).toHaveAttribute('data-id', /^team:/);
});

test('a bare travel scope in an explorable area selects Browse travel, so Enter never leaves the area', async ({ page }) => {
  await page.goto('/?hub&lifecycle=pve-explorable');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  await search.pressSequentially('travel ');
  await expect(page.locator('.hub-scope')).toHaveText('travel');
  // Recent places are listed first, yet none is a result the player asked for.
  await expect(page.locator('.hub-row[data-id^="place:"]').first()).toBeVisible();
  await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'travel');
  await expect(page.locator('.hub-primary')).toHaveText(/^Browse travel/);
  await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Travel');
  await expect(page.getByLabel('Lifecycle state', { exact: true })).toHaveValue('pve-explorable');
});

test('a fresh Home in an explorable area starts on Travel, says why, and Enter never leaves the area', async ({ page }) => {
  await page.goto('/?hub&lifecycle=pve-explorable');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  // D-13: recent places stay listed, but none is the default.
  await expect(page.locator('.hub-row[data-id^="place:"]').first()).toBeVisible();
  await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'travel');
  await expect(page.locator('.hub-primary')).toHaveText(/^Browse travel/);
  // D-26: the header names the area and one quiet line names what it holds back.
  await expect(page.locator('.hub-context')).toHaveText('Fixture Monk · North Kryta Province · Explorable area');
  await expect(page.locator('.hub-lifecycle')).toHaveText('Explorable area — Travel leaves this area');
  await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Travel');
  await page.waitForTimeout(700);
  await expect(page.getByLabel('Lifecycle state', { exact: true })).toHaveValue('pve-explorable');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/);
  // Entering the area with Hub open gives the same default; returning to an outpost restores Continue.
  const lifecycle = page.getByLabel('Lifecycle state', { exact: true });
  await lifecycle.selectOption('outpost');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', /^place:/);
  await expect(page.locator('.hub-lifecycle')).toBeHidden();
  await lifecycle.selectOption('pve-explorable');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'travel');
  await lifecycle.selectOption('map-loading');
  await expect(page.locator('.hub-context')).toHaveText('Map loading');
  await expect(page.locator('.hub-lifecycle')).toHaveText('Map loading — Travel returns when the map has loaded');
  // A task report takes the one status line while it shows.
  await search.fill('invite romi'); await search.press('Enter');
  await expect(page.locator('.hub-status')).toBeVisible();
  await expect(page.locator('.hub-lifecycle')).toBeHidden();
});

test.describe('Leave this area? before Travel (D-27, HUB-027)', () => {
  const question = (page: import('@playwright/test').Page) => page.locator('#leave-area-question');
  test('a trip from the Travel view asks first, Stay returns, and only an armed Leave travels', async ({ page }) => {
    await page.goto('/?hub&lifecycle=pve-explorable');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Meta+t');
    const travel = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
    await expect(travel).toBeFocused();
    await expect(page.locator('#travel-recent-449')).toHaveAttribute('data-active', 'true');
    await travel.press('Enter');
    await expect(question(page)).toHaveText('Leave this area and travel to Kamadan, Jewel of Istan?');
    await expect(page.locator('#leave-area-stay')).toBeFocused();
    await expect(page.locator('.hub-primary')).toHaveText(/^Stay here/);
    // A second quick Enter stays: the safe choice has the keyboard.
    await page.keyboard.press('Enter');
    await expect(travel).toBeFocused();
    await expect(page.locator('#travel-recent-449')).toHaveAttribute('data-active', 'true');
    await travel.press('Enter');
    const leave = page.getByRole('button', { name: 'Leave and travel to Kamadan, Jewel of Istan', exact: true });
    await leave.dblclick();
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/);
    await expect(leave).toHaveAttribute('data-armed', '');
    await leave.click();
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'TRAVEL Kamadan, Jewel of Istan');
    await expect(page.locator('#hub')).toBeHidden();
  });

  test('a Home place row and Travel and invite ask the same step, and staying sends nothing', async ({ page }) => {
    await page.goto('/?hub&party&lifecycle=pve-explorable');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const search = page.getByRole('combobox', { name: searchName });
    await search.fill('kamadan'); await search.press('Enter');
    await expect(question(page)).toHaveText('Leave this area and travel to Kamadan, Jewel of Istan?');
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('kamadan');
    await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'place:449');
    await expect(page.locator('.hub-status')).toBeEmpty();
    await search.fill('zed beta'); await search.press('Enter');
    const selected = page.locator('.hub-row[aria-selected="true"]');
    await search.press('End');
    await expect(selected).toHaveAttribute('data-id', 'person:travel-invite');
    await search.press('Enter');
    await expect(question(page)).toHaveText('Leave this area and travel to Ascalon City?');
    await page.locator('#leave-area-stay').click();
    await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Zed Beta');
    await expect(selected).toHaveAttribute('data-id', 'person:travel-invite');
    await expect(page.locator('.hub-status')).toBeEmpty();
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/);
  });
});

test('Resign says what it does before Enter, reads as destructive, and Cancel returns to the search (HUB-250, HUB-251)', async ({ page }) => {
  await page.goto('/?hub&lifecycle=pve-explorable');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  const row = page.locator('.hub-row[data-id="resign"]');
  await search.fill('resign');
  await expect(row.locator('.hub-icon')).toHaveAttribute('data-kind', 'resign');
  await expect(row.locator('.hub-icon svg path')).toHaveAttribute('d', 'M6 21V4M6 4h11l-2.5 4 2.5 4H6');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(row.locator('.hub-detail')).toHaveText('Asks before sending /resign · PvE only');
  await expect(page.locator('.hub-primary')).toHaveAttribute('data-variant', 'danger');
  const dialog = page.locator('#resign-dialog');
  const confirm = dialog.getByRole('button', { name: 'Resign', exact: true });
  for (const cancel of ['Escape', 'Cancel'] as const) {
    await page.evaluate(() => window.gwFixtureCanvas?.clear());
    await search.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(confirm).toHaveAttribute('data-variant', 'danger');
    await expect(dialog).toContainText('When everyone has resigned, the party returns to the outpost');
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('resign');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => window.gwFixtureCanvas?.events.filter(event => event.code === 'Escape').length)).toBe(0);
  }
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', 'RESIGN');
});

test('Resign rejects early confirmation and trailing multi-clicks before sending once (HUB-245)', async ({ page }) => {
  const initial = new Date('2026-09-30T12:00:00Z');
  await page.clock.install({ time: initial });
  await page.goto('/?hub&lifecycle=pve-explorable');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.clock.pauseAt(new Date('2026-09-30T12:01:00Z'));
  const search = page.locator('.hub-search input');
  await search.fill('resign'); await search.press('Enter');
  const dialog = page.locator('#resign-dialog');
  const confirm = dialog.getByRole('button', { name: 'Resign', exact: true });
  for (const advance of [0, 100, 250]) {
    await page.clock.runFor(advance);
    for (const action of ['click', 'Enter']) {
      if (action === 'click') await confirm.dispatchEvent('click', { detail: 1 });
      else await confirm.press('Enter');
      await expect(page.locator('#app')).not.toHaveAttribute('data-action', 'RESIGN');
      await expect(dialog).toBeVisible();
      await expect(confirm).not.toHaveAttribute('data-armed', '');
    }
  }
  await page.clock.runFor(100);
  await expect(confirm).toHaveAttribute('data-armed', '');
  for (const detail of [2, 3]) await confirm.dispatchEvent('click', { detail });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', 'RESIGN');
  await confirm.dispatchEvent('click', { detail: 1 });
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'RESIGN');
  await expect(dialog).toBeHidden();
});

test('Resign sends once from its armed confirmation, and says before Enter why it cannot while a map loads', async ({ page }) => {
  await page.goto('/?hub&lifecycle=pve-explorable');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: searchName });
  const row = page.locator('.hub-row[data-id="resign"]');
  await search.fill('resign');
  await search.press('Enter');
  const confirm = page.locator('#resign-dialog').getByRole('button', { name: 'Resign', exact: true });
  await expect(confirm).toHaveAttribute('data-armed', '');
  await confirm.click();
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'RESIGN');
  await expect(page.locator('#hub')).toBeHidden();
  // While a map loads, the reason shows on the row before Enter (HUB-135).
  await page.getByLabel('Lifecycle state', { exact: true }).selectOption('map-loading');
  await search.fill('resign');
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await expect(row.locator('.hub-detail')).toHaveText('Resign is available with Tools enabled in a PvE area.');
});

test('a friend in your outpost offers no trip, and says so before Enter (HUB-068)', async ({ page }) => {
  await page.goto('/?hub&party');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('zed delta'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Zed Delta');
  for (const id of ['person:travel', 'person:travel-invite']) {
    const row = page.locator(`.hub-row[data-id="${id}"]`);
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row.locator('.hub-detail')).toHaveText('You are already in this outpost');
  }
  const selected = page.locator('.hub-row[aria-selected="true"]');
  while (await selected.getAttribute('data-id') !== 'person:travel') await search.press('ArrowDown');
  await expect(page.locator('#hub .hub-primary')).toBeDisabled();
  await search.press('Enter');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/);
});

test('while a map loads, the Travel rows say why before Enter and a fresh Home never starts on them (HUB-135)', async ({ page }) => {
  await page.goto('/?hub&lifecycle=map-loading');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: searchName });
  const selected = page.locator('.hub-row[aria-selected="true"]');
  await expect(selected).not.toHaveAttribute('aria-disabled', 'true');
  await expect(selected).not.toHaveAttribute('data-id', 'travel');
  await search.fill('travel');
  const travel = page.locator('.hub-row[data-id="travel"]');
  await expect(travel).toHaveAttribute('aria-disabled', 'true');
  await expect(travel.locator('.hub-detail')).toHaveText('Travel is unavailable while a map is loading');
  await search.fill('travel kamadan');
  const kamadan = page.locator('.hub-row[data-id="place:449"]');
  await expect(kamadan).toHaveAttribute('aria-disabled', 'true');
  await expect(kamadan.locator('.hub-detail')).toHaveText('Travel is unavailable while a map is loading');
  await expect(page.locator('#hub .hub-primary')).toBeDisabled();
  await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/);
  await expect(page.locator('#hub')).not.toContainText('Unavailable in the current game state.');
});

test('a tool that withdraws keeps the Home query and selection, and closes only its own phrase editor (HUB-051, HUB-231)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('team gom a');
  const selected = page.locator('.hub-row[aria-selected="true"]');
  await expect(selected).toContainText('GOM AFK');
  // Turning off Travel and Whispers withdraws the People source while Home shows a search.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { travelPalette: false, whispersEnabled: false } })));
  await expect(search).toHaveValue('team gom a');
  await expect(selected).toContainText('GOM AFK');
  await search.press('End'); await page.keyboard.type('fk');
  await expect(search).toHaveValue('team gom afk');
  await expect(selected).toContainText('GOM AFK');
  // A phrase editor opened for a place closes with Travel; Settings stays whatever tool changes.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { travelPalette: true } })));
  await search.fill('kamadan');
  await expect(selected).toHaveAttribute('data-id', 'place:449');
  await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  await expect(page.locator('.hub-caption')).toHaveText('Search phrase');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { buildLibrary: false } })));
  await expect(page.locator('.hub-caption')).toHaveText('Search phrase');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { travelPalette: false } })));
  await expect(page.locator('.hub-caption')).toHaveText('Home');
});

test('a Guild Hall is an outpost: no explorable label, no leaving line, and a fresh Home keeps Continue', async ({ page }) => {
  // The fixture reads the instance type as the runtime does; a Guild Hall is no Travel destination.
  await page.goto('/?hub&lifecycle=guild-hall');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.hub-context')).toHaveText('Fixture Monk · Guild Hall');
  await expect(page.locator('.hub-lifecycle')).toBeHidden();
  await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', /^place:/);
  await page.locator('.hub-search input').fill('kamadan');
  await expect(page.locator('.hub-primary')).toHaveText(/^Travel to Kamadan/);
});

test('bare whisper and trade scopes start on their first row; nothing consequential starts selected', async ({ page }) => {
  await page.goto('/?hub&party');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-incoming')));
  const search = page.locator('.hub-search input');
  const selected = page.locator('.hub-row[aria-selected="true"]');
  const primary = page.locator('.hub-primary');
  await search.pressSequentially('whisper ');
  await expect(selected).toHaveAttribute('data-id', 'friend:romi');
  await expect(selected).toContainText('Romi Ranger');
  await expect(primary).toHaveText(/^Reply to Romi Ranger/);
  await search.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Message Romi Ranger', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide Whispers', exact: true }).click();
  await page.keyboard.press('Meta+r');
  await search.fill(''); await search.pressSequentially('trade ');
  await expect(selected).toHaveAttribute('data-id', 'trade');
  await expect(primary).toHaveText(/^Open Trade Chat/);
  await expect(primary).toBeEnabled();
  // `acc ` starts on a saved account, never on an account action.
  await search.fill(''); await search.pressSequentially('acc ');
  await expect(selected).toHaveAttribute('data-id', /^account:[^:]+$/);
  await expect(primary).toHaveText(/^Choose account action/);
});

test.describe('party invite', () => {
  const invites = (page: import('@playwright/test').Page) => page.locator('#app').getAttribute('data-invites');
  test.beforeEach(async ({ page }) => {
    await page.goto('/?hub&party');
  });

  test('the fixture wires PartyInvite, and the explorable reason shows before Enter', async ({ page }) => {
    const search = page.locator('.hub-search input');
    const primary = page.locator('.hub-primary');
    const selected = page.locator('.hub-row[aria-selected="true"]');
    // Romi waits in the player's outpost: the shipped example is ready to send.
    await search.fill('invite Romi');
    await expect(selected).toContainText('Romi');
    await expect(selected).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#hub .hub-empty')).toBeHidden();
    await expect(primary).toHaveText(/^Invite Romi Ranger/);
    await expect(primary).toBeEnabled();
    await search.fill('invite Zed Delta');
    await expect(primary).toHaveText(/^Invite Zed Delta/);
    await expect(primary).toBeEnabled();
    await page.getByLabel('Lifecycle state', { exact: true }).selectOption('pve-explorable');
    for (const query of ['invite Zed Delta', 'invite Romi']) {
      await search.fill(query);
      await expect(selected).toContainText('Invite players from an outpost');
      await expect(selected).toHaveAttribute('aria-disabled', 'true');
      await expect(primary).toBeDisabled();
      await search.press('Enter');
      expect(await invites(page)).toBeNull();
      await expect(page.locator('#app')).not.toHaveAttribute('data-action', /INVITE/);
    }
    // Back in the outpost the same Enter sends exactly one invite.
    await page.getByLabel('Lifecycle state', { exact: true }).selectOption('outpost');
    await search.fill('invite Romi'); await search.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-invites', 'Romi Ranger');
    await expect(page.locator('.hub-receipt')).toHaveText('Sent /invite Romi Ranger. Guild Wars answers in chat.');
  });

  test('the invite scope invites only an exact name and names it before Enter', async ({ page }) => {
    const search = page.locator('.hub-search input');
    const primary = page.locator('.hub-primary');
    await search.fill('invite Mo Kai');
    await expect(page.locator('.hub-row').nth(0)).toContainText('Mo Kai');
    await expect(primary).toHaveText(/^Invite Mo Kai/);
    await search.press('ArrowDown');
    await expect(search).toBeFocused();
    await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Mo Kaiser');
    await expect(search).toHaveAttribute('aria-activedescendant', 'hub-result-1');
    await expect(primary).toHaveText(/^View actions/);
    await page.keyboard.press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Mo Kaiser');
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    for (const partial of ['invite a', 'invite Mo']) {
      await search.fill(partial);
      await expect(page.locator('.hub-row').last()).toContainText('Type the full character name');
      await search.press('Enter');
      expect(await invites(page)).toBeNull();
      await expect(page.locator('#hub')).toBeVisible();
      await page.getByRole('button', { name: 'Home', exact: true }).click();
    }
    await search.fill('invite Mo Kai'); await search.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-invites', /(^|\|)Mo Kai$/);
    await expect(page.locator('.hub-receipt')).toHaveText('Sent /invite Mo Kai. Guild Wars answers in chat.');
    // The receipt stands in the closed Hub's footprint, not over the window, and ends when the Hub opens again.
    const receipt = (await page.locator('.hub-receipt').boundingBox())!;
    await page.keyboard.press('Meta+r');
    const panel = (await page.locator('.hub-panel').boundingBox())!;
    expect(receipt.x).toBeGreaterThanOrEqual(panel.x);
    expect(receipt.x + receipt.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(receipt.y + receipt.height).toBeLessThanOrEqual(panel.y + panel.height);
    await expect(page.locator('.hub-receipt')).toBeHidden();
    await search.fill('zed alpha'); await search.press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Zed Alpha');
    await expect(page.locator('#hub')).not.toContainText('Sent /invite');
    await expect(page.locator('.hub-receipt')).toBeHidden();
  });

  test('a bare invite scope lists online friends, the ones invitable here first, and invites only a chosen one', async ({ page }) => {
    const search = page.locator('.hub-search input');
    await search.pressSequentially('invite ');
    await expect(page.locator('.hub-scope')).toHaveText('invite');
    const primary = page.locator('.hub-primary');
    await expect(page.locator('.hub-row', { hasText: 'Zed Alpha' })).toContainText('Zed Alpha is in Kamadan, Jewel of Istan. Use Travel and invite.');
    await expect(page.locator('.hub-row', { hasText: 'Offline Friend' })).toHaveCount(0);
    const disabled = await page.locator('.hub-row').evaluateAll(rows => rows.map(row => row.getAttribute('aria-disabled') === 'true'));
    expect(disabled).toEqual([...disabled].sort((a, b) => Number(a) - Number(b)));
    // No name was typed: nothing is preselected, and Enter sends nothing.
    await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveCount(0);
    await expect(primary).toBeDisabled();
    await search.press('Enter');
    expect(await invites(page)).toBeNull();
    await expect(page.locator('#hub')).toBeVisible();
    // A row the player chooses names its target before Enter.
    await search.press('ArrowDown');
    await expect(primary).toBeEnabled();
    await expect(primary).toHaveText(/^Invite \S+ \S+/);
    const target = (await primary.innerText()).replace(/^Invite /u, '').replace(/\s*↵$/u, '').trim();
    await page.keyboard.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-invites', target);
  });

  test('Invite to a friend in another map says why before Enter and sends nothing', async ({ page }) => {
    const search = page.locator('.hub-search input');
    await search.fill('zed alpha'); await search.press('Enter');
    // D-2: the person page keeps focus in search and moves the active descendant.
    await expect(page.locator('.hub-caption')).toHaveText('Zed Alpha');
    await expect(search).toBeFocused();
    // The footer keeps both slots and a key legend; a person page has no details to show.
    await expect(page.locator('.hub-actions')).toBeVisible();
    await expect(page.locator('.hub-actions')).toBeDisabled();
    await expect(page.locator('.hub-legend')).toHaveText('↑↓ Select⎋ Back⌘⌫ Back');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('aria-activedescendant', 'hub-result-2');
    const row = page.locator('.hub-row[aria-selected="true"]');
    await expect(row).toContainText('Invite to party');
    await expect(row).toContainText('Zed Alpha is in Kamadan, Jewel of Istan. Use Travel and invite.');
    await expect(page.locator('.hub-primary')).toBeDisabled();
    await expect(page.locator('.hub-primary')).toHaveText(/^Invite Zed Alpha/);
    // A press on the disabled primary or blank panel space keeps the keyboard in search.
    await page.locator('.hub-primary').click({ force: true });
    await expect(search).toBeFocused();
    await page.locator('.hub-count').click();
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('aria-activedescendant', 'hub-result-2');
    await page.keyboard.press('Enter');
    expect(await invites(page)).toBeNull();
  });

  test('Travel and invite travels, then sends one invite on arrival', async ({ page }) => {
    const search = page.locator('.hub-search input');
    await search.fill('zed alpha'); await search.press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Zed Alpha');
    for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowDown');
    await expect(page.locator('.hub-primary')).toHaveText(/^Travel and invite Zed Alpha/);
    await page.keyboard.press('Enter');
    await expect(page.locator('.hub-receipt')).toHaveText('Travelling to Kamadan, Jewel of Istan. Hub sends /invite Zed Alpha on arrival.');
    await expect(page.locator('#app')).toHaveAttribute('data-invites', 'Zed Alpha');
    await expect(page.locator('.hub-receipt')).toHaveText('Sent /invite Zed Alpha. Guild Wars answers in chat.');
  });

  test('a PvP outpost and an explorable area refuse invites before Enter', async ({ page }) => {
    const search = page.locator('.hub-search input');
    await search.fill('arena ace'); await search.press('Enter');
    await expect(page.locator('.hub-row[data-id="person:travel-invite"]')).toContainText('Invites from Hub need a PvE outpost');
    await page.getByLabel('Lifecycle state', { exact: true }).selectOption('pve-explorable');
    await search.fill('invite romi');
    await expect(page.locator('.hub-row').first()).toContainText('Invite players from an outpost');
    await expect(page.locator('.hub-primary')).toBeDisabled();
  });

  // HUB-242: a double-click never runs the action that its first click revealed.
  test('double-clicking a friend opens the person page and runs nothing', async ({ page }) => {
    const search = page.locator('.hub-search input');
    for (const [index, name] of ['Zed Beta', 'Zed Delta', 'Zed Gamma'].entries()) {
      await search.fill('zed');
      await page.locator('.hub-row').nth(index + 1).dblclick();
      await expect(page.locator('.hub-caption')).toHaveText(name, { timeout: 2_000 });
      await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL|INVITE/);
      await expect(search).toBeFocused();
      await page.getByRole('button', { name: 'Home', exact: true }).click();
    }
    // The Seen in chat prefix row in the invite scope: the second click lands on Invite to party.
    await search.fill('invite Mo Kai');
    await page.locator('.hub-row', { hasText: 'Seen in chat' }).first().dblclick();
    await expect(page.locator('.hub-caption')).toHaveText('Mo Kaiser');
    await expect(page.locator('#hub')).toBeVisible();
    expect(await invites(page)).toBeNull();
  });

  // D-24: a row that changes the game only selects on a click.
  test('a click only selects an invite; the footer or a double-click on it sends one', async ({ page }) => {
    const search = page.locator('.hub-search input');
    await search.fill('invite Mo Kai');
    const typed = page.locator('.hub-row').first();
    await expect(typed).toContainText('Character name');
    await search.press('ArrowDown');
    await typed.click();
    await expect(typed).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.hub-primary')).toHaveText(/^Invite Mo Kai/);
    await expect(search).toBeFocused();
    await page.waitForTimeout(600);
    expect(await invites(page)).toBeNull();
    await typed.dblclick();
    await expect(page.locator('#app')).toHaveAttribute('data-invites', 'Mo Kai');
    await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
    await search.fill('invite Mo Kai');
    await page.locator('.hub-row').first().click();
    await page.locator('.hub-primary').click();
    await expect(page.locator('#app')).toHaveAttribute('data-invites', 'Mo Kai|Mo Kai');
  });
});

test.describe('Characters: typing never switches', () => {
  const action = (page: import('@playwright/test').Page) => page.locator('#app').getAttribute('data-action');
  const card = (page: import('@playwright/test').Page, key: string) => page.locator(`button[data-character-key="${key}"]`);

  // D-5, HUB-002: a digit selects and reveals its card; only Enter switches, to the card the footer names.
  test('digits select and reveal a card, held digits repeat nothing, and Enter switches once', async ({ page }) => {
    await page.goto('/?hub');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+e');
    await expect(card(page, 'monk')).toBeFocused();
    // Card 7 is not drawn on a fresh open; its digit reveals it.
    await expect(card(page, 'warrior')).toHaveCount(0);
    await page.keyboard.press('7');
    await expect(card(page, 'warrior')).toBeFocused();
    await expect(card(page, 'warrior')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#hub .hub-primary')).toHaveText(/^Switch to Fixture Warrior/u);
    await page.keyboard.press('3');
    await expect(card(page, 'mesmer')).toBeFocused();
    // A digit with no card types nothing and switches nothing.
    await page.keyboard.press('0');
    await expect(card(page, 'mesmer')).toBeFocused();
    await expect(page.locator('#character-switch-query')).toHaveValue('');
    for (let press = 0; press < 6; press++) await page.keyboard.down('2');
    await page.keyboard.up('2');
    await expect(card(page, 'ranger')).toBeFocused();
    await expect(page.locator('#character-switch-query')).toHaveValue('');
    expect(await action(page)).toBeNull();
    await expect(page.locator('#hub .hub-primary')).toHaveText(/^Switch to Fixture Ranger/u);
    await page.keyboard.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'Character ranger');
  });

  test('a digit typed after a resume selects a card, and the rest searches', async ({ page }) => {
    await page.goto('/?hub');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+e');
    await expect(card(page, 'monk')).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('#hub')).toBeHidden();
    await page.keyboard.press('Meta+r');
    await expect(page.locator('.hub-caption')).toHaveText('Characters');
    await page.keyboard.type('2p in g');
    await expect(page.locator('#character-switch-query')).toHaveValue('p in g');
    expect(await action(page)).toBeNull();
  });

  // HUB-009: a closed search never picks the card on the next open.
  test('reopening Characters focuses the current character after any close', async ({ page }) => {
    await page.goto('/?hub');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');
    const closes: [string, (page: import('@playwright/test').Page) => Promise<void>][] = [
      ['Escape', async page => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); }],
      ['the close button', page => page.getByRole('button', { name: 'Close Hub', exact: true }).click()],
    ];
    for (const [name, close] of closes) {
      await page.keyboard.press('Meta+e');
      await expect(card(page, 'monk')).toBeFocused();
      await page.keyboard.type('toe');
      await expect(card(page, 'toefte')).toBeVisible();
      await close(page);
      await expect(page.locator('#hub'), name).toBeHidden();
      await page.keyboard.press('Meta+e');
      await expect(card(page, 'monk'), name).toBeFocused();
      await expect(card(page, 'monk')).toHaveAttribute('aria-current', 'true');
      await page.keyboard.press('Escape');
      await expect(page.locator('#hub')).toBeHidden();
    }
    expect(await action(page)).toBeNull();
  });

  // HUB-033: a prefix that names several characters opens the cards on the top hit.
  test('an ambiguous char prefix opens Characters on the top hit and switches nothing', async ({ page }) => {
    await page.goto('/?hub');
    const search = page.locator('.hub-search input');
    await search.fill('char fixture r');
    await expect(page.locator('.hub-primary')).toHaveText(/^Show Fixture Ranger in Characters/u);
    await search.press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Characters');
    await expect(card(page, 'ranger')).toBeFocused();
    expect(await action(page)).toBeNull();
    await page.keyboard.press('Meta+Backspace');
    await expect(search).toHaveValue('char fixture r');
    // An exact name or the sole match still switches directly.
    await search.fill('char toe');
    await expect(page.locator('.hub-primary')).toHaveText(/^Switch to Toefte/u);
    await search.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'Character toefte');
  });

  // HUB-073: a state that refuses switching says so on open, in plain words, and Enter asks nothing.
  test('loading and PvP refusals show on Characters and char rows before Enter and switch nothing (HUB-073)', async ({ page }) => {
    for (const [lifecycle, reason] of [['map-loading', 'Wait until Guild Wars finishes loading, then try again.'], ['pvp-explorable', 'Character switching is unavailable during active PvP.']] as const) {
      await page.goto(`/?hub&lifecycle=${lifecycle}`);
      await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
      const search = page.locator('.hub-search input');
      await search.fill('char toefte');
      const row = page.locator('.hub-row[data-id="character:toefte"]');
      await expect(row).toHaveAttribute('aria-disabled', 'true');
      await expect(row.locator('.hub-detail')).toHaveText(reason);
      await search.press('Escape');
      await page.keyboard.press('Meta+e');
      await expect(page.locator('.character-switch-status')).toHaveText(reason);
      await expect(card(page, 'monk')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(card(page, 'ranger')).toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('#hub .hub-primary')).toBeDisabled();
      await page.keyboard.press('Enter');
      expect(await action(page)).toBeNull();
      await expect(page.locator('#app')).toHaveAttribute('data-character-requests', '0');
      await expect(page.locator('#hub')).not.toContainText('(game-loading)');
      await expect(page.locator('.character-switch-details')).toBeHidden();
    }
  });

  // D-30, HUB-193: a running switch covers the game with one quiet line, absorbs clicks, and answers a second request.
  test('a running switch shows its veil, keeps clicks from the game, and says a switch is running', async ({ page }) => {
    await page.goto('/?hub&switch-fail=selector-timeout&switch-ms=4000');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const search = page.locator('.hub-search input');
    await search.fill('char toefte'); await search.press('Enter');
    const veil = page.locator('.character-switch-veil');
    await expect(veil).toHaveText('Switching to Toefte…');
    await expect(veil.locator('button, a, input, [tabindex]')).toHaveCount(0);
    await page.evaluate(() => window.gwFixtureCanvas?.clear());
    await page.mouse.click(300, 300);
    expect(await page.evaluate(() => window.gwFixtureCanvas?.events.filter(event => event.type !== 'keydown' && event.type !== 'keyup').length)).toBe(0);
    for (const route of ['shortcut', 'sw'] as const) {
      if (route === 'shortcut') await page.keyboard.press('Meta+e');
      else { await page.keyboard.press('Meta+r'); await search.fill('sw'); await search.press('Enter'); }
      await expect(page.locator('.hub-receipt')).toHaveText('A character switch is already running.');
      await expect(page.locator('#app')).toHaveAttribute('data-action', 'Character toefte');
      await expect(page.locator('#app')).toHaveAttribute('data-character-requests', '1');
    }
    await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
    await expect(veil).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('.hub-receipt')).toHaveText('Switch to Toefte stopped. Automatic switching stopped. Continue from the Guild Wars character selector.');
    await expect(page.locator('#app')).toHaveAttribute('data-action', 'Character toefte');
  });

  // HUB-197, HUB-195, HUB-194: search keeps the chosen card; badges and profession pairs read true.
  test('clearing, spacing or pasting in the search keeps the chosen card, and cards show their profession pair', async ({ page }) => {
    await page.goto('/?hub&characters-extra');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+e');
    await page.keyboard.press('3');
    await expect(card(page, 'mesmer')).toBeFocused();
    await page.keyboard.type('fix');
    const query = page.locator('#character-switch-query');
    await expect(query).toHaveValue('fix');
    await expect(card(page, 'mesmer')).toHaveAttribute('aria-selected', 'true');
    await query.press('Space');
    await expect(card(page, 'mesmer')).toHaveAttribute('aria-selected', 'true');
    await query.fill('');
    await expect(card(page, 'mesmer')).toHaveAttribute('aria-selected', 'true');
    await query.fill('toe');
    await expect(card(page, 'toefte')).toHaveAttribute('aria-selected', 'true');
    // A search hides the number badges instead of drawing empty squares.
    await expect(card(page, 'toefte').locator('.character-switch-key')).toBeHidden();
    await expect(card(page, 'toefte').locator('.character-switch-meta')).toContainText('Mo/Me');
    await query.fill('');
    await card(page, 'mesmer').focus();
    await page.keyboard.press('End');
    const last = card(page, 'extra-5');
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(last.locator('.character-switch-key')).toBeHidden();
    await expect(last.locator('.character-switch-meta')).toContainText('Mo/Me · PvP');
    for (const enabled of [false, true]) {
      await page.getByRole('button', { name: 'Character Switch settings', exact: true }).click();
      await page.locator('#character-switch-show-profession').setChecked(enabled);
      await page.getByRole('button', { name: 'Character Switch settings', exact: true }).click();
      if (enabled) await expect(last.locator('.character-switch-meta')).toContainText('Mo/Me · PvP');
      else await expect(last.locator('.character-switch-meta')).not.toContainText(/Mo|Me|PvP/);
    }
    await expect(page.locator('.character-switch-key:empty:visible')).toHaveCount(0);
    expect(await action(page)).toBeNull();
  });

  // HUB-076: a narrow Hub shows fewer, wider cards instead of five squeezed ones.
  test('a narrow Hub shows at most three cards, each at least 100 px wide', async ({ page }) => {
    for (const width of [340, 380, 420]) {
      await page.goto('/?hub');
      await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
      await page.getByRole('button', { name: 'Lock Hub position', exact: true }).click();
      const grip = page.getByRole('button', { name: 'Resize Hub', exact: true });
      const corner = (await grip.boundingBox())!;
      const hub = (await page.locator('.hub-panel').boundingBox())!;
      await page.mouse.move(corner.x + 5, corner.y + 5);
      await page.mouse.down();
      await page.mouse.move(corner.x + 5 + width - hub.width, corner.y + 5 + 380 - hub.height, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => (await page.locator('.hub-panel').boundingBox())?.width).toBe(width);
      await page.keyboard.press('Meta+e');
      await expect(card(page, 'monk')).toBeFocused();
      const bounds = await page.locator('#character-switch-list button[data-row]').evaluateAll(cards => cards.map(card => {
        const { left, right, top, bottom, width } = card.getBoundingClientRect();
        return { left, right, top, bottom, width };
      }));
      expect(bounds.length).toBeGreaterThan(0);
      expect(bounds.length).toBeLessThanOrEqual(3);
      for (const bound of bounds) expect(bound.width).toBeGreaterThanOrEqual(100);
      for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i]!, b = bounds[j]!;
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
      }
    }
  });

  // HUB-198, HUB-199: one name, no unsaved search toggle.
  test('Characters shows one name and keeps no unsaved search setting', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 396 });
    await page.goto('/?hub');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+e');
    await expect(page.locator('.hub-caption')).toHaveText('Characters');
    await expect(page.locator('#character-switch-title')).toHaveClass(/ui-sr-only/);
    await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-character-refusal')));
    await expect(page.locator('.character-switch-status')).toHaveText('This character is already active.');
    await card(page, 'monk').press('ArrowRight');
    await expect(page.locator('.character-switch-status')).toBeEmpty();
    const band = await page.locator('.character-switch-panel').evaluate(panel => {
      const cards = panel.querySelector('.character-switch-carousel')!.getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      return bounds.bottom - cards.bottom;
    });
    expect(band).toBeLessThanOrEqual(48);

    await page.getByRole('button', { name: 'Character Switch settings', exact: true }).click();
    await expect(page.getByText('Show search bar')).toHaveCount(0);
  });

  // HUB-034, HUB-075: the confirmation names the character; Stay returns to the row that asked.
  test('Leave this area names the character, and Stay returns to the search that asked', async ({ page }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({width, height: 700});
      await page.goto('/?hub&lifecycle=pve-explorable');
      const search = page.locator('.hub-search input');
      for (const cancel of ['Stay here', 'Escape'] as const) {
        await search.fill('char toefte'); await search.press('Enter');
        const question = page.getByRole('heading', {name: 'Leave this area and switch to Toefte?', exact: true});
        await expect(question).toBeVisible();
        if (cancel === 'Stay here') await page.screenshot({path: test.info().outputPath(`character-confirm-${width}.png`)});
        const leave = page.getByRole('button', { name: 'Leave and switch to Toefte', exact: true });
        await expect(leave).toHaveAttribute('data-variant', 'danger');
        await expect(page.locator('#character-switch-stay')).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(leave).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        if (cancel === 'Stay here') await page.keyboard.press('Enter'); else await page.keyboard.press('Escape');
        await expect(page.locator('.hub-caption')).toHaveText('Home');
        await expect(search).toHaveValue('char toefte');
        await expect(search).toBeFocused();
        expect(await action(page)).toBeNull();
      }
    }
  });
});

// D-5, HUB-003: a Travel digit selects its favourite; a held digit repeats nothing.
test('Travel keeps selection under a still pointer and changes it only on real movement (HUB-012)', async ({ page }) => {
  await page.goto('/?hub');
  await page.mouse.move(0, 0);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Meta+t');
  const search = page.locator('#travel-search-input');
  const eye = page.locator('#travel-favorite-4');
  await expect(search).toBeFocused();
  const box = await eye.boundingBox();
  if (!box) throw new Error('Expected a painted favourite');
  await page.mouse.move(box.x + 10, box.y + 10);
  await expect(search).toHaveAttribute('aria-activedescendant', 'travel-favorite-4');
  await search.press('Home');
  await expect(search).toHaveAttribute('aria-activedescendant', 'travel-recent-449');
  await page.mouse.wheel(0, 120);
  await page.mouse.move(box.x + 10, box.y + 10);
  await expect(search).toHaveAttribute('aria-activedescendant', 'travel-recent-449');
  await page.mouse.move(box.x + 11, box.y + 10);
  await expect(search).toHaveAttribute('aria-activedescendant', 'travel-favorite-4');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.mouse.move(box.x + 11, box.y + 10);
  await page.keyboard.press('Meta+t');
  await expect(search).toHaveAttribute('aria-activedescendant', 'travel-recent-449');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/);
  await search.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'TRAVEL Kamadan, Jewel of Istan');
  await expect(page.locator('#hub')).toBeHidden();
  for (const [query, deltaX, deltaY, selected, destination] of [
    ['', 250, 0, 'travel-recent-449', 'Kamadan, Jewel of Istan'],
    ['a', 0, 120, 'travel-map-109', 'The Amnoon Oasis'],
  ] as const) {
    await page.goto('/?hub');
    await page.mouse.move(0, 0);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Meta+t');
    await search.fill(query);
    const target = page.locator(query ? '.travel-result' : '.travel-recent').first();
    const bounds = (await target.boundingBox())!;
    await page.mouse.move(bounds.x + 10, bounds.y + 10);
    if (query) {
      const amnoon = await page.locator('.travel-result:not([disabled])').evaluateAll(rows => rows.findIndex(row => row.id === 'travel-map-109'));
      expect(amnoon).toBeGreaterThanOrEqual(0);
      await search.press('Home');
      for (let step = 0; step <= amnoon; step++) await search.press('ArrowDown');
    }
    await search.press(query ? 'ArrowUp' : 'ArrowLeft');
    await expect(search).toHaveAttribute('aria-activedescendant', selected);
    const scroller = page.locator(query ? '#travel-results-panel' : '.travel-history .travel-recent-grid');
    const before = await scroller.evaluate((element, horizontal) => horizontal ? element.scrollLeft : element.scrollTop, deltaX > 0);
    await page.mouse.wheel(deltaX, deltaY);
    await expect.poll(() => scroller.evaluate((element, horizontal) => horizontal ? element.scrollLeft : element.scrollTop, deltaX > 0)).toBeGreaterThan(before);
    await expect(search).toHaveAttribute('aria-activedescendant', selected);
    await expect(page.locator(`#${selected}`)).toHaveAttribute(query ? 'aria-selected' : 'data-active', 'true');
    await search.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-action', `TRAVEL ${destination}`);
    await expect(page.locator('#hub')).toBeHidden();
  }
});

test('Travel favourite arrows follow the painted columns and hold at the ends (HUB-069)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Meta+t');
  const search = page.locator('#travel-search-input');
  await expect(search).toBeFocused();
  for (const [width, destination] of [[1280, 'travel-favorite-3'], [500, 'travel-favorite-2']] as const) {
    await page.setViewportSize({ width, height: 900 });
    await search.press('1');
    await expect(search).toHaveAttribute('aria-activedescendant', 'travel-favorite-0');
    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', destination);
    await search.press('End');
    await expect(search).toHaveAttribute('aria-activedescendant', 'travel-favorite-5');
    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', 'travel-favorite-5');
    await search.press('Home');
    const first = await search.getAttribute('aria-activedescendant');
    await search.press('ArrowUp');
    await expect(search).toHaveAttribute('aria-activedescendant', first!);
    await expect(search).toBeFocused();
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/);
  }
});

test('a Travel number key selects its favourite, a held one repeats nothing, and only Enter travels', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+t');
  const travelSearch = page.locator('#travel-search-input');
  await expect(travelSearch).toBeFocused();
  for (let press = 0; press < 6; press++) await page.keyboard.down('1');
  await page.keyboard.up('1');
  const favourite = page.locator('#travel-favorite-0');
  await expect(favourite).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#hub .hub-primary')).toHaveText(/^Travel to Ascalon City/u);
  await expect(page.locator('.hub-caption')).toHaveText('Travel');
  await expect(travelSearch).toHaveValue('');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/u);
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'TRAVEL Ascalon City');
  await expect(page.locator('#hub')).toBeHidden();
});

// HUB-130: a held Enter activates a surface control once; its repeats never toggle it back.
test('holding Enter on Trade\'s Save offer or Follow player toggles once', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  const trade = page.locator('#toolbox-trade .trade-window');
  await expect(trade).toBeVisible();
  await trade.locator('.trade-row', { hasText: 'Quiet Ember' }).locator('.offer-cell').click();
  const hold = async (name: string) => {
    await trade.locator('.offer-actions summary').click();
    await trade.getByRole('menuitemcheckbox', { name }).focus();
    for (let press = 0; press < 6; press++) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await trade.locator('.offer-actions summary').click();
    await expect(trade.getByRole('menuitemcheckbox', { name })).toHaveAttribute('aria-checked', 'true');
    await trade.locator('.offer-actions summary').click();
  };
  await hold('Save offer');
  await expect(trade.locator('.saved-count')).toHaveText('1');
  await hold('Follow player');
  await expect(trade.locator('.saved-count')).toHaveText('2');
});


test('a stored place phrase resolves in Home, its travel scope and detailed Travel without moving its data (HUB-061)', async ({ page }) => {
  const stored = [{ id: 'place:194', phrase: 'home', pinned: true }];
  await page.addInitScript(value => localStorage.setItem('hub-fixture-shortcuts', JSON.stringify(value)), stored);
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: searchName });
  for (const query of ['home', 'travel home']) {
    await search.fill(query);
    await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'place:194');
    await expect(page.locator('.hub-primary')).toContainText('Travel to Kaineng Center');
  }
  await page.keyboard.press('Meta+t');
  const destination = page.getByRole('combobox', { name: 'Destination, phrase, or friend' });
  await destination.fill('home');
  await expect(destination).toHaveAttribute('aria-activedescendant', 'travel-map-194');
  await expect(page.locator('.hub-primary')).toContainText('Travel to Kaineng Center');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('hub-fixture-shortcuts')) ?? 'null')).toEqual(stored);
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL/);
});


test('editing a phrase preserves pin order and a delayed save cannot navigate a later page', async ({ page }) => {
  const stored = [{ id: 'maps', phrase: '', pinned: true }, { id: 'travel', phrase: '', pinned: true }];
  await page.addInitScript(value => localStorage.setItem('hub-fixture-shortcuts', JSON.stringify(value)), stored);
  await page.goto('/?hub&settings-ms=700');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('maps');
  await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill('my map'); await phrase.press('Enter');
  await page.keyboard.press('Meta+Backspace');
  await search.fill('commands'); await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Commands');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hub-fixture-shortcuts') ?? '[]'))).toEqual([{ id: 'maps', phrase: 'my map', pinned: true }, stored[1]]);
  await expect(page.locator('.hub-caption')).toHaveText('Commands');
  await expect(page.locator('#hub input[role=combobox]')).toBeFocused();
});


test('pins keep each storage owner limit and preserve unresolved references while another owner changes (HUB-090)', async ({ page }) => {
  const global = [{ id: 'maps', phrase: '', pinned: true }, ...Array.from({ length: 63 }, (_, index) => ({ id: `place:${10000 + index}`, phrase: '', pinned: true }))];
  await page.addInitScript(value => localStorage.setItem('hub-fixture-shortcuts', JSON.stringify(value)), global);
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('team gom afk'); await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: 'Pin to Hub' }).click();
  await expect(page.locator('#hub .hub-status')).toHaveText('Pinned GOM AFK.');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('hub-fixture-shortcuts')) ?? 'null')).toEqual(global);
  await search.fill('maps'); await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill('my map'); await phrase.press('Enter');
  await expect(page.locator('#hub .hub-status')).toHaveText('“my map” now finds Maps.');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('hub-fixture-shortcuts')) ?? 'null')).toEqual([{ id: 'maps', phrase: 'my map', pinned: true }, ...global.slice(1)]);
});


test('existing global and Travel phrases that name different places require a choice everywhere (HUB-061)', async ({page}) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Meta+t');
  await page.getByRole('button', {name: 'Customize Travel', exact: true}).click();
  await page.getByRole('button', {name: '+ Add phrase', exact: true}).click();
  await page.locator('#travel-new-phrase').fill('home');
  const picker = page.locator('.travel-add-phrase details');
  await picker.locator('summary').click();
  await expect(picker.getByRole('combobox')).toBeFocused();
  await picker.getByRole('combobox').fill('kamadan');
  await picker.getByRole('option', {name: /Kamadan, Jewel of Istan/}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.locator('#travel-search-input')).toHaveValue('home');
  const stored = [{id: 'place:194', phrase: 'home', pinned: true}];
  // Simulate an older app's separate global store arriving, without editing either phrase.
  await page.evaluate(async stored => {await window.gwNative.settings.set({hubShortcuts: stored});}, stored);
  await page.keyboard.press('Meta+Backspace');
  const search = page.locator('.hub-search input');
  for (const query of ['home', 'travel home']) {
    await search.fill(query);
    await expect(page.locator('.hub-row[data-id="place:194"]')).toBeVisible();
    await expect(page.locator('.hub-row[data-id="place:449"]')).toBeVisible();
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveCount(0);
    await search.press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Home');
    expect(await page.locator('#app').getAttribute('data-action')).toBeNull();
  }
  await page.keyboard.press('Meta+t');
  const destination = page.locator('#travel-search-input');
  await destination.fill('home');
  await expect(destination).not.toHaveAttribute('aria-activedescendant', /.+/);
  await destination.press('Enter');
  expect(await page.locator('#app').getAttribute('data-action')).toBeNull();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('hub-fixture-shortcuts')) ?? 'null')).toEqual(stored);
});
