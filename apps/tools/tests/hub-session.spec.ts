import { expect, test, type Page } from '@playwright/test';
import { timeBudget } from './performance-budget.js';

/**
 * Async actions belong to the Hub page that started them (HUB-004, HUB-016, HUB-083,
 * HUB-035). While that page shows, the footer and the status line name the running action,
 * and nothing starts a second one. Typing, a page change or closing ends the page session:
 * a late completion then reports a receipt and never closes, navigates or wipes the newer
 * page; a late failure is a named failure receipt that also waits for the next opening.
 * `?slow-apply` lands each fixture command after half a second on the real confirmation clock.
 */
const search = (page: Page) => page.locator('.hub-search input');
const hub = (page: Page) => page.getByRole('dialog', { name: /^Hub(?: — .+)?$/u });
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

test('a running apply keeps its progress in the status line after Back and through typing, and never navigates (KEY-19)', async ({ page }) => {
  test.setTimeout(60_000);
  const busyStatus = page.locator('.hub-status[aria-busy="true"]');
  for (const from of ['review', 'home'] as const) {
    await open(page, '&slow-apply');
    await page.keyboard.type('team gom afk');
    if (from === 'review') {
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.hub-caption')).toHaveText('GOM AFK');
    }
    await page.keyboard.press('Enter');
    await expect(status(page)).toHaveText(/^Applying GOM AFK… \d+\/16$/);
    await page.keyboard.press('Meta+Backspace');
    await expect(page.locator('.hub-caption')).toHaveText('Home');
    await expect(search(page)).toHaveValue('team gom afk');
    // Back and every typed key leave the running apply's progress, busy, in the status line.
    await expect(busyStatus).toHaveText(/^Applying GOM AFK… \d+\/16$/);
    await expect(page.locator('.hub-panel')).toHaveAttribute('data-busy', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.hub-caption')).toHaveText('GOM AFK');
    await expect(primary(page)).toHaveText('Applying GOM AFK…');
    await expect(primary(page).locator('kbd')).toHaveCount(0);
    await expect(page.locator('.hub-view')).toHaveAttribute('aria-busy', 'true');
    await expect(busyStatus).toHaveText(/^Applying GOM AFK… \d+\/16$/);
    await page.keyboard.press('Meta+Backspace');
    await page.keyboard.press('ControlOrMeta+a');
    const seen = new Set<string>();
    for (const character of 'travel kamadan') {
      await page.keyboard.type(character);
      const text = await status(page).textContent();
      if (text === 'GOM AFK applied.') break;
      await expect(busyStatus).toHaveText(/^Applying GOM AFK… \d+\/16$/);
      seen.add(text ?? '');
      await page.waitForTimeout(250);
    }
    expect(seen.size).toBeGreaterThan(1);
    await expect(status(page)).toHaveText('GOM AFK applied.', { timeout: 20_000 });
    await expect(status(page)).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.hub-panel')).toHaveAttribute('data-busy', 'false');
    await expect(hub(page)).toBeVisible();
    await expect(page.locator('.hub-caption')).toHaveText('Home');
    await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home');
    await expect(search(page)).toBeFocused();
    expect(await keydowns(page)).toBe(0);
    expect(await actions(page)).toEqual(['apply-team']);
  }
});

test('a running apply left behind by typing never paints over a newer failure in the status line (KEY-19)', async ({ page }) => {
  await open(page, '&party&slow-apply&invite-fail=Guild Wars chat is not ready');
  await enter(page, 'team gom afk');
  await expect(status(page)).toHaveText(/^Applying GOM AFK… \d+\/16$/);
  await enter(page, 'invite Zed Delta');
  const failure = '/invite Zed Delta was not sent. Guild Wars chat is not ready.';
  await expect(status(page)).toHaveText(failure);
  // Several apply steps land meanwhile; the newer failure keeps the line.
  const progressed = await page.evaluate(() => window.gwFixtureActions.length);
  await expect.poll(() => page.evaluate(() => window.gwFixtureActions.length), { timeout: 5_000 }).toBeGreaterThan(progressed + 1);
  await expect(status(page)).toHaveText(failure);
  await expect(status(page)).toHaveAttribute('aria-busy', 'false');
  // The next repaint shows the running apply again.
  await page.keyboard.type('x');
  await expect(status(page)).toHaveText(/^Applying GOM AFK… \d+\/16$/);
  await expect(status(page)).toHaveAttribute('aria-busy', 'true');
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
  await expect(review).toHaveText(/^Team partly applied\. Synthetic interruption/);
  await expect(status(page)).toBeEmpty();
  await expect(page.locator('.hub-panel')).toHaveAttribute('data-busy', 'false');
  await expect(primary(page)).toHaveText('Apply team GOM AFK↵');
  await page.waitForTimeout(600);
  await expect(status(page)).toBeEmpty();
  expect(await actions(page)).toEqual(['apply-team']);
});

test('a template folder that loads late never opens over a newer page or a closed Hub (HUB-004)', async ({ page }) => {
  for (const moveOn of ['type', 'close'] as const) {
    await open(page, '&templates-ms=1200');
    await search(page).fill('build library');
    await search(page).press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Build Library');
    const templates = page.locator('#hub .hub-row[data-id="game-templates"]');
    const selected = page.locator('#hub .hub-row[aria-selected="true"]');
    // Each key moves the selection asynchronously; read it only after it moved.
    const press = async (key: string) => {
      const before = await selected.getAttribute('data-id');
      await search(page).press(key);
      await expect(selected).not.toHaveAttribute('data-id', before ?? '');
    };
    await press('End');
    for (let step = 0; step < 20 && await templates.getAttribute('aria-selected') !== 'true'; step++) await press('ArrowUp');
    await expect(templates).toHaveAttribute('aria-selected', 'true');
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
  await expect(search(page)).toHaveValue('build smiter');
  await expect(primary(page)).toHaveText('Choose target↵');
  // The restored query lists only Smiter; the full Home lists Travel below the preferred place.
  await page.keyboard.press('Escape');
  await expect(search(page)).toHaveValue('');
  const travel = page.locator('#hub .hub-row[data-id="travel"]');
  await expect(travel).toHaveAttribute('aria-selected', 'false');
  while (await travel.getAttribute('aria-selected') !== 'true') await search(page).press('ArrowDown');
  await expect(primary(page)).toHaveText('Browse travel↵');
  // The selection was made before the apply finished, so its completion is what is checked.
  await expect(status(page)).toHaveText('Smiter applied to Fixture Monk.');
  await page.waitForTimeout(300);
  await expect(hub(page)).toBeVisible();
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(search(page)).toHaveValue('');
  await expect(search(page)).toBeFocused();
  await expect(travel).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#hub .hub-row[aria-selected="true"]')).toHaveCount(1);
  await expect(primary(page)).toHaveText('Browse travel↵');
  expect(await actions(page)).toEqual(['apply-build']);
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
  await expect(status(page)).toBeEmpty();
  expect(await actions(page)).toEqual(['Account Second open']);
  // Control the external account completion: reopening must beat it, not merely wait for it.
  await page.evaluate(() => {
    const original = window.gwNative.accounts.open;
    window.gwNative.accounts.open = async request => {
      await new Promise<void>(resolve => { window.addEventListener('finish-account', () => resolve(), { once: true }); });
      return original(request);
    };
  });
  await page.evaluate(() => window.gwFixtureCanvas?.clear());
  await enter(page, 'acc s'); await primary(page).click();
  await expect(status(page)).toHaveText('Opening Second…');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(hub(page)).toBeHidden();
  await page.keyboard.press('Meta+r');
  await search(page).fill('travel');
  // Measure in the renderer; Playwright transport/locator polling is outside the 100 ms contract.
  const elapsed = await search(page).evaluate(async input => {
    const start = performance.now();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    while (document.querySelector('.hub-caption')?.textContent !== 'Travel') await new Promise(requestAnimationFrame);
    return performance.now() - start;
  });
  expect(elapsed).toBeLessThanOrEqual(timeBudget(100));
  await page.getByRole('combobox', { name: 'Destination, phrase, or friend' }).fill('kam');
  await page.evaluate(() => window.dispatchEvent(new Event('finish-account')));
  await expect.poll(() => actions(page)).toEqual(['Account Second open', 'Account Second open']);
  await expect(page.locator('.hub-caption')).toHaveText('Travel');
  await expect(page.getByRole('combobox', { name: 'Destination, phrase, or friend' })).toHaveValue('kam');
  await expect(page.getByRole('combobox', { name: 'Destination, phrase, or friend' })).toBeFocused();
  // The fixture has renderer commands, while main owns the physical Command modifier in Electron.
  expect(await page.evaluate(() => window.gwFixtureCanvas?.events)).toEqual([{ type: 'keydown', code: 'MetaLeft', repeat: false }]);
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
  await expect(receipt(page)).toHaveText('Switch to Toefte stopped. Guild Wars did not return to the character selector. Try again.');
  await expect(hub(page)).toBeHidden();
  await page.keyboard.press('Meta+e');
  await expect(page.locator('button[data-character-key="toefte"]')).toBeFocused();
  await expect(status(page)).toContainText('Switch to Toefte stopped.');
  await expect(page.locator('.character-switch-status')).not.toContainText('did not return');
});


test('delayed Launcher and website completions cannot close a newer Hub session (HUB-004)', async ({page}) => {
  for (const [query, method] of [['launcher', 'showLauncher'], ['project website', 'openExternal']] as const) {
    await open(page, '');
    await page.evaluate(method => {
      Object.defineProperty(window.gwNative.app, method, {value: () => new Promise<void>(resolve => {
        window.addEventListener('integration-app-complete', () => resolve(), {once: true});
      })});
    }, method);
    await search(page).fill(query); await search(page).press('Enter');
    await expect(primary(page)).toBeDisabled();
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await expect(hub(page)).toBeHidden();
    await page.keyboard.press('Meta+r');
    await search(page).fill('travel kam');
    await page.evaluate(() => window.dispatchEvent(new Event('integration-app-complete')));
    await page.waitForTimeout(50);
    await expect(hub(page)).toBeVisible();
    await expect(search(page)).toHaveValue('travel kam');
    await expect(search(page)).toBeFocused();
  }
});

test('a carried failure expires with the existing 90-second Hub resume window', async ({page}) => {
  await open(page, '&party&invite-ms=100&invite-fail=Guild Wars chat is not ready');
  await enter(page, 'invite Zed Delta');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(receipt(page)).toContainText('/invite Zed Delta was not sent.');
  await page.clock.setFixedTime(new Date(Date.now() + 90_001));
  await page.keyboard.press('Meta+r');
  await expect(status(page)).not.toContainText('/invite Zed Delta was not sent.');
});


test('resolving a Travel failure preserves another owner’s newer receipt (HUB-072)', async ({page}) => {
  await open(page, '');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.gwHub?.notify('Travel did not start.', 'failed');
    window.gwHub?.notify('Invite Zed Delta stopped. Try again.', 'failed');
    window.gwHub?.notify('Travel did not start.', 'cleared');
  });
  await expect(receipt(page)).toHaveText('Invite Zed Delta stopped. Try again.');
  await page.keyboard.press('Meta+r');
  await expect(status(page)).toHaveText('Invite Zed Delta stopped. Try again.');
  await page.evaluate(() => window.gwHub?.notify('Invite Zed Delta stopped. Try again.', 'cleared'));
  await expect(status(page)).toBeEmpty();
});
