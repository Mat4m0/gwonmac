import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 650 }, { width: 640, height: 480 }]) {
  test(`full team preview stays readable inside the frame at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto('/?hub');
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
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
  await expect(page.locator('.hub-caption')).toContainText("Lion's Arch");
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('trade');
  await expect(page.locator('.hub-hint')).toContainText('trade arms');
  await expect(page.locator('.hub-row-type kbd')).toHaveText(['⌘', 'K']);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { shortcutOverrides: { 'trade.toggle': null } } })));
  await expect(page.locator('.hub-row-type kbd')).toHaveCount(0);
  await search.fill('team');
  await expect(page.locator('.hub-hint')).toContainText('team gom afk');
  await search.fill('team gom afk');
  await expect(page.locator('.hub-scope')).toHaveText('team');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.locator('.hub-actions')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toContainText('Back to Home');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('team gom afk');
});

test('Maps follows external settings and recovers from a failed save', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('maps'); await search.press('Enter');
  const grid = page.getByRole('switch', { name: 'Exploration grid' });
  const opacity = page.getByRole('slider', { name: 'Grid opacity' });
  await grid.uncheck();
  await expect(opacity).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { cartographyGridEnabled: true, cartographyGridOpacity: 45 } })));
  await expect(grid).toBeChecked();
  await expect(opacity).toBeEnabled();
  await expect(opacity).toHaveValue('45');
  await page.evaluate(() => {
    const save = window.gwNative.settings.set;
    let fail = true;
    window.gwNative.settings.set = async patch => {
      if (fail) { fail = false; throw new Error('Offline fixture failure'); }
      return save(patch);
    };
  });
  await grid.click();
  await expect(grid).toBeChecked();
  await expect(page.locator('.hub-map-settings > p[role="status"]')).toContainText('Could not save');
  await grid.uncheck();
  await expect(grid).not.toBeChecked();
  await expect(page.locator('.hub-map-settings > p[role="status"]')).toBeHidden();
});
