import { expect, test } from '@playwright/test';

test('template folders and explicit self application stay inside Hub', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  const hub = page.locator('#hub');
  await search.fill('build library'); await search.press('Enter');
  await search.fill('Guild Wars templates'); await search.press('Enter');
  await expect(hub.getByRole('option', { name: 'Monk Template folder', exact: true })).toBeVisible();
  await search.fill('Monk'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Build Library›Guild Wars templates›Monk');
  await expect(hub.getByRole('option')).toContainText('Protection');
  await page.screenshot({ path: info.outputPath('hub-template-folder.png') });
  await search.press('Enter');
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
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  await search.fill('hero'); await search.press('Enter');
  await search.fill('Dunkoro');
  await expect(page.locator('#hub').getByRole('option')).toContainText('Add Dunkoro to your party first.');
  await expect(page.getByRole('button', { name: 'Review availability ↵', exact: true })).toBeEnabled();
  await search.press('Enter');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await expect(page.getByRole('button', { name: /^Apply .+ to Dunkoro ↵$/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('Tahlkora');
  await expect(page.locator('#hub').getByRole('option')).toHaveAttribute('aria-disabled', 'false');
  await page.screenshot({ path: info.outputPath('hub-hero-search.png') });
  await search.press('Enter');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#app')).toHaveAttribute('data-action', /command:/);
  await expect(page.locator('.hub-receipt')).toContainText('applied to Tahlkora');
});

test('only Hub locks, reset restores its default frame, and popouts have visible plain X controls', async ({ page }) => {
  await page.goto('/?hub');
  const panel = page.locator('.hub-panel');
  const initial = await panel.boundingBox();
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).click();
  await page.getByRole('button', { name: 'Lock Hub position', exact: true }).press('Alt+ArrowLeft');
  await page.getByRole('button', { name: 'Resize Hub', exact: true }).press('ArrowLeft');
  expect(await panel.boundingBox()).not.toEqual(initial);
  const search = page.locator('.hub-search input');
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
  const search = page.locator('.hub-search input');
  const incoming = page.getByRole('region', { name: 'Build to apply', exact: true });
  await search.fill('build monk'); await search.press('ArrowRight');
  await expect(incoming).toContainText('Protection');
  const self = page.locator('#hub').getByRole('option', { name: /Apply to me/ });
  await expect(self).toContainText('Current build');
  await expect(self.getByRole('img', { name: 'Healing Prayers 12', exact: true })).toBeVisible();
  await expect(incoming.locator('.hub-skill').first()).toHaveAttribute('aria-label', '1. Protective Spirit');
  await expect(self.locator('.hub-skill').first()).toHaveAttribute('aria-label', '1. Word of Healing');
  await page.screenshot({ path: info.outputPath('hub-player-comparison.png') });
  await search.fill('hero'); await search.press('ArrowRight');
  await expect(incoming).toContainText('Protection');
  await search.fill('Tahlkora'); await search.press('ArrowRight');
  await expect(page.locator('.hub-caption')).toHaveText('Tahlkora');
  await expect(page.locator('#hub').getByRole('option')).toContainText('Current build');
  await expect(page.locator('#hub').getByRole('option').locator('.hub-skill')).toHaveCount(8);
  await expect(incoming.locator('.hub-skill')).toHaveCount(8);
  await search.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.screenshot({ path: info.outputPath('hub-hero-comparison.png') });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-scenario', { detail: 'unobserved-builds' })));
  await expect(page.locator('#hub').getByRole('option').locator('.hub-skill')).toHaveCount(0);
  await expect(page.locator('#hub').getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await expect(search).toBeFocused();
  await expect(incoming.locator('.hub-skill')).toHaveCount(8);
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Heroes');
  await expect(search).toHaveValue('Tahlkora');
  await expect(incoming).toContainText('Protection');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(incoming).toBeHidden();
});

for (const viewport of [{ width: 320, height: 800 }, { width: 640, height: 500 }]) {
  test(`build comparison remains usable at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await page.goto('/?hub');
    const search = page.locator('.hub-search input');
    await search.fill('build monk'); await search.press('ArrowRight');
    const summary = page.locator('.hub-summary');
    await expect(summary.getByRole('img').last()).toBeInViewport();
    const current = page.locator('#hub').getByRole('option', { name: /Apply to me/ });
    await current.getByRole('img').last().scrollIntoViewIfNeeded();
    await expect(current.getByRole('img').last()).toBeInViewport();
    await expect(page.getByRole('button', { name: /^Apply .+ to Fixture Monk ↵$/ })).toBeInViewport();
    expect(await page.locator('.hub-results').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('hub-comparison-compact.png') });
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 800 }]) {
  test(`compact build results keep inline metadata at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await page.goto('/?hub');
    const search = page.locator('.hub-search input');
    await search.fill('build monk');
    await expect(page.locator('.hub-preview')).toBeHidden();
    const rows = page.locator('.hub-build-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).not.toContainText('.txt');
    await expect(rows.first().locator('.hub-title')).toHaveText('Protection Mo/Me Monk');
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


test('folder-qualified builds show a subtle path and preserve it through review and Back', async ({ page }, info) => {
  await page.goto('/?hub');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.getByLabel('Fixture scenario', { exact: true }).selectOption('folders');
  const search = page.locator('.hub-search input');
  for (const query of ['build team builds farming monk', 'build "Team Builds/Farming" monk', 'build folder:"Team Builds/Farming" mo']) {
    await search.fill(query);
    const row = page.locator('.hub-build-row');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.hub-title')).toHaveText('Protection Mo/Me Team Builds/Farming');
    await expect(row.locator('.hub-folder-label svg')).toBeVisible();
  }
  await search.press('ArrowRight');
  await expect(page.locator('.hub-summary .hub-folder-label')).toHaveText('Team Builds/Farming');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('build folder:"Team Builds/Farming" mo');
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.locator('.hub-results').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const folder = (await page.locator('.hub-build-row .hub-folder-label').boundingBox())!;
  const row = (await page.locator('.hub-build-row').boundingBox())!;
  expect(folder.x + folder.width).toBeLessThanOrEqual(row.x + row.width);
  expect(folder.y + folder.height).toBeLessThanOrEqual(row.y + row.height);
  await page.screenshot({ path: info.outputPath('hub-folder-search.png') });
});


test('nested folders browse one level at a time and use the same build filters', async ({ page }) => {
  await page.goto('/?hub');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.getByLabel('Fixture scenario', { exact: true }).selectOption('folders');
  const search = page.locator('.hub-search input');
  await search.fill('build'); await search.press('Enter');
  await search.fill('Guild Wars templates'); await search.press('Enter');
  await search.fill('Team Builds'); await search.press('Enter');
  await expect(page.locator('.hub-row')).toContainText(['Dungeons', 'Farming']);
  await search.fill('Farming'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toContainText('Team Builds›Farming');
  await search.fill('folder:"Team Builds/Farming" monk');
  await expect(page.locator('.hub-build-row')).toHaveCount(1);
  await expect(page.locator('.hub-build-row')).toContainText('Protection');
});

test('comparison details are keyboard accessible without applying a build', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  await expect(page.locator('.hub-row [data-changed=true]').first()).toBeVisible();
  await page.keyboard.press('Meta+j');
  await expect(page.getByRole('menuitem', { name: /^Apply / })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('.hub-build-details')).toContainText('Protective Spirit');
  await expect(page.locator('.hub-build-details')).toContainText('Healing Prayers');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
});

for (const width of [390, 1280]) {
test(`recent build targets and editor handoff retain their place at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 });
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  await search.fill('hero'); await search.press('Enter');
  await search.fill('Tahlkora'); await search.press('Enter');
  await expect(page.locator('#hub')).toBeHidden();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await page.locator('.hub-row[data-id^="recent:"]').click();
  await expect(page.locator('.hub-caption')).toHaveText('Tahlkora');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Already equipped');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('build Word of Healing'); await search.press('Enter');
  await expect(page.getByRole('region', { name: 'Build to apply', exact: true })).toContainText('Word of Healing');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show build details' }).click();
  await page.getByRole('button', { name: 'Open in Build Library', exact: true }).click();
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('.tools-window')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Build name', exact: true })).toHaveValue('Word of Healing');
  await expect.poll(() => page.locator('.tools-window').evaluate(panel => panel.contains(document.activeElement))).toBe(true);
  await page.getByRole('button', { name: 'Close Build Library', exact: true }).click();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(page.locator('.hub-build-details')).toBeVisible();
});
}

test('mixed hero professions default to the eligible hero and keep blocked heroes inspectable', async ({ page }) => {
  await page.goto('/?hub');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.getByLabel('Fixture scenario', { exact: true }).selectOption('mixed-professions');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  await search.fill('hero'); await search.press('Enter');
  await expect(page.locator('.hub-row[aria-selected="true"]')).toContainText('Tahlkora');
  const blocked = page.locator('.hub-row').filter({ hasText: "Gwen's assigned build is for Monk, but the observed primary is Mesmer." });
  await expect(blocked).toHaveAccessibleDescription("Slot 5 · Gwen's assigned build is for Monk, but the observed primary is Mesmer.. Mesmer / Monk. Skills: Patient Spirit, Guardian, Resurrection Chant, Protective Spirit, Word of Healing, Aegis, Dismiss Condition, Spirit Bond. Right Arrow opens the child page.");
  const ink = await blocked.evaluate(row => ({ title: getComputedStyle(row.querySelector('.hub-title')!).color, detail: getComputedStyle(row.querySelector('.hub-detail')!).color }));
  expect(ink.title).toBe(ink.detail);
  await blocked.click();
  await expect(page.locator('.hub-primary')).toBeDisabled();
  await expect(page.locator('.hub-summary')).toContainText('Protection');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await search.fill('library');
  await expect(page.locator('.hub-row')).toHaveCount(0);
  await expect(page.locator('#hub')).not.toContainText('Build Library is loading');
});


test('self application has one comparison page and Right never adds another', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('ArrowRight');
  const crumbs = page.locator('.hub-breadcrumbs');
  await search.press('ArrowRight');
  await expect(crumbs).toHaveText('Home›Protection');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/u);
});

test('details from Choose hero show the incoming build without an empty second card', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  await search.fill('hero'); await search.press('Meta+j');
  await page.getByRole('menuitem', { name: 'Show build details', exact: true }).click();
  await expect(page.locator('.hub-build-details h2')).toHaveCount(1);
  await expect(page.locator('.hub-build-details')).toContainText('Protective Spirit');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/u);
});


test('library words open the loaded Library and its teams stay review-only when browsing', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  // Bare `team` and `teams` also list the saved teams themselves (HUB-087).
  for (const query of ['library', 'lib', 'bu', 'team', 'teams', 'skills']) {
    await search.fill(query);
    const entry = page.locator('.hub-row[data-id="builds"]');
    await expect(entry).toContainText('Browse saved builds and teams');
    await expect(entry).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('.hub-primary')).toBeEnabled();
    await entry.click();
    await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Build Library');
    await expect(page.locator('#hub')).not.toContainText('Build Library is loading.');
    await page.getByRole('button', { name: 'Home', exact: true }).click();
  }
  await search.fill('teams');
  await expect(page.locator('#hub .hub-row[data-id^="team:"]')).toHaveCount(4);
  await search.fill('library'); await search.press('Enter');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home›Build Library');
  const teams = page.locator('.hub-row[data-id^="team:"]');
  await expect(teams).toHaveCount(4);
  await expect(teams).toContainText(['GOM AFK', 'Balanced vanquish', 'Classic Discordway', 'Story and missions']);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  for (const query of ['teams ', 'team gom']) {
    await search.fill(query);
    await expect(page.locator('.hub-primary')).toHaveText(/^Review /u);
    await search.press('Enter');
    await expect(page.locator('.hub-build-review')).toBeVisible();
    await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/u);
    await page.keyboard.press('Meta+Backspace');
    await expect(search).toHaveValue(query);
  }
  await search.fill('team gom afk');
  await expect(page.locator('.hub-primary')).toHaveText('Apply team GOM AFK↵');
});

test('team review names planned changes and repeat Apply reports that the party already matches', async ({ page }) => {
  await page.setViewportSize({ width: 940, height: 500 });
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('team gom afk'); await search.press('ArrowRight');
  await expect(page.locator('.hub-build-review')).toContainText('Switches to Hard Mode');
  await expect(page.locator('.hub-review-roster .hub-skill-bar').first()).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Apply team GOM AFK ↵', exact: true }).click();
  await expect(page.locator('#hub')).toBeHidden();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await search.fill('team gom afk');
  await expect(page.locator('.hub-preview')).toContainText('Already matches');
  await search.press('Enter');
  await expect(page.locator('.hub-receipt')).toHaveText('GOM AFK already matches.');
  const receipt = page.locator('.hub-receipt');
  await expect(receipt).toHaveClass(/ui-toast/u);
  expect(await receipt.evaluate(el => getComputedStyle(el).fontFamily)).toBe(await search.evaluate(el => getComputedStyle(el).fontFamily));
  await expect(receipt).toHaveAttribute('data-tone', 'success');
  expect(await receipt.evaluate(el => el.matches(':popover-open'))).toBe(true);
  for (const style of ['guild-wars', 'obsidian'] as const) {
    for (const font of ['guild-wars', 'inter', 'system', 'avenir', 'georgia', 'palatino'] as const) {
      await page.evaluate(({ style, font }) => window.gwApplyFixtureAppearance?.({ uiStyle: style, uiFont: font, uiPanelOpacity: 65 }), { style, font });
      expect(await receipt.evaluate(el => getComputedStyle(el).fontFamily)).toBe(await search.evaluate(el => getComputedStyle(el).fontFamily));
      const ratio = await receipt.evaluate(el => {
        const context = document.createElement('canvas').getContext('2d')!;
        const rgba = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
        const css = getComputedStyle(el), ink = rgba(css.color), fill = rgba(css.backgroundColor);
        const background = fill.slice(0, 3).map(channel => channel * fill[3]! / 255 + 255 - fill[3]!);
        const foreground = ink.slice(0, 3).map((channel, index) => channel * ink[3]! / 255 + background[index]! * (1 - ink[3]! / 255));
        const luminance = (rgb: number[]) => { const linear = rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }); return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!; };
        const back = luminance(background), text = luminance(foreground);
        return (Math.max(back, text) + .05) / (Math.min(back, text) + .05);
      });
      expect(ratio, `${style}/${font} receipt over white`).toBeGreaterThanOrEqual(4.5);
    }
  }
  await page.evaluate(() => window.gwFixtureCanvas?.clear());
  const receiptBox = (await receipt.boundingBox())!;
  expect(await receipt.evaluate((el, box) => el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), receiptBox)).toBe(false);
  expect(await page.evaluate(() => document.elementFromPoint(24, 300)?.id)).toBe('canvas');
  await page.mouse.click(24, 300);
  expect(await page.evaluate(() => window.gwFixtureCanvas?.events.map(event => event.type))).toEqual(['pointerdown', 'mousedown', 'mouseup', 'click']);
  await page.keyboard.press('Meta+b');
  await expect(page.locator('.tools-window')).toBeVisible();
  expect(await receipt.evaluate(el => el.matches(':popover-open'))).toBe(true);
  expect(await receipt.evaluate(el => el.contains(document.activeElement))).toBe(false);
  await page.keyboard.press('Meta+r');
  await expect(receipt).toBeHidden();
  expect(await receipt.evaluate(el => el.matches(':popover-open'))).toBe(false);
});

test('interrupted team Apply reopens a review with completed and remaining changes and an editor action', async ({ page }) => {
  await page.goto('/?hub');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.getByLabel('Fixture scenario', { exact: true }).selectOption('partial');
  const search = page.locator('.hub-search input');
  await search.fill('team gom afk'); await search.press('Enter');
  await expect(page.locator('.hub-row')).toContainText('Partly applied · Review');
  await search.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Review GOM AFK ↵', exact: true })).toBeEnabled();
  await search.press('Enter');
  const review = page.locator('.hub-build-review');
  await expect(review.getByRole('status')).toContainText('Team partly applied. Synthetic interruption');
  await expect(page.locator('.hub-status')).toBeEmpty();
  await expect(review).toContainText('Completed');
  await expect(review).toContainText('Enabling Hard Mode confirmed.');
  await expect(review).toContainText('Remaining');
  await expect(review).toContainText('Update your build');
  await page.keyboard.press('Meta+j');
  const actions = page.getByRole('menu', { name: 'Actions', exact: true });
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('menuitem')).toContainText(['Apply team GOM AFK', 'Open in Build Library']);
  await page.keyboard.press('Escape');
  await expect(actions).toBeHidden();
  await expect.poll(() => review.evaluate(view => view.contains(document.activeElement))).toBe(true);
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await actions.getByRole('menuitem', { name: 'Open in Build Library', exact: true }).click();
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Team name', exact: true })).toHaveValue('GOM AFK');
  await page.getByRole('button', { name: 'Close Build Library', exact: true }).click();
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await page.keyboard.press('Meta+r');
  await search.fill('team balanced vanquish'); await search.press('ArrowRight');
  await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: 'Open in Build Library', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Team name', exact: true })).toHaveValue('Balanced vanquish');
});


test('an unrelated source toggle keeps the build target page, query and selection', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  await search.fill('hero'); await search.press('Enter'); await search.fill('Tahlkora');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { travelPalette: false } })));
  await expect(page.locator('.hub-caption')).toHaveText('Heroes');
  await expect(search).toHaveValue('Tahlkora');
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Tahlkora');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-fixture-lifecycle', { detail: 'map-loading' })));
  await expect(page.locator('.hub-caption')).toHaveText('Heroes');
  await expect(search).toHaveValue('Tahlkora');
  await expect(page.locator('.hub-row[aria-selected=true]')).toContainText('Tahlkora');

  await page.goto('/?hub');
  await search.fill('accounts'); await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Accounts');
  await page.evaluate(() => window.gwHub?.openSettings({ section: 'Tools' }));
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Travel', exact: true }).uncheck();
  await expect(page.locator('.hub-caption')).toHaveText('Settings');
  await expect(page.getByRole('button', { name: 'Tools', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('checkbox', { name: 'Travel', exact: true })).not.toBeChecked();
});

test('a suspended build page cannot resume its withdrawn source or execute stale Apply', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('build monk'); await search.press('Enter');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-withdraw-library')));
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('.hub-row')).not.toContainText(['Apply to me', 'Apply to hero']);
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
  await search.fill('library');
  await expect(page.locator('.hub-row')).toHaveCount(0);
  await expect(page.locator('#hub')).not.toContainText('Build Library is loading');
});


test('a new details view clears the previous page pin receipt', async ({ page }) => {
  await page.goto('/?hub');
  await page.locator('.hub-search input').fill('build Word of Healing');
  await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: 'Pin to Hub', exact: true }).click();
  await expect(page.locator('.hub-status')).toHaveText('Pinned Word of Healing.');
  await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: 'Show build details', exact: true }).click();
  await expect(page.locator('.hub-build-details')).toBeVisible();
  await expect(page.locator('.hub-status')).toBeEmpty();
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-search input')).toHaveValue('build Word of Healing');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('.hub-status')).toBeEmpty();
});


test('a suspended saved-build phrase editor cannot resume after its Library withdraws', async ({ page }) => {
  await page.goto('/?hub');
  await page.locator('.hub-search input').fill('build Word of Healing');
  await page.keyboard.press('Meta+j');
  await page.getByRole('menuitem', { name: 'Set search phrase…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search phrase', exact: true }).fill('unfinished healing phrase');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-withdraw-library')));
  await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search phrase', exact: true })).toHaveCount(0);
  await expect(page.locator('.hub-caption')).toHaveText('Home');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /command|apply/);
});
