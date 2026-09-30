import { expect, test } from '@playwright/test';

for (const style of ['guild-wars', 'obsidian'] as const) {
  test(`native currency input keeps text and caret boundaries in ${style}`, async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/?hub');
    const input = page.locator('.hub-search input');
    const overlay = page.locator('.hub-search-glyphs');
    for (const font of ['guild-wars', 'inter', 'system', 'avenir', 'georgia', 'palatino'] as const) {
      await page.evaluate(({ style, font }) => window.gwApplyFixtureAppearance?.({ uiStyle: style, uiFont: font, uiPanelOpacity: 100 }), { style, font });
      await page.evaluate(() => document.fonts.ready);
      await input.fill('');
      let typed = '';
      for (const character of '10 ectos in p') {
        await input.pressSequentially(character); typed += character;
        await expect(input).toHaveValue(typed);
      }
      await expect(overlay.locator('img[data-unit="ecto"]')).toHaveCount(1);
      await expect(overlay.locator('img[data-unit="platinum"]')).toHaveCount(1);
      await expect(overlay).toHaveAttribute('aria-hidden', 'true');
      await expect(input).toBeFocused();
      // Compare each native selection offset with the measuring layer's glyph boundary.
      // Canvas uses the input's font and word spacing, independently of overlay spans.
      const measurements = [];
      for (let offset = 13; offset >= 0; offset--) {
        expect(await input.evaluate(el => el.selectionStart)).toBe(offset);
        measurements.push(await input.evaluate((el, offset) => {
          const glyphs = el.parentElement!.querySelector<HTMLElement>('.hub-search-glyphs')!;
          const style = getComputedStyle(el), context = document.createElement('canvas').getContext('2d')!;
          context.font = style.font; context.wordSpacing = style.wordSpacing; context.letterSpacing = style.letterSpacing;
          const expected = el.getBoundingClientRect().left + Number.parseFloat(style.paddingLeft) - el.scrollLeft + context.measureText(el.value.slice(0, offset)).width;
          const walker = document.createTreeWalker(glyphs, NodeFilter.SHOW_TEXT);
          let remaining = offset, node = walker.nextNode();
          while (node && remaining > (node.textContent?.length ?? 0)) { remaining -= node.textContent?.length ?? 0; node = walker.nextNode(); }
          const range = document.createRange(); range.setStart(node!, remaining); range.collapse(true);
          const actual = range.getBoundingClientRect().left;
          return { offset, expected, actual, error: Math.abs(actual - expected) };
        }, offset));
        if (offset > 0) await input.press('ArrowLeft');
      }
      expect(Math.max(...measurements.map(value => value.error)), JSON.stringify({ style, font, measurements })).toBeLessThanOrEqual(1);
      for (let offset = 0; offset < 13; offset++) await input.press('ArrowRight');
      await input.press('Backspace'); await expect(input).toHaveValue('10 ectos in ');
      await expect(overlay.locator('img[data-unit="platinum"]')).toHaveCount(0);
      await input.fill('travel 10 ectos in p'); await expect(overlay).toBeHidden();
    }
  });
}

test('glyphs freeze during composition and native undo restores exact text without orphan artwork', async ({ page }) => {
  await page.goto('/?hub');
  const input=page.locator('.hub-search input'),overlay=page.locator('.hub-search-glyphs');
  await input.pressSequentially('10 ectos in p');
  await expect(overlay.locator('img')).toHaveCount(2);
  await expect(overlay).toHaveCSS('text-shadow','none');
  const before=await overlay.innerHTML();
  await input.dispatchEvent('compositionstart');await input.fill('1a in e');
  expect(await overlay.innerHTML()).toBe(before);
  await input.dispatchEvent('compositionend');await expect(overlay.locator('img[data-unit=armbrace]')).toHaveCount(1);
  await expect(input).toHaveValue('1a in e');
  const modifier=process.platform==='darwin'?'Meta':'Control';
  await input.press(`${modifier}+a`);await input.press('Backspace');await expect(input).toHaveValue('');
  await expect(overlay).toBeHidden();await expect(overlay.locator('img')).toHaveCount(0);
  await input.press(`${modifier}+z`);await expect(input).toHaveValue('1a in e');
  await expect(overlay.locator('img')).toHaveCount(2);
  await expect(overlay.locator('img').first()).toHaveCSS('transition-duration','0s');
  await input.fill(Array.from({length:10},()=> '1e').join(' + ')+' in p');
  await expect.poll(()=>input.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(()=>input.evaluate(el=>el.scrollLeft-el.parentElement!.querySelector('.hub-search-glyphs')!.scrollLeft)).toBe(0);
  await input.press('ArrowLeft');
  await expect.poll(()=>input.evaluate(el=>el.scrollLeft-el.parentElement!.querySelector('.hub-search-glyphs')!.scrollLeft)).toBe(0);
  await page.setViewportSize({width:500,height:650});
  await expect.poll(()=>input.evaluate(el=>el.scrollLeft-el.parentElement!.querySelector('.hub-search-glyphs')!.scrollLeft)).toBe(0);
  await input.fill('char 1a in e');await expect(overlay).toBeHidden();
});
