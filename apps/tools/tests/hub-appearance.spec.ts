import { test, expect, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

for (const ratio of [1, 2]) {
  test.describe(`Classic frame at ${ratio}×`, () => {
    test.use({ deviceScaleFactor: ratio, viewport: { width: 1280, height: 720 } });
    test('artwork remains decorative and leaves saved opacity in control', async ({ page }, info) => {
      // Hosted Macs can prefer reduced transparency. Exercise both material
      // modes explicitly instead of inheriting the machine's accessibility setting.
      const media = await page.context().newCDPSession(page);
      await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
      await page.goto('/?hub');
      const frame = page.locator('#hub .ui-frame-artwork');
      await expect(page.locator('.hub-panel')).toHaveClass(/ui-art-frame/);
      await expect.poll(() => frame.evaluate(element => element instanceof HTMLCanvasElement ? element.width : 0)).toBe(780 * ratio);
      await expect(frame).toHaveAttribute('aria-hidden', 'true');
      const pixels = await frame.evaluate(element => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected frame canvas');
        const context = element.getContext('2d')!;
        return {
          centre: context.getImageData(element.width / 2, element.height / 2, 1, 1).data[3],
          title: context.getImageData(element.width / 2, 20 * devicePixelRatio, 1, 1).data[3],
          pointer: getComputedStyle(element).pointerEvents,
        };
      });
      expect(pixels.centre).toBe(0);
      expect(pixels.title).toBeGreaterThan(0);
      expect(pixels.pointer).toBe('none');
      await expect.poll(() => page.evaluate(async () => { await document.fonts.load('14px QTFrizQuad'); return document.fonts.check('14px QTFrizQuad'); })).toBe(true);
      const box = await page.locator('.hub-panel').boundingBox();
      await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 65 }));
      await expect.poll(() => page.locator('.hub-panel').evaluate(element => getComputedStyle(element, '::before').backgroundColor)).toMatch(/0\.65\)/);
      await page.screenshot({ path: info.outputPath('classic-home-65.png') });
      await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
      await expect.poll(() => page.locator('.hub-panel').evaluate(element => getComputedStyle(element, '::before').backgroundColor)).toBe('rgb(8, 8, 7)');
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-panel-opacity'))).toBe('0.65');
      await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
      await expect.poll(() => page.locator('.hub-panel').evaluate(element => getComputedStyle(element, '::before').backgroundColor)).toMatch(/0\.65\)/);
      await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'obsidian', uiPanelOpacity: 100 }));
      await expect(frame).toBeHidden();
      expect(await page.locator('.hub-panel').boundingBox()).toEqual(box);
      await page.screenshot({ path: info.outputPath('modern-home.png') });
      await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94 }));
      await expect(frame).toBeVisible();
      const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
      await search.fill('travel'); await search.press('Enter');
      expect(await page.locator('.hub-panel').boundingBox()).toEqual(box);
      await page.screenshot({ path: info.outputPath('classic-travel.png') });
      await page.setViewportSize({ width: 800, height: 600 });
      await expect(page.getByRole('combobox', { name: 'Destination, phrase, or friend' })).toBeVisible();
      expect(await page.locator('.hub-panel').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath('classic-travel-compact.png') });
    });
  });
}


test('saved font and custom title material apply to the real Hub without losing query', async ({ page }, info) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByLabel('Panel font', { exact: true }).selectOption('inter');
  await expect.poll(() => page.locator('.hub-name').evaluate(element => getComputedStyle(element).fontFamily)).toContain('Inter');
  await page.getByLabel('Panel style', { exact: true }).selectOption('obsidian');
  await expect(page.locator('#hub > .hub-panel > .ui-frame-artwork')).toBeHidden();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('settings');
  await page.evaluate(() => window.gwApplyFixtureAppearance?.({
    uiStyle: 'custom', uiPanelOpacity: 94, uiFont: 'inter',
    uiCustomTheme: { material: 'classic', window: '#172025', titlebar: '#365063', surface: '#263948', recessed: '#10181F', selected: '#315B7A', accent: '#E6C882', text: '#F1EBDD', mutedText: '#B7B09F', border: '#D8D2BF', windowGradient: false },
  }));
  await expect(page.locator('#hub > .hub-panel > .ui-frame-artwork')).toBeVisible();
  await expect.poll(() => page.locator('.hub-heading').evaluate(element => getComputedStyle(element).backgroundImage)).toContain('54, 80, 99');
  await expect(search).toHaveValue('settings');
  await page.screenshot({ path: info.outputPath('custom-classic-inter.png') });
});


test('compact Hub keeps navigation reachable with reduced motion over a bright backdrop', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?hub');
  await page.addStyleTag({ content: 'body { background: repeating-conic-gradient(#fff 0% 25%, #ddd 0% 50%) 0 / 32px 32px !important; }' });
  await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 65 }));
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('travel'); await search.press('Enter');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeInViewport();
  await expect(page.getByRole('combobox', { name: 'Destination, phrase, or friend' })).toBeInViewport();
  expect(await page.locator('.hub-panel').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('travel-bright-390-reduced-motion.png') });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('travel');
  // Measure the composed pixels beneath real row text, including the game
  // backdrop and selection fill. Hiding ink leaves geometry and paint intact.
  const labels = await page.locator('.hub-title, .hub-detail').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { text: element.textContent, color: getComputedStyle(element).color, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }));
  const hiddenInk = await page.addStyleTag({ content: '.hub-title, .hub-detail { visibility:hidden; }' });
  const composed = PNG.sync.read(await page.screenshot());
  await hiddenInk.evaluate(element => element.remove());
  const luminance = (rgb: number[]) => {
    const linear = rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
    return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
  };
  for (const label of labels) {
    const offset = (Math.floor(label.y) * composed.width + Math.floor(label.x)) * 4;
    const background = luminance([...composed.data.subarray(offset, offset + 3)]);
    const foreground = luminance(label.color.match(/[\d.]+/g)!.slice(0, 3).map(Number));
    expect((Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05), label.text ?? 'row text').toBeGreaterThanOrEqual(4.5);
  }
});


// The Launcher's default custom palette with the "Modern flat" finish. Any
// border other than the Modern baseline makes `--ui-frame` opaque, so a frame
// mask that loses its cut-out paints that border over the whole window.
const customModern = (border: string) => ({
  material: 'modern' as const, window: '#0B0B0B', titlebar: '#292927', surface: '#202225', recessed: '#080807', selected: '#1B3554',
  accent: '#E6C882', text: '#F1EBDD', mutedText: '#B7B09F', border, windowGradient: true,
});

/** Proves a custom Modern window paints its content rather than a border sheet:
 * the frame keeps its cut-out, the first row's centre is not the border colour,
 * and the row's ink reads at 4.5:1 over the composed pixels beneath it. */
async function expectRowPainted(page: Page, panel: Locator, row: Locator, ink: Locator, border: string) {
  expect(await panel.evaluate(element => getComputedStyle(element, '::before').maskComposite)).toContain('exclude');
  const probe = async (target: Locator) => target.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { color: getComputedStyle(element).color, x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + box.height / 2) };
  });
  const [centre, label] = [await probe(row), await probe(ink)];
  await row.evaluate(element => element.setAttribute('data-ink-probe', ''));
  const hiddenInk = await page.addStyleTag({ content: '[data-ink-probe], [data-ink-probe] * { color: transparent !important; text-shadow: none !important; }' });
  const composed = PNG.sync.read(await page.screenshot());
  await hiddenInk.evaluate(element => element.remove());
  await row.evaluate(element => element.removeAttribute('data-ink-probe'));
  const pixel = (x: number, y: number) => [...composed.data.subarray((y * composed.width + x) * 4, (y * composed.width + x) * 4 + 3)];
  const sheet = border.match(/[0-9a-f]{2}/giu)!.map(channel => parseInt(channel, 16));
  const rowPixel = pixel(centre.x, centre.y);
  expect(Math.max(...rowPixel.map((channel, index) => Math.abs(channel - sheet[index]!))), `row centre ${rowPixel} vs border ${border}`).toBeGreaterThan(16);
  const luminance = (rgb: number[]) => {
    const linear = rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
    return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
  };
  const background = luminance(pixel(label.x, label.y));
  const foreground = luminance(label.color.match(/[\d.]+/gu)!.slice(0, 3).map(Number));
  expect((Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05), `row ink over ${border}`).toBeGreaterThanOrEqual(4.5);
}

test.describe('custom theme with the Modern flat finish', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('Hub rows stay visible for every border and opacity', async ({ page }, info) => {
    await page.goto('/?hub');
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await search.fill('kam');
    const panel = page.locator('.hub-panel');
    const rows = page.locator('#hub .hub-row');
    await expect(rows).toHaveCount(2);
    for (const [border, opacity] of [['#D8D2BF', 94], ['#8A7F6A', 94], ['#1B1A18', 94], ['#5F5A52', 94], ['#D8D2BF', 65], ['#D8D2BF', 100]] as const) {
      await page.evaluate(([theme, uiPanelOpacity]) => window.gwApplyFixtureAppearance?.({ uiStyle: 'custom', uiPanelOpacity, uiCustomTheme: theme }), [customModern(border), opacity] as const);
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.uiMaterial)).toBe('modern');
      await expectRowPainted(page, panel, rows.first(), rows.first().locator('.hub-title'), border);
      await expect(search).toBeInViewport();
      await expect(page.locator('.hub-footer')).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath('custom-modern-hub.png') });
  });

  test('Trade and the Build Library window render their lists', async ({ page }, info) => {
    await page.goto('/?hub');
    await expect(page.getByRole('combobox', { name: 'Search people, places, builds' })).toBeFocused();
    await page.evaluate(theme => window.gwApplyFixtureAppearance?.({ uiStyle: 'custom', uiPanelOpacity: 94, uiCustomTheme: theme }), customModern('#D8D2BF'));
    await page.keyboard.press('Meta+k');
    const trade = page.getByRole('dialog', { name: 'Trade Chat' });
    const offer = trade.locator('.trade-row').first();
    await expect(offer).toBeVisible();
    await expectRowPainted(page, trade, offer, offer.locator('.character-cell bdi'), '#D8D2BF');
    await page.screenshot({ path: info.outputPath('custom-modern-trade.png') });
    await page.getByRole('button', { name: 'Close Trade Chat', exact: true }).click();

    await page.getByRole('button', { name: 'Open Hub', exact: true }).click();
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await search.fill('build Word of Healing'); await search.press('Enter');
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByRole('button', { name: 'Open in Build Library', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Build Library' });
    const build = library.locator('.library-row').first();
    await expect(build).toBeVisible();
    await expectRowPainted(page, library, build, build.locator('.row-title'), '#D8D2BF');
    await page.screenshot({ path: info.outputPath('custom-modern-build-library.png') });
  });

  test('choosing the saved theme in Hub Settings keeps the page and focus', async ({ page }, info) => {
    await page.goto('/?hub');
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await expect(search).toBeFocused();
    await page.evaluate(theme => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: { uiStyle: 'guild-wars', uiCustomTheme: theme } })), customModern('#D8D2BF'));
    await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94 }));
    await search.fill('settings'); await search.press('Enter');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    const style = page.getByLabel('Panel style', { exact: true });
    // A macOS select opens its native menu on ↓, so choose the option directly;
    // the saved change re-renders the page and must hand focus back to it.
    await style.focus(); await style.selectOption('custom');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.uiMaterial)).toBe('modern');
    await expect(style).toHaveValue('custom');
    await expect(style).toBeFocused();
    const row = page.locator('.hub-setting-row').filter({ has: style });
    await expectRowPainted(page, page.locator('.hub-panel'), row, row.locator('strong'), '#D8D2BF');
    await page.screenshot({ path: info.outputPath('custom-modern-settings.png') });
    await style.selectOption('guild-wars');
    await expect(page.locator('#hub > .hub-panel > .ui-frame-artwork')).toBeVisible();
    await expect(style).toBeFocused();
  });
});
