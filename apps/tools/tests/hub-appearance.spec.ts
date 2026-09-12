import { test, expect } from '@playwright/test';
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
