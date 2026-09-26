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
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
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
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Close');
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


test('held Enter on footer actions and Backspace in ordinary fields keep their scope', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('build monk'); await search.press('Enter');
  const apply = page.getByRole('button', { name: 'Apply to me ↵', exact: true });
  await apply.focus();
  expect(await apply.evaluate(button => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })))).toBe(false);
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('team gom afk');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('option', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill(''); await phrase.press('Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Search phrase');
  await expect(phrase).toBeFocused();
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
  // HUB-060: two pins keep the Home default on the first pin, named in the footer.
  await expect(page.locator('.hub-row').nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.hub-primary')).toHaveText(/^Open Whispers/);
  await search.pressSequentially('invite ');
  await expect(page.locator('.hub-hint')).toContainText('invite Romi');
  await expect(page.locator('.hub-row[data-id="whispers"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('hub-fixture-shortcuts'))).toBe(legacy);
});

test('the phrase editor refuses a new phrase that starts with a scope word', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: searchName });
  await search.fill('team gom afk');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('option', { name: /Set search phrase/ }).click();
  const phrase = page.getByRole('textbox', { name: 'Search phrase', exact: true });
  await phrase.fill('invite x'); await phrase.press('Enter');
  await expect(page.locator('.hub-view [role="status"]')).toHaveText('Choose a unique phrase. Command words are reserved.');
  await phrase.fill('gom night'); await phrase.press('Enter');
  await expect(page.locator('.hub-view [role="status"]')).toHaveText('Saved');
});

test.describe('party invite', () => {
  const invites = (page: import('@playwright/test').Page) => page.locator('#app').getAttribute('data-invites');
  test.beforeEach(async ({ page }) => {
    await page.goto('/?hub');
    await page.getByLabel('Fixture scenario', { exact: true }).selectOption('party');
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
  });

  test('Invite to a friend in another map says why before Enter and sends nothing', async ({ page }) => {
    const search = page.getByRole('combobox', { name: searchName });
    await search.fill('romi'); await search.press('Enter');
    // D-2: the person page keeps focus in search and moves the active descendant.
    await expect(page.locator('.hub-caption')).toHaveText('Romi Ranger');
    await expect(search).toBeFocused();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('aria-activedescendant', 'hub-result-2');
    const row = page.locator('.hub-row[aria-selected="true"]');
    await expect(row).toContainText('Invite to party');
    await expect(row).toContainText('Romi Ranger is in Kamadan, Jewel of Istan. Use Travel and invite.');
    await expect(page.locator('.hub-primary')).toBeDisabled();
    await expect(page.locator('.hub-primary')).toHaveText(/^Invite Romi Ranger/);
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
    await search.fill('romi'); await search.press('Enter');
    for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowDown');
    await expect(page.locator('.hub-primary')).toHaveText(/^Travel and invite Romi Ranger/);
    await page.keyboard.press('Enter');
    await expect(page.locator('.hub-receipt')).toHaveText('Travelling to Kamadan, Jewel of Istan. Hub sends /invite Romi Ranger on arrival.');
    await expect(page.locator('#app')).toHaveAttribute('data-invites', 'Romi Ranger');
    await expect(page.locator('.hub-receipt')).toHaveText('Sent /invite Romi Ranger. Guild Wars answers in chat.');
  });

  test('a PvP outpost and an explorable area refuse invites before Enter', async ({ page }) => {
    const search = page.getByRole('combobox', { name: searchName });
    await search.fill('arena ace'); await search.press('Enter');
    await expect(page.locator('.hub-row[data-id="person:travel-invite"]')).toContainText('Invites from Hub need a PvE outpost');
    await page.getByLabel('Fixture scenario', { exact: true }).selectOption('explorable');
    await search.fill('invite romi');
    await expect(page.locator('.hub-row').first()).toContainText('Invite players from an outpost');
    await expect(page.locator('.hub-primary')).toBeDisabled();
  });

  // HUB-242: a double-click runs the action that its first click revealed. The pointer
  // owner fixes it for every page; until then this documents the open P0.
  test('double-clicking a friend opens the person page and runs nothing', async ({ page }) => {
    test.fail(true, 'HUB-242: the shared pointer owner has not landed');
    const search = page.getByRole('combobox', { name: searchName });
    for (const [index, name] of ['Zed Beta', 'Zed Delta', 'Zed Gamma'].entries()) {
      await search.fill('zed');
      await page.locator('.hub-row').nth(index + 1).dblclick();
      await expect(page.locator('.hub-caption')).toHaveText(name, { timeout: 2_000 });
      await expect(page.locator('#app')).not.toHaveAttribute('data-action', /TRAVEL|INVITE/);
      await page.getByRole('button', { name: 'Home', exact: true }).click();
    }
  });
});
