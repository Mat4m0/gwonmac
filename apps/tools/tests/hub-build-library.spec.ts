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
  await expect(page.getByRole('button', { name: 'Review current build ↵', exact: true })).toBeDisabled();
  await search.press('Enter');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await search.fill('Tahlkora');
  await expect(page.locator('#hub').getByRole('option')).toHaveAttribute('aria-disabled', 'false');
  await page.screenshot({ path: info.outputPath('hub-hero-search.png') });
  await search.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Tahlkora');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await search.press('Enter');
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

test('Right Arrow compares current builds without applying, and Back restores the comparison', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const incoming = page.getByRole('region', { name: 'Build to apply', exact: true });
  await search.fill('build monk'); await search.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await expect(incoming).toContainText('Protection');
  const self = page.locator('#hub').getByRole('option', { name: /Apply to me/ });
  await expect(self).toContainText('Current build');
  await expect(self.getByRole('img', { name: 'Healing Prayers 12', exact: true })).toBeVisible();
  await expect(incoming.locator('.hub-skill').first()).toHaveAttribute('aria-label', '1. Protective Spirit');
  await expect(self.locator('.hub-skill').first()).toHaveAttribute('aria-label', '1. Word of Healing');
  await page.screenshot({ path: info.outputPath('hub-player-comparison.png') });
  await search.fill('hero'); await search.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await expect(incoming).toContainText('Protection');
  await search.fill('Tahlkora'); await search.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.hub-caption')).toHaveText('Tahlkora');
  await expect(page.locator('#hub').getByRole('option')).toContainText('Current build');
  await expect(page.locator('#hub').getByRole('option').locator('.hub-skill')).toHaveCount(8);
  await expect(incoming.locator('.hub-skill')).toHaveCount(8);
  await search.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.screenshot({ path: info.outputPath('hub-hero-comparison.png') });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-scenario', { detail: 'unobserved-builds' })));
  await expect(page.locator('#hub').getByRole('option').locator('.hub-skill')).toHaveCount(0);
  await expect(page.locator('#hub').getByRole('option')).toBeFocused();
  await expect(incoming.locator('.hub-skill')).toHaveCount(8);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Heroes');
  await expect(search).toHaveValue('Tahlkora');
  await expect(incoming).toContainText('Protection');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(incoming).toBeHidden();
});

for (const viewport of [{ width: 320, height: 800 }, { width: 640, height: 500 }]) {
  test(`build comparison remains usable at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await page.goto('/?hub');
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await search.fill('build monk'); await search.press('ArrowDown'); await page.keyboard.press('ArrowRight');
    const summary = page.locator('.hub-summary');
    await expect(summary.getByRole('img').last()).toBeInViewport();
    await search.press('ArrowDown');
    const current = page.locator('#hub').getByRole('option', { name: /Apply to me/ });
    await current.getByRole('img').last().scrollIntoViewIfNeeded();
    await expect(current.getByRole('img').last()).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Apply to me ↵', exact: true })).toBeInViewport();
    expect(await page.locator('.hub-results').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('hub-comparison-compact.png') });
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 800 }]) {
  test(`compact build results keep inline metadata at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await page.goto('/?hub');
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await search.fill('build monk');
    await expect(page.locator('.hub-preview')).toBeHidden();
    const rows = page.locator('.hub-build-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).not.toContainText('.txt');
    await expect(rows.first().locator('.hub-attribute').first()).toHaveText('HP12');
    await expect(rows.first().getByRole('img', { name: 'Healing Prayers 12', exact: true })).toBeVisible();
    await expect(rows.first().locator('.hub-professions img')).toHaveCount(2);
    await expect(rows.first().locator('.hub-attribute-group > img')).toHaveCount(1);
    await expect(rows.first().locator('.hub-attribute-group .hub-attribute')).toHaveCount(3);
    await expect.poll(() => rows.first().locator('.hub-professions img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth === 48))).toBe(true);
    await expect(rows.first().locator('.hub-skill').last()).toBeInViewport();
    expect(await page.locator('.hub-results').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('hub-compact-builds.png') });
  });
}
