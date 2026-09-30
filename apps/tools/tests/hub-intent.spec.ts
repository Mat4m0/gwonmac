import { expect, test } from '@playwright/test';

const searchName = 'Search people, places, builds';
test('character entry is card-first and Back restores the launching result', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
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
  const search = page.getByRole('combobox', { name: searchName });
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

test('temporary blur resumes the stage and focus while explicit close starts fresh', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
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
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build monk'); await search.press('ArrowDown');
  await page.keyboard.press('Meta+a'); await expect(search).toBeFocused();
  await page.keyboard.type('sw'); await expect(search).toHaveValue('sw');
  await search.press('ArrowDown'); await page.keyboard.type('itch');
  await expect(search).toHaveValue('switch');
});

test('Travel and Settings restore their own state after a temporary hide', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
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
  await page.getByRole('button', { name: 'Unlock Hub position', exact: true }).click();
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).press('Alt+ArrowRight');
  await page.getByRole('button', { name: 'Resize Hub', exact: true }).press('ArrowLeft');
  const placed = (await panel.boundingBox())!;
  await page.reload();
  const restored = (await panel.boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(restored[key] - placed[key])).toBeLessThanOrEqual(1);
  await expect(panel).toHaveAttribute('data-locked', 'true');
  await page.setViewportSize({ width: 360, height: 500 });
  await expect(page.getByRole('button', { name: 'Close Hub', exact: true })).toBeInViewport();
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Hub position', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('gwonmac.hub-window-placement'))).toBeNull();
  await page.reload(); await expect(panel).not.toHaveAttribute('style', /transform: none/);
});

test('held Enter cannot activate a newly entered target page', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build monk');
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Apply to me');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
});

test('a modified Enter never runs the primary; only a plain Enter does', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build smiter'); await search.press('Enter');
  await expect(page.locator('.hub-primary')).toHaveText(/^Apply Smiter to Fixture Monk/);
  for (const chord of ['Meta+Enter', 'Control+Enter', 'Alt+Enter']) {
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
  await travel.press('Meta+Enter');
  await page.waitForTimeout(700);
  await expect(page.locator('#hub')).toBeVisible();
  await expect(travel).toBeFocused();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /travel/i);
});


test('held Enter on footer actions and Backspace in ordinary fields keep their scope', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
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
  const search = page.getByRole('combobox', { name: searchName });
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
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('team gom afk');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill('invite x'); await phrase.press('Enter');
  await expect(page.locator('.hub-view [role="status"]')).toHaveText('Choose a unique phrase. Command words are reserved.');
  await phrase.fill('gom night'); await phrase.press('Enter');
  await expect(page.locator('.hub-view [role="status"]')).toHaveText('Saved');
});

test('a bare travel scope in an explorable area selects Browse travel, so Enter never leaves the area', async ({ page }) => {
  await page.goto('/?hub&lifecycle=pve-explorable');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.getByRole('combobox', { name: searchName });
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
  const search = page.getByRole('combobox', { name: searchName });
  // D-13: recent places stay listed, but none is the default.
  await expect(page.locator('.hub-row[data-id^="place:"]').first()).toBeVisible();
  await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', 'travel');
  await expect(page.locator('.hub-primary')).toHaveText(/^Browse travel/);
  // D-26: the header names the area and one quiet line names what it holds back.
  await expect(page.locator('.hub-context')).toHaveText('Fixture Monk · Explorable area');
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

test('a Guild Hall is an outpost: no explorable label, no leaving line, and a fresh Home keeps Continue', async ({ page }) => {
  // The fixture reads the instance type as the runtime does; a Guild Hall is no Travel destination.
  await page.goto('/?hub&lifecycle=guild-hall');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.hub-context')).toHaveText('Fixture Monk · Guild Hall');
  await expect(page.locator('.hub-lifecycle')).toBeHidden();
  await expect(page.locator('.hub-row[aria-selected="true"]')).toHaveAttribute('data-id', /^place:/);
  await page.getByRole('combobox', { name: searchName }).fill('kamadan');
  await expect(page.locator('.hub-primary')).toHaveText(/^Travel to Kamadan/);
});

test('bare whisper and trade scopes start on their first row; nothing consequential starts selected', async ({ page }) => {
  await page.goto('/?hub&party');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-incoming')));
  const search = page.getByRole('combobox', { name: searchName });
  const selected = page.locator('.hub-row[aria-selected="true"]');
  const primary = page.locator('.hub-primary');
  await search.pressSequentially('whisper ');
  await expect(selected).toHaveAttribute('data-id', /^person:/);
  await expect(selected).toContainText('Romi Ranger');
  await expect(primary).toHaveText(/^View actions/);
  await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Romi Ranger');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
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
    const search = page.getByRole('combobox', { name: searchName });
    const primary = page.locator('.hub-primary');
    const selected = page.locator('.hub-row[aria-selected="true"]');
    // Romi waits in the player's outpost: the shipped example is ready to send.
    await search.fill('invite Romi');
    await expect(selected).toContainText('Romi');
    await expect(selected).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#hub')).not.toContainText('No matches');
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
    const search = page.getByRole('combobox', { name: searchName });
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
    const search = page.getByRole('combobox', { name: searchName });
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
    const search = page.getByRole('combobox', { name: searchName });
    await search.fill('zed alpha'); await search.press('Enter');
    // D-2: the person page keeps focus in search and moves the active descendant.
    await expect(page.locator('.hub-caption')).toHaveText('Zed Alpha');
    await expect(search).toBeFocused();
    // The footer keeps both slots and a key legend; a person page has no details to show.
    await expect(page.locator('.hub-actions')).toBeVisible();
    await expect(page.locator('.hub-actions')).toBeDisabled();
    await expect(page.locator('.hub-legend')).toHaveText('↑↓ SelectEsc Back⌘⌫ Back');
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
    const search = page.getByRole('combobox', { name: searchName });
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
    const search = page.getByRole('combobox', { name: searchName });
    await search.fill('arena ace'); await search.press('Enter');
    await expect(page.locator('.hub-row[data-id="person:travel-invite"]')).toContainText('Invites from Hub need a PvE outpost');
    await page.getByLabel('Lifecycle state', { exact: true }).selectOption('pve-explorable');
    await search.fill('invite romi');
    await expect(page.locator('.hub-row').first()).toContainText('Invite players from an outpost');
    await expect(page.locator('.hub-primary')).toBeDisabled();
  });

  // HUB-242: a double-click never runs the action that its first click revealed.
  test('double-clicking a friend opens the person page and runs nothing', async ({ page }) => {
    const search = page.getByRole('combobox', { name: searchName });
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
    const search = page.getByRole('combobox', { name: searchName });
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
    const search = page.getByRole('combobox', { name: searchName });
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

  // HUB-034, HUB-075: the confirmation names the character; Stay returns to the row that asked.
  test('Leave this area names the character, and Stay returns to the search that asked', async ({ page }) => {
    await page.goto('/?hub&lifecycle=pve-explorable');
    const search = page.getByRole('combobox', { name: searchName });
    for (const cancel of ['Stay here', 'Escape'] as const) {
      await search.fill('char toefte'); await search.press('Enter');
      await expect(page.locator('#character-switch-title')).toHaveText('Leave this area and switch to Toefte?');
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
  });
});

// D-5, HUB-003: a Travel digit selects its favourite; a held digit repeats nothing.
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
  await trade.locator('.offer-actions summary').click();
  const hold = async (name: RegExp) => {
    await trade.getByRole('button', { name }).focus();
    for (let press = 0; press < 6; press++) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
  };
  await hold(/^Save offer$/u);
  await expect(trade.getByRole('button', { name: /^Saved$/u })).toHaveAttribute('aria-pressed', 'true');
  await expect(trade.locator('.saved-count')).toHaveText('1');
  await hold(/^Follow player$/u);
  await expect(trade.getByRole('button', { name: /^Following$/u })).toHaveAttribute('aria-pressed', 'true');
  await expect(trade.locator('.saved-count')).toHaveText('2');
});
