import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 650 }, { width: 640, height: 480 }]) {
  test(`full team preview stays readable inside the frame at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto('/?hub');
    const search = page.locator('.hub-search input');
    await search.fill('team gom afk');
    const preview = page.locator('.hub-preview');
    await expect(preview).toContainText('8. Vekk');
    await expect(preview).not.toContainText('Templates/');
    await expect(page.locator('.hub-primary')).toBeInViewport();
    const boxes = await page.locator('.hub-panel, .hub-preview, .hub-footer').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, overflow: element.scrollWidth - element.clientWidth };
    }));
    expect(boxes[1]!.bottom).toBeLessThanOrEqual(boxes[2]!.top + 1);
    expect(boxes[2]!.bottom).toBeLessThanOrEqual(boxes[0]!.bottom);
    expect(boxes.every(box => box.overflow <= 1)).toBe(true);
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
    await page.screenshot({ path: info.outputPath('team-preview.png') });
  });
}

test('Home separates current context, teaches commands, and shows resolved shortcuts', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('.hub-context')).toContainText("Lion's Arch");
  const search = page.locator('.hub-search input');
  await search.fill('trade');
  await expect(page.locator('.hub-hint')).toContainText('trade <item>');
  await expect(page.locator('.hub-row-type kbd')).toHaveText(['⌘', 'K']);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { shortcutOverrides: { 'trade.toggle': null } } })));
  await expect(page.locator('.hub-row-type kbd')).toHaveCount(0);
  await search.fill('team');
  await expect(page.locator('.hub-hint')).toContainText('team <name>');
  await search.fill('team gom afk');
  await expect(page.locator('.hub-scope')).toHaveText('team');
  await expect(page.locator('.hub-legend')).toContainText('⎋ Clear');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Actions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Actions' })).toBeHidden();
  await expect(search).toHaveValue('team gom afk');
  await search.press('ArrowRight');
  await expect(page.locator('.hub-legend')).toContainText('⎋ Back');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveAttribute('title', 'Back (⌘⌫)');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveAttribute('aria-description', 'Return to Home');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('team gom afk');
});

test('Maps follows external settings and recovers from a failed save', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('maps'); await search.press('Enter');
  const grid = page.getByRole('checkbox', { name: 'Exploration grid' });
  const opacity = page.getByRole('slider', { name: 'Grid opacity' });
  await grid.uncheck();
  await expect(opacity).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { cartographyGridEnabled: true, cartographyGridOpacity: 45 } })));
  await expect(grid).toBeChecked();
  await expect(opacity).toBeEnabled();
  await expect(opacity).toHaveValue('45');
  await page.evaluate(() => {
    const save = window.gwNative.hubSettings.update;
    let fail = true;
    window.gwNative.hubSettings.update = async patch => {
      if (fail) { fail = false; throw new Error('Offline fixture failure'); }
      return save(patch);
    };
  });
  await grid.click();
  await expect(grid).toBeChecked();
  await expect(page.locator('.hub-settings-status')).toContainText('Could not save');
  await grid.uncheck();
  await expect(grid).not.toBeChecked();
  await expect(page.locator('.hub-settings-status')).toBeEmpty();
  // The external store answers late; the native inputs must retain every physical edit.
  await page.goto('/?hub&settings-ms=20');
  await search.fill('maps'); await search.press('Enter');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { cartographyGridEnabled: true, cartographyGridOpacity: 65 } })));
  await expect(grid).toBeChecked(); await expect(opacity).toHaveValue('65');
  await page.evaluate(() => {
    const update = window.gwNative.hubSettings.update;
    const saves: unknown[] = [];
    Object.assign(window, { acceptanceSaves: saves });
    window.gwNative.hubSettings.update = async change => { saves.push(change); return update(change); };
  });
  await grid.focus();
  await page.keyboard.press('Space'); await expect(grid).toBeFocused();
  await page.keyboard.press('Space'); await expect(grid).toBeFocused();
  await expect(page.locator('.hub-settings')).not.toHaveAttribute('aria-busy', 'true');
  expect(await page.evaluate(() => (window as typeof window & { acceptanceSaves: unknown[] }).acceptanceSaves)).toEqual([
    { kind: 'settings', patch: { cartographyGridEnabled: false } },
    { kind: 'settings', patch: { cartographyGridEnabled: true } },
  ]);
  await opacity.focus();
  for (let step = 0; step < 5; step++) { await page.keyboard.press('ArrowRight'); await expect(opacity).toBeFocused(); }
  await expect(page.locator('.hub-settings')).not.toHaveAttribute('aria-busy', 'true');
  await expect(opacity).toHaveValue('70'); await expect(opacity).toBeFocused();
  await page.goto('/?hub&settings-ms=50');
  await search.fill('maps'); await search.press('Enter');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { cartographyGridEnabled: true, cartographyGridOpacity: 100 } })));
  await expect(grid).toBeChecked();
  await opacity.focus();
  await expect(opacity).toHaveValue('100');
  for (let step = 0; step < 15; step++) { await page.keyboard.press('ArrowLeft'); await expect(opacity).toBeFocused(); }
  await expect(page.locator('.hub-settings')).not.toHaveAttribute('aria-busy', 'true');
  await expect(opacity).toHaveValue('85'); await expect(opacity).toBeFocused();
});

// docs/settings.md: every game setting is found by its words and changes in game; the rest is one link away.
test('a setting is found by its words, changes in game, follows the launcher, and links to what the launcher keeps', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('memory');
  await expect(page.locator('.hub-primary')).toHaveText(/^Open setting/);
  await search.press('Enter');
  const memory = page.getByRole('checkbox', { name: 'Extended memory' });
  await expect(page.locator('.hub-settings-body h2')).toHaveText('Game');
  await expect(memory).toBeFocused();
  await page.keyboard.press('Space');
  await expect(memory).toBeChecked();
  await expect(memory).toBeFocused();
  await expect(page.locator('.hub-settings')).not.toHaveAttribute('aria-busy','true');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { extendedMemoryEnabled: false } })));
  await expect(memory).not.toBeChecked();
  await page.getByRole('button', { name: 'Updates, game files and texture packs' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-action', 'Settings general');
  // The memory warning's link lands on Extended memory even when Settings was left on another section.
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.evaluate(() => window.gwHub?.openSettings({ section: 'Game', control: 'Extended memory' }));
  await expect(page.locator('.hub-settings-body h2')).toHaveText('Game');
  await expect(memory).toBeFocused();
});

test('a scoped list names what its search searches, as placeholder and accessible name (HUB-096)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await expect(search).toHaveAccessibleName('Search people, places, builds…');
  await search.fill('build smiter'); await search.press('Enter');
  await search.fill('hero'); await search.press('Enter');
  await expect(search).toHaveAttribute('placeholder', 'Search heroes…');
  await expect(search).toHaveAccessibleName('Search heroes…');
});
