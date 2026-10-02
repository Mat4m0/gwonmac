import { expect, test } from '@playwright/test';

test('Settings retries in place and retains its failure across sections (HUB-236)', async ({page}) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const get = window.gwNative.hubSettings.get;
    let attempts = 0;
    window.gwNative.hubSettings.get = async () => {
      if (++attempts === 1) throw new Error('offline fixture failure');
      return get();
    };
  });
  const search = page.locator('.hub-search input');
  await search.fill('settings'); await search.press('Enter');
  await expect(page.locator('.hub-settings-status')).toContainText('Settings could not load');
  await page.getByRole('button', {name: 'Game', exact: true}).click();
  await expect(page.locator('.hub-settings-status')).toContainText('Settings could not load');
  await page.locator('.hub-primary').click();
  await expect(page.locator('.hub-settings-body h2')).toHaveText('Game');
  await expect(page.locator('.hub-settings-status')).toBeEmpty();
  await expect(page.locator('#hub')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});


test('Tools and Shortcuts use the same names as Hub results (HUB-180)', async ({page}) => {
  await page.goto('/?hub'); await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  for (const [query, name] of [['travel', 'Travel'], ['character', 'Switch Character'], ['storage', 'Xunlai Storage'], ['builds', 'Build Library'], ['trade', 'Trade Chat'], ['whispers', 'Whispers']]) {
    await search.fill(query === 'builds' ? 'build library' : query!);
    await expect(page.locator(`.hub-row[data-id="${query}"] .hub-title`)).toHaveText(name!);
  }
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  for (const name of ['Travel', 'Switch Character', 'Xunlai Storage', 'Build Library', 'Trade Chat', 'Whispers']) await expect(page.getByRole('checkbox', {name, exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Shortcuts', exact: true}).click();
  for (const name of ['Travel', 'Switch Character', 'Xunlai Storage', 'Build Library', 'Trade Chat', 'Whispers']) await expect(page.getByRole('button', {name, exact: true})).toBeVisible();
});


test('reduced motion keeps every Hub transition and running progress static (VIS-33)', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/?hub&slow-apply'); await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const assertStatic = async () => {
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await page.locator('#hub, #hub *').evaluateAll(els => els.every(el => getComputedStyle(el).transitionDuration.split(',').every(value => parseFloat(value) === 0)))).toBe(true);
  };
  await assertStatic();
  const search=page.locator('.hub-search input'); await search.fill('travel'); await search.press('Enter'); await assertStatic();
  await page.keyboard.press('Meta+r'); await search.fill('Romi'); await search.press('Meta+j');
  await expect(page.locator('.hub-menu')).toBeVisible(); await assertStatic(); await page.keyboard.press('Escape');
  await search.fill('team gom afk'); await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('aria-disabled','false'); await search.press('Enter');
  await expect(page.locator('.hub-status')).toHaveText(/^Applying GOM AFK/); await assertStatic();
  expect(await page.locator('.hub-progress').evaluate(el=>getComputedStyle(el,'::after').animationName)).toBe('none');
  await page.locator('.hub-close').click(); await expect(page.locator('#hub')).toBeHidden(); await assertStatic();
});
