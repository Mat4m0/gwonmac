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

test('Command-Backspace and breadcrumb ancestors restore history; Backspace only edits', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const legend = page.locator('.hub-legend');
  await expect(legend).toBeHidden();
  await search.fill('kee'); await search.press('Meta+Backspace');
  await expect(search).toHaveValue('kee'); await expect(page.locator('.hub-caption')).toHaveText('Home');
  await search.fill('accounts'); await search.press('Enter');
  await search.fill('second'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Accounts›Second');
  await expect(legend).toHaveText('⌘⌫ Back');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Meta+Backspace');
  await search.fill('keep'); await search.press('Backspace');
  await expect(search).toHaveValue('kee');
  await expect(page.locator('.hub-caption')).toHaveText('Second');
  await search.fill(''); await search.press('Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Second');
  // A held ⌘⌫ goes back one level only, straight from a non-empty query.
  await search.fill('kee');
  await page.keyboard.down('Meta'); await page.keyboard.down('Backspace'); await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace'); await page.keyboard.up('Meta');
  await expect(search).toHaveValue('second');
  await expect(page.locator('.hub-caption')).toHaveText('Accounts');
  await search.press('Enter');
  await page.getByRole('navigation', { name: 'Hub breadcrumb' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(search).toHaveValue('accounts');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('.hub-back')).toBeHidden();
});

test('arrows connect Hub results, character carousel, search and Back', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('switch character'); await search.press('ArrowDown');
  // D-2: arrows move the selection while focus stays in search; no wrap at the top.
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Switch Character');
  await page.keyboard.press('ArrowUp'); await expect(search).toBeFocused();
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Switch Character');
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
  // Backspace on a card edits the (empty) character search and never leaves the view.
  await page.keyboard.press('Backspace');
  await expect(picker).toBeFocused(); await expect(search).toBeHidden();
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

test('one list move keeps focus in search: arrows, Control-N/P, pages and ends never wrap', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const rows = page.locator('.hub-row');
  const selected = page.locator('.hub-row[aria-selected="true"]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(8);
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowUp'); await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('Control+n'); await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('Control+p'); await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('PageDown');
  expect(await selected.getAttribute('id')).not.toBe('hub-result-0');
  await search.press('End');
  await expect(rows.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(count - 1)).toBeInViewport();
  await search.press('ArrowDown'); await expect(rows.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
  await search.press('Home'); await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-activedescendant', 'hub-result-0');
  // The results scroller is no Tab stop (HUB-045).
  await expect(page.locator('#hub-results')).toHaveAttribute('tabindex', '-1');
  // A click on a navigational row opens it and leaves the keyboard in search.
  await page.locator('.hub-row[data-id="commands"]').click();
  await expect(page.locator('.hub-caption')).toHaveText('Commands');
  await expect(search).toBeFocused();
});
