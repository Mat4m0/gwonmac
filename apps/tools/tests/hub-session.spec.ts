import { expect, test, type Page } from '@playwright/test';

/**
 * Async actions belong to the Hub page that started them (HUB-004, HUB-016, HUB-083,
 * HUB-035). While that page shows, the footer and the status line name the running action,
 * and nothing starts a second one. Typing, a page change or closing ends the page session:
 * a late completion then reports a receipt and never closes, navigates or wipes the newer
 * page; a late failure is a named failure receipt that also waits for the next opening.
 * `?slow-apply` lands each fixture command after half a second on the real confirmation clock.
 */
const searchName = 'Search people, places, builds';
const search = (page: Page) => page.getByRole('combobox', { name: searchName });
const hub = (page: Page) => page.getByRole('dialog', { name: 'Hub', exact: true });
const status = (page: Page) => page.locator('.hub-status');
const receipt = (page: Page) => page.locator('.hub-receipt');
const primary = (page: Page) => page.locator('.hub-primary');
const actions = (page: Page) => page.evaluate(() => window.gwFixtureActions.filter(action => !action.startsWith('command:')));
const keydowns = (page: Page) => page.evaluate(() => window.gwFixtureCanvas?.events.filter(event => event.type === 'keydown').length ?? 0);

async function open(page: Page, query: string) {
  await page.goto(`/?hub${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => { localStorage.removeItem('hub-fixture-library'); window.gwFixtureCanvas?.clear(); });
}
async function enter(page: Page, query: string) { await search(page).fill(query); await search(page).press('Enter'); }

test('a late invite completion never closes or wipes the reopened Hub (PPL-16)', async ({ page }) => {
  await open(page, '&party&invite-ms=1500');
  await enter(page, 'invite Zed Delta');
  await expect(primary(page)).toHaveText('Inviting Zed Delta…');
  await expect(primary(page)).toBeDisabled();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(hub(page)).toBeHidden();
  await page.keyboard.press('Meta+r');
  await expect(hub(page)).toBeVisible();
  await page.evaluate(() => window.gwFixtureCanvas?.clear());
  await page.keyboard.type('travel kam');
  // The reopened page is usable at once: the late invite no longer holds its primary.
  await expect(primary(page)).toBeEnabled();
  await expect(status(page)).toHaveText('Sent /invite Zed Delta. Guild Wars answers in chat.');
  await expect(hub(page)).toBeVisible();
  await expect(search(page)).toHaveValue('travel kam');
  await expect(search(page)).toBeFocused();
  await expect(primary(page)).toBeEnabled();
  expect(await keydowns(page)).toBe(0);
  expect(await actions(page)).toEqual(['PARTY.INVITE Zed Delta']);
});

test('a team apply that completes while the player types keeps the Hub, the query and the focus (BLD-01)', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, '&slow-apply');
  await page.keyboard.press('Escape');
  await expect(hub(page)).toBeHidden();
  await page.locator('#canvas').focus();
  await page.keyboard.press('Meta+r');
  await expect(search(page)).toBeFocused();
  await page.evaluate(() => window.gwFixtureCanvas?.clear());
  await page.keyboard.type('team gom afk'); await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(/^Applying GOM AFK… \d+\/16$/);
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Backspace');
  // Type slowly through the apply's completion, then the rest of the query past it.
  const query = 'travel kamadan 12345678';
  let landed = -1;
  for (const [index, character] of [...query].entries()) {
    await page.keyboard.type(character);
    if (landed < 0 && await status(page).textContent() === 'GOM AFK applied.') landed = index;
    if (landed < 0) await page.waitForTimeout(900);
  }
  // The receipt landed while the player was still typing, and the keys after it kept it.
  expect(landed).toBeGreaterThan(0);
  expect(landed).toBeLessThan(query.length - 1);
  await expect(status(page)).toHaveText('GOM AFK applied.');
  await expect(hub(page)).toBeVisible();
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(search(page)).toHaveValue('travel kamadan 12345678');
  await expect(search(page)).toBeFocused();
  expect(await keydowns(page)).toBe(0);
  expect(await actions(page)).toEqual(['apply-team']);
});

test('a team apply that fails on its review leaves the outcome there and no progress in the status line (HUB-083)', async ({ page }) => {
  await open(page, '&slow-apply');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-scenario', { detail: 'partial' })));
  const review = page.locator('.hub-build-review [role=status]');
  await enter(page, 'team gom af');
  await expect(page.locator('.hub-caption')).toHaveText('GOM AFK');
  await primary(page).click();
  // One owner for progress: the Hub status line; the review never repeats it.
  await expect(status(page)).toHaveText(/^Applying GOM AFK… \d+\/16$/);
  await expect(primary(page)).toHaveText('Applying GOM AFK…');
  await expect(review).toBeHidden();
  await expect(review).toHaveText(/^Synthetic interruption/);
  await expect(status(page)).toBeHidden();
  await expect(page.locator('.hub-panel')).toHaveAttribute('data-busy', 'false');
  await expect(primary(page)).toHaveText('Apply team GOM AFK↵');
  await page.waitForTimeout(600);
  await expect(status(page)).toBeHidden();
  expect(await actions(page)).toEqual(['apply-team']);
});

test('a template folder that loads late never opens over a newer page or a closed Hub (HUB-004)', async ({ page }) => {
  for (const moveOn of ['type', 'close'] as const) {
    await open(page, '&templates-ms=1200');
    await search(page).fill('build library');
    await search(page).press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Build Library');
    const templates = page.locator('#hub .hub-row[data-id="game-templates"]');
    while (await templates.getAttribute('aria-selected') !== 'true') await search(page).press('ArrowUp');
    await search(page).press('ArrowRight');
    if (moveOn === 'type') await page.keyboard.type('sm');
    else await page.locator('.hub-close').click();
    await page.waitForTimeout(1600);
    if (moveOn === 'type') {
      await expect(page.locator('.hub-caption'), moveOn).toHaveText('Build Library');
      await expect(search(page), moveOn).toHaveValue('sm');
      await expect(search(page), moveOn).toBeFocused();
    } else {
      await expect(hub(page), moveOn).toBeHidden();
      await expect(page.locator('#canvas'), moveOn).toBeFocused();
    }
  }
});

test('results that arrive after the query found none get its selection, so Enter acts on them (HUB-003)', async ({ page }) => {
  await open(page, '&travel-load-ms=800');
  await search(page).fill('travel kam');
  await expect(primary(page)).toHaveText('Select a result');
  await expect(page.locator('#hub .hub-row[data-id="place:449"]')).toHaveAttribute('aria-selected', 'true');
  await expect(primary(page)).toHaveText('Travel to Kamadan, Jewel of Istan↵');
  await search(page).press('Enter');
  await expect(hub(page)).toBeHidden();
  expect(await actions(page)).toEqual(['TRAVEL Kamadan, Jewel of Istan']);
});

test('a long team apply names counted progress, and a repeated Enter never starts another (BLD-02)', async ({ page }) => {
  await open(page, '&slow-apply');
  await enter(page, 'team gom afk');
  await expect(primary(page)).toHaveText('Applying GOM AFK…');
  await expect(primary(page)).toBeDisabled();
  await expect(status(page)).toHaveText(/^Applying GOM AFK… \d+\/16$/);
  await expect(page.locator('#hub-results')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.hub-progress')).toHaveCSS('opacity', '1');
  await search(page).press('Enter');
  await expect(status(page)).toHaveText('GOM AFK is still being applied.');
  await expect(status(page)).toHaveText(/^Applying GOM AFK… \d+\/16$/);
  expect(await actions(page)).toEqual(['apply-team']);
});

test('a click never moves the selection off a running apply (BLD-03)', async ({ page }) => {
  await open(page, '&slow-apply');
  await enter(page, 'build smiter');
  await search(page).press('Enter');
  await expect(primary(page)).toHaveText('Applying Smiter…');
  await page.getByRole('option', { name: /Apply to hero/ }).click();
  await expect(page.getByRole('option', { name: /Apply to me/ })).toHaveAttribute('aria-selected', 'true');
  await search(page).press('Enter');
  await expect(status(page)).toHaveText('Smiter is still being applied.');
  // The page that started it still shows, so the success closes the Hub with its receipt.
  await expect(receipt(page)).toHaveText('Smiter applied to Fixture Monk.');
  await expect(hub(page)).toBeHidden();
  expect(await actions(page)).toEqual(['apply-build']);
});

test('a team apply that fails after the Hub closed is still reported, and the reopened row says so (BLD-04)', async ({ page }) => {
  await open(page, '&slow-apply');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-scenario', { detail: 'partial' })));
  await enter(page, 'team gom afk');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(hub(page)).toBeHidden();
  await expect(receipt(page)).toHaveText('GOM AFK partly applied. Open Hub to review.');
  await expect(receipt(page)).toHaveAttribute('data-outcome', 'failed');
  await expect(hub(page)).toBeHidden();
  await expect(page.locator('#canvas')).toBeFocused();
  await page.keyboard.press('Meta+r');
  await expect(status(page)).toHaveText('GOM AFK partly applied. Open Hub to review.');
  await search(page).fill('team gom afk');
  await expect(page.locator('#hub .hub-row', { hasText: 'GOM AFK' })).toContainText('Partly applied · Review');
});

test('leaving the page of a running apply is never navigated back (BLD-06)', async ({ page }) => {
  await open(page, '&slow-apply');
  await enter(page, 'build smiter');
  await search(page).press('Enter');
  await expect(primary(page)).toHaveText('Applying Smiter…');
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  // Home is usable while the apply runs elsewhere.
  await expect(primary(page)).toHaveText('Choose target↵');
  await expect(status(page)).toHaveText('Smiter applied to Fixture Monk.');
  await expect(hub(page)).toBeVisible();
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(search(page)).toHaveValue('build smiter');
});

test('clicks during a running account action never start or retarget a second one (PTR-35)', async ({ page }) => {
  await open(page, '&accounts-ms=1500');
  await enter(page, 'acc s');
  await primary(page).click();
  await expect(status(page)).toHaveText('Opening Second…');
  await expect(primary(page)).toHaveText('Opening Second…');
  await expect(primary(page)).toBeDisabled();
  await expect(search(page)).toBeFocused();
  await expect(page.locator('#hub-results')).toHaveAttribute('aria-busy', 'true');
  await page.locator('#hub .hub-row', { hasText: 'Close Main and open Second' }).dblclick();
  await expect(page.locator('#hub .hub-row[data-id$=":open"]')).toHaveAttribute('aria-selected', 'true');
  await expect(hub(page)).toBeHidden();
  await page.waitForTimeout(300);
  expect(await actions(page)).toEqual(['Account Second open']);
});

test('an account open that focuses another window still ends the task, so the next opening starts at Home (HUB-004)', async ({ page }) => {
  await open(page, '&accounts-ms=1500');
  await enter(page, 'acc s');
  await expect(page.locator('.hub-caption')).toHaveText('Second');
  await expect(primary(page)).toHaveText('Open Second↵');
  await primary(page).click();
  await expect(status(page)).toHaveText('Opening Second…');
  // The opening account takes the focus while the action runs, which suspends this very page.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(hub(page)).toBeHidden();
  await expect.poll(() => actions(page)).toEqual(['Account Second open']);
  await page.waitForTimeout(100);
  await page.keyboard.press('Meta+r');
  await expect(hub(page)).toBeVisible();
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(search(page)).toHaveValue('');
  await expect(search(page)).toBeFocused();
  await expect(primary(page)).not.toHaveText(/Second/);
  await expect(status(page)).toBeHidden();
  expect(await actions(page)).toEqual(['Account Second open']);
});

test('an invite that fails after the Hub closed names the command, now and on the next opening (PPL-17)', async ({ page }) => {
  await open(page, '&party&invite-ms=800&invite-fail=Guild Wars chat is not ready');
  await enter(page, 'invite Zed Delta');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(receipt(page)).toHaveText('/invite Zed Delta was not sent. Guild Wars chat is not ready.');
  await expect(hub(page)).toBeHidden();
  await page.keyboard.press('Meta+r');
  await expect(status(page)).toHaveText('/invite Zed Delta was not sent. Guild Wars chat is not ready.');
});

test('a character switch that fails after the Hub closed is reported and reopens on the attempted card (HUB-035)', async ({ page }) => {
  await open(page, '&switch-fail=logout-refused');
  await enter(page, 'char toefte');
  await expect(hub(page)).toBeHidden();
  await expect(receipt(page)).toHaveText('Guild Wars did not return to the character selector. Try again.');
  await expect(hub(page)).toBeHidden();
  await page.keyboard.press('Meta+e');
  await expect(page.locator('button[data-character-key="toefte"]')).toBeFocused();
});
