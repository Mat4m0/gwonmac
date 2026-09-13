import { expect, test } from '@playwright/test';

test('template folders and explicit self application stay inside Hub', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const hub = page.locator('#hub');
  await search.fill('build library'); await search.press('Enter');
  await search.fill('Guild Wars templates'); await search.press('Enter');
  await expect(hub.getByRole('option', { name: 'Monk Template folder', exact: true })).toBeVisible();
  await search.fill('Monk'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Build Library›Guild Wars templates›Monk');
  await expect(hub.getByRole('option')).toContainText('Protection');
  await page.screenshot({ path: info.outputPath('hub-template-folder.png') });
  await search.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(hub.getByRole('option', { name: /Apply to me/ })).toBeVisible();
  await expect(page.locator('.tools-window')).toBeHidden();
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.screenshot({ path: info.outputPath('hub-build-actions.png') });
  await search.press('Enter');
  await expect(hub).toBeHidden();
  await expect(page.locator('#app')).toHaveAttribute('data-action', /command:/);
});

test('hero search includes unlocked heroes and applies only to an existing party member', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('build monk'); await search.press('ArrowDown'); await page.keyboard.press('Enter');
  await search.fill('hero'); await search.press('Enter');
  await search.fill('Dunkoro');
  await expect(page.locator('#hub').getByRole('option')).toContainText('Add this hero to your party first.');
  await expect(page.getByRole('button', { name: 'Apply to Dunkoro ↵', exact: true })).toBeDisabled();
  await search.press('Enter');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await search.fill('Tahlkora');
  await expect(page.locator('#hub').getByRole('option')).toHaveAttribute('aria-disabled', 'false');
  await page.screenshot({ path: info.outputPath('hub-hero-search.png') });
  await search.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#app')).toHaveAttribute('data-action', /command:/);
});

test('only Hub locks, reset restores its default frame, and popouts have visible plain X controls', async ({ page }) => {
  await page.goto('/?hub');
  const panel = page.locator('.hub-panel');
  const initial = await panel.boundingBox();
  await page.getByRole('button', { name: 'Unlock Hub position', exact: true }).click();
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).press('Alt+ArrowLeft');
  await page.getByRole('button', { name: 'Resize Hub', exact: true }).press('ArrowLeft');
  expect(await panel.boundingBox()).not.toEqual(initial);
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Hub position', exact: true }).click();
  expect(await panel.boundingBox()).toEqual(initial);
  await expect(panel).toHaveAttribute('data-locked', 'true');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  for (const [shortcut, selector, close] of [['Meta+b', '.tools-window', 'Close Build Library'], ['Meta+k', '.trade-window', 'Close Trade Chat'], ['Meta+d', '#whisper-window', 'Hide Whispers']]) {
    await page.keyboard.press(shortcut!);
    const popup = page.locator(selector!);
    await expect(popup).toBeVisible();
    await expect(popup.locator('.ui-window-lock')).toHaveCount(0);
    const x = popup.getByRole('button', { name: close!, exact: true });
    await expect(x).toHaveText('×');
    expect(await x.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
    await expect(x).toBeInViewport();
    const before = (await popup.boundingBox())!;
    const head = (await popup.locator('.ui-window-head').boundingBox())!;
    await page.mouse.move(head.x + 30, head.y + head.height / 2);
    await page.mouse.down(); await page.mouse.move(head.x + 60, head.y + head.height / 2 + 20); await page.mouse.up();
    expect((await popup.boundingBox())!.x).toBeCloseTo(before.x + 30);
    await x.click(); await expect(popup).toBeHidden();
  }
});
