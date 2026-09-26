import { expect, test } from '@playwright/test';

test('Hub has a locked frame, invisible corner hit area and bounded movable geometry', async ({ page }, info) => {
  await page.goto('/?hub');
  const panel = page.locator('.hub-panel');
  const head = page.locator('.hub-heading');
  const grip = page.getByRole('button', { name: 'Resize Hub', exact: true });
  const initial = (await panel.boundingBox())!;
  await expect(panel).toHaveAttribute('data-locked', 'true');
  await expect(grip).toBeHidden();
  const heading = (await head.boundingBox())!;
  await page.mouse.move(heading.x + heading.width / 2, heading.y + 12);
  await page.mouse.down(); await page.mouse.move(heading.x + heading.width / 2 + 60, heading.y + 45); await page.mouse.up();
  expect(await panel.boundingBox()).toEqual(initial);
  await page.getByRole('button', { name: 'Unlock Hub position', exact: true }).click();
  await expect(grip).toBeVisible();
  await page.mouse.move(heading.x + heading.width / 2, heading.y + 12);
  await page.mouse.down(); await page.mouse.move(heading.x + heading.width / 2 - 60, heading.y + 36); await page.mouse.up();
  expect((await panel.boundingBox())!.x).toBeCloseTo(initial.x - 60);
  const corner = (await grip.boundingBox())!;
  expect(corner.width).toBeGreaterThanOrEqual(32);
  await page.mouse.move(corner.x + 10, corner.y + 10);
  await page.mouse.down(); await page.mouse.move(corner.x - 40, corner.y - 40); await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeLessThan(initial.width);
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).click();
  const placement = await panel.boundingBox();
  await expect(grip).toBeHidden();
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('maps'); await search.press('Enter');
  expect(await panel.boundingBox()).toEqual(placement);
  await expect(page.getByRole('navigation', { name: 'Hub breadcrumb' })).toContainText('Home');
  await page.screenshot({ path: info.outputPath('hub-maps-breadcrumb.png') });
});

test('Backspace only edits text; Command-Backspace and breadcrumb ancestors restore history', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('accounts'); await search.press('Enter');
  await search.fill('second'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Accounts›Second');
  await search.fill('keep'); await search.press('Backspace');
  await expect(search).toHaveValue('kee');
  await expect(page.locator('.hub-caption')).toHaveText('Second');
  // A held ⌫ on an empty query never leaves the view.
  await search.fill('');
  for (let press = 0; press < 3; press += 1) await search.press('Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Second');
  await search.press('Meta+Backspace');
  await expect(search).toHaveValue('second');
  await expect(page.locator('.hub-caption')).toHaveText('Accounts');
  await search.press('Enter');
  await page.getByRole('navigation', { name: 'Hub breadcrumb' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(search).toHaveValue('accounts');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('.hub-back')).toBeHidden();
});

test('Command-Backspace goes back one level from any focus and never deletes text', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('kam'); await search.press('Meta+Backspace');
  await expect(search).toHaveValue('kam');
  await expect(page.locator('#hub')).toBeVisible();
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const style = page.getByLabel('Panel style', { exact: true });
  await style.focus(); await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(search).toHaveValue('settings');
  await expect(search).toBeFocused();
  await search.fill('accounts'); await search.press('Enter');
  await search.fill('second'); await search.press('Enter');
  await search.fill('keep');
  // A held press pops one level; its auto-repeat is ignored and the child query stays untouched until then.
  await page.keyboard.down('Meta'); await page.keyboard.down('Backspace'); await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace'); await page.keyboard.up('Meta');
  await expect(page.locator('.hub-caption')).toHaveText('Accounts');
  await expect(search).toHaveValue('second');
});

test('a list drawn under a resting pointer keeps one visible selection until the pointer moves', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const results = (await page.locator('#hub .hub-results').boundingBox())!;
  const x = results.x + results.width / 2, y = results.y + 150;
  // Park the pointer first; the rows then render under it without any movement.
  await page.mouse.move(x, y);
  await search.pressSequentially('k');
  const selected = page.locator('#hub .hub-row[aria-selected=true]');
  const hovered = page.locator('#hub .hub-row:hover');
  await expect(hovered).toHaveCount(1);
  const first = await selected.getAttribute('data-id');
  expect(await hovered.getAttribute('data-id')).not.toBe(first);
  // The resting pointer paints nothing, so only the selected row looks selected.
  expect(await hovered.evaluate(row => getComputedStyle(row).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.mouse.wheel(0, 40);
  await expect(selected).toHaveAttribute('data-id', first!);
  await page.mouse.move(x + 8, y);
  await expect(selected).toHaveAttribute('data-id', (await hovered.getAttribute('data-id'))!);
  await expect(search).toBeFocused();
});

test('list keys move one selection without wrapping while focus and typing stay in search', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('k');
  const options = page.locator('#hub [role=option]');
  const last = await options.count() - 1;
  expect(last).toBeGreaterThan(3);
  const at = (index: number) => expect(options.nth(index)).toHaveAttribute('aria-selected', 'true');
  await at(0);
  // ↑ at the top stays put: no wrap, and focus never hops to the header.
  await search.press('ArrowUp'); await at(0);
  await expect(search).toBeFocused();
  // The first ↓ moves the selection.
  await search.press('ArrowDown'); await at(1);
  await search.press('Control+n'); await at(2);
  await search.press('Control+p'); await at(1);
  await search.press('End'); await at(last);
  // ↓ past the end stays on the last result; it never tabs to the footer.
  await search.press('ArrowDown'); await at(last);
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-activedescendant', (await options.nth(last).getAttribute('id'))!);
  await expect(options.nth(last)).toBeInViewport();
  await search.press('Home'); await at(0);
  await search.press('PageDown');
  expect(await options.evaluateAll(rows => rows.findIndex(row => row.getAttribute('aria-selected') === 'true'))).toBeGreaterThan(1);
  await search.press('PageUp'); await at(0);
  await expect(page.locator('#hub [role=option][aria-selected=true]')).toHaveCount(1);
  // Typing continues at the caret; Home and End never moved it.
  await page.keyboard.type('a');
  await expect(search).toHaveValue('ka');
  // A click selects without taking focus from search.
  await options.nth(1).dispatchEvent('mousedown');
  await expect(search).toBeFocused();
});

test('Esc clears the query, then goes back one level, then closes, on every visit', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  // Repeated visits once tripped the browser's close-request guard on the third Esc.
  for (let visit = 0; visit < 4; visit += 1) {
    await search.fill('settings'); await search.press('Enter');
    await expect(page.locator('.hub-caption')).toHaveText('Settings');
    await page.keyboard.press('Escape');
    await expect(page.locator('.hub-caption')).toHaveText('Home');
    await expect(search).toHaveValue('settings');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(page.locator('#hub')).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#canvas')).toBeFocused();
});

test('arrows connect Hub results, character carousel, search and Back', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  // Results keep focus in search; arrows move only the selection (D-2).
  await search.fill('switch character'); await search.press('ArrowDown');
  await expect(search).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(search).toBeFocused();
  await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id', 'character');
  await search.press('Enter');
  const selected = page.locator('.character-switch-row[data-selected=true]');
  await expect(selected).toBeFocused();
  await page.screenshot({ path: info.outputPath('hub-characters.png') });
  await page.keyboard.press('ArrowRight'); await expect(selected).toContainText('Fixture Ranger');
  await page.keyboard.press('ArrowLeft'); await expect(selected).toContainText('Fixture Monk');
  await page.keyboard.press('ArrowUp');
  const picker = page.locator('.character-switch-search input');
  await expect(picker).toBeFocused();
  await page.keyboard.press('ArrowUp');
  const back = page.getByRole('button', { name: 'Back', exact: true });
  await expect(back).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(picker).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(selected).toBeFocused();
  // ⌫ on a card edits the character search and never leaves; ⌘⌫ goes back.
  await page.keyboard.press('Backspace');
  await expect(picker).toBeFocused();
  await expect(page.locator('.character-switch-row')).not.toHaveCount(0);
  await page.keyboard.press('Meta+Backspace');
  await expect(search).toHaveValue('switch character');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
});

for (const material of ['Guild Wars', 'Modern']) test(`floating Whispers paints one complete ${material} frame and preserves a draft across hide/show`, async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByLabel('Panel style', { exact: true }).selectOption({ label: material });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('whisper Romi'); await search.press('Enter');
  const panel = page.locator('#whisper-window');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(panel.locator('.ui-window-lock')).toHaveCount(0);
  const draft = page.getByRole('textbox', { name: 'Message Romi Ranger', exact: true });
  await draft.fill('Keep this draft');
  await page.getByRole('button', { name: 'Hide Whispers' }).click();
  await page.keyboard.press('Meta+d');
  await expect(draft).toHaveValue('Keep this draft');
  const geometry = await panel.evaluate(element => {
    const head = element.querySelector('.whisper-frame-head')!;
    const title = head.querySelector('h2')!;
    const header = head.getBoundingClientRect(), label = title.getBoundingClientRect();
    const paint = getComputedStyle(element, '::before');
    return { boxSizing: getComputedStyle(element).boxSizing, fill: paint.backgroundColor, mask: paint.maskImage, z: paint.zIndex, delta: Math.abs((header.top + header.bottom - label.top - label.bottom) / 2) };
  });
  expect(geometry.boxSizing).toBe('border-box'); expect(geometry.fill).not.toBe('rgba(0, 0, 0, 0)'); expect(geometry.delta).toBeLessThan(2);
  expect(geometry.mask).toBe('none'); expect(Number(geometry.z)).toBeLessThan(0);
  await page.screenshot({ path: info.outputPath('whisper-floating.png') });
});
