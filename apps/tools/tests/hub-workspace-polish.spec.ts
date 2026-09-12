import { expect, test } from '@playwright/test';

test('Trade gives the ledger space and retains its offer through actions and docking', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('trade'); await search.press('Enter');
  await expect(page.getByRole('list', { name: 'Trade offers' })).toBeVisible();
  const fullyVisible = await page.locator('.trade-list').evaluate(list => {
    const box = list.getBoundingClientRect();
    return [...list.querySelectorAll('.trade-row')].filter(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= box.top && rect.bottom <= box.bottom;
    }).length;
  });
  expect(fullyVisible).toBeGreaterThanOrEqual(5);
  await page.getByRole('button', { name: 'Inspect offer from Silver Wayfarer', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Offer from Silver Wayfarer' });
  await expect(inspector).toContainText('105 consets');
  await page.locator('.offer-actions > summary').click();
  await expect(page.getByRole('button', { name: 'Copy offer', exact: true })).toBeVisible();
  await page.locator('.offer-actions > summary').press('Escape');
  await expect(page.locator('.offer-actions')).not.toHaveAttribute('open');
  await expect(inspector).toBeVisible();
  await page.getByRole('button', { name: 'Pop out', exact: true }).click();
  await expect(page.locator('#hub')).not.toBeVisible();
  await expect(inspector).toBeVisible();
  await page.getByRole('button', { name: 'Open in Hub', exact: true }).click();
  await expect(page.locator('#hub')).toBeVisible();
  await expect(inspector).toContainText('105 consets');
  await expect(page.locator('.hub-back')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Whisper Silver Wayfarer', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('trade.png') });
});

test('team authoring prioritizes the roster while options and persisted edits stay available', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('build'); await search.press('Enter');
  await page.getByRole('button', { name: /Favourite GOM AFK/ }).click();
  await expect(page.locator('.team-options')).not.toHaveAttribute('open');
  const visibleSlots = await page.locator('.team-scroll').evaluate(list => {
    const box = list.getBoundingClientRect();
    return [...list.querySelectorAll('[data-team-slot]')].filter(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= box.top && rect.bottom <= box.bottom;
    }).length;
  });
  expect(visibleSlots).toBeGreaterThanOrEqual(3);
  await page.locator('.team-options > summary').click();
  await page.getByRole('button', { name: 'Normal', exact: true }).click();
  await expect(page.locator('.team-options > summary')).toContainText('Normal Mode');
  await page.locator('.team-options > summary').click();
  await expect(page.locator('.team-actions')).toContainText('update 8 builds');
  await page.getByRole('button', { name: 'Pop out', exact: true }).click();
  await page.getByRole('button', { name: 'Open in Hub', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Team name', exact: true })).toHaveValue('GOM AFK');
  await expect(page.locator('.team-options > summary')).toContainText('Normal Mode');
  await page.screenshot({ path: info.outputPath('team-editor.png') });
  await page.reload();
  await search.fill('team gom afk');
  await expect(page.locator('.hub-preview')).toContainText('Normal Mode');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
});

for (const viewport of [{ width: 390, height: 650 }, { width: 640, height: 480 }]) {
  test(`team options remain reachable in a constrained Hub at ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto('/?hub');
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await search.fill('build'); await search.press('Enter');
    await page.getByRole('button', { name: /Favourite GOM AFK/ }).click();
    await page.locator('.team-options > summary').click();
    await page.getByRole('button', { name: 'Normal', exact: true }).click();
    await expect(page.locator('.team-options > summary')).toContainText('Normal Mode');
    await expect(page.getByRole('button', { name: 'Apply team', exact: true })).toBeInViewport();
    const overflow = await page.locator('.hub-panel').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('team-options.png') });
  });
}
