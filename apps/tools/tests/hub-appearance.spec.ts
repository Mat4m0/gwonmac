import { test, expect } from '@playwright/test';

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
