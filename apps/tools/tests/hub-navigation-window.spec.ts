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

test('Backspace and breadcrumb ancestors restore history without deleting typed text', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('accounts'); await search.press('Enter');
  await search.fill('second'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Accounts›Second');
  await search.fill('keep'); await search.press('Backspace');
  await expect(search).toHaveValue('kee');
  await expect(page.locator('.hub-caption')).toHaveText('Second');
  await search.fill(''); await search.press('Backspace');
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
  await expect(page.locator('.hub-row[aria-selected=true]')).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(search).toBeFocused();
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
  await page.keyboard.press('Backspace');
  await expect(search).toHaveValue('switch character');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /Character/);
});

test('floating Whispers paints one complete frame and preserves a draft across hide/show', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('whisper Romi'); await search.press('Enter');
  const panel = page.locator('#whisper-window');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(panel).toHaveAttribute('data-locked', 'true');
  const draft = page.getByRole('textbox', { name: 'Message Romi Ranger', exact: true });
  await draft.fill('Keep this draft');
  await page.getByRole('button', { name: 'Hide Whispers' }).click();
  await page.keyboard.press('Meta+d');
  await expect(draft).toHaveValue('Keep this draft');
  const geometry = await panel.evaluate(element => {
    const head = element.querySelector('.whisper-frame-head')!;
    const title = head.querySelector('h2')!;
    const header = head.getBoundingClientRect(), label = title.getBoundingClientRect();
    return { boxSizing: getComputedStyle(element).boxSizing, fill: getComputedStyle(element, '::before').backgroundColor, delta: Math.abs((header.top + header.bottom - label.top - label.bottom) / 2) };
  });
  expect(geometry.boxSizing).toBe('border-box'); expect(geometry.fill).not.toBe('rgba(0, 0, 0, 0)'); expect(geometry.delta).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('whisper-floating.png') });
});
