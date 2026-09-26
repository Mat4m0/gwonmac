import { test, expect, type Page } from '@playwright/test';
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


const CHECKERBOARD = 'body { background: repeating-conic-gradient(#fff 0% 25%, #ddd 0% 50%) 0 / 32px 32px !important; } .hub-fixture-controls { visibility:hidden; }';

/** Composed contrast of visible text: the ink comes from the computed colour,
 * the background from a screenshot with every glyph and shadow hidden, so the
 * game backdrop, panel material, hover and selection fills are all included. */
async function textContrast(page: Page, selectors: Record<string, string>) {
  const labels = await page.evaluate(selectors => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const srgb = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
    return Object.entries(selectors).flatMap(([role, selector]) => {
      if (role === 'placeholder') {
        const input = document.querySelector<HTMLInputElement>('#hub .hub-search input')!;
        const box = input.getBoundingClientRect();
        return input.value ? [] : [{ role, text: input.placeholder, color: srgb(getComputedStyle(input, '::placeholder').color), box: { x: box.x, y: box.y, width: 160, height: box.height } }];
      }
      return [...document.querySelectorAll<HTMLElement>(`#hub ${selector}`)].flatMap(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        const box = [...range.getClientRects()].find(rect => rect.width > 2);
        if (!box) return [];
        const hit = document.elementFromPoint(box.x + Math.min(6, box.width / 2), box.y + box.height / 2);
        const scroller = element.closest('.hub-results, .hub-view')?.getBoundingClientRect();
        if (!hit || !element.contains(hit) || (scroller && (box.top < scroller.top || box.bottom > scroller.bottom))) return [];
        return [{ role, text: element.textContent?.trim() ?? '', color: srgb(getComputedStyle(element).color), box: { x: box.x, y: box.y, width: box.width, height: box.height } }];
      });
    });
  }, selectors);
  const hidden = await page.addStyleTag({ content: '#hub, #hub *, #hub input::placeholder { color:transparent !important; -webkit-text-fill-color:transparent !important; text-shadow:none !important; caret-color:transparent !important; } #hub svg, #hub img { visibility:hidden !important; }' });
  const composed = PNG.sync.read(await page.screenshot());
  await hidden.evaluate(element => element.remove());
  const luminance = (rgb: readonly number[]) => {
    const linear = rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
    return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
  };
  return labels.map(label => {
    const ink = luminance(label.color);
    const ratios: number[] = [];
    for (let y = Math.ceil(label.box.y + 1); y < label.box.y + label.box.height - 1; y += 2) {
      for (let x = Math.ceil(label.box.x + 1); x < label.box.x + label.box.width - 1; x += 2) {
        const offset = (y * composed.width + x) * 4;
        const background = luminance([...composed.data.subarray(offset, offset + 3)]);
        ratios.push((Math.max(background, ink) + .05) / (Math.min(background, ink) + .05));
      }
    }
    // The 5th percentile ignores a stray antialiased edge pixel of a neighbour.
    ratios.sort((a, b) => a - b);
    return { role: label.role, text: label.text, ratio: ratios[Math.floor(ratios.length * .05)] ?? 0 };
  });
}

const TEXT_ROLES = {
  title: '.hub-title', detail: '.hub-row > .hub-detail', group: '.hub-group', count: '.hub-count', keycap: '.hub-row-type .ui-kbd',
  name: '.hub-name', caption: '.hub-caption', context: '.hub-context', crumb: '.hub-crumb', separator: '.hub-breadcrumbs > span[aria-hidden]',
  summary: '.hub-summary-label', scope: '.hub-scope:not([hidden])', primary: '.hub-primary', actions: '.hub-actions', placeholder: '',
};

for (const [uiStyle, uiPanelOpacity] of [['obsidian', 65], ['guild-wars', 94], ['guild-wars', 65]] as const) {
  test(`every Hub text role reads at 4.5:1 over a bright scene in ${uiStyle} at ${uiPanelOpacity}%`, async ({ page }) => {
    const media = await page.context().newCDPSession(page);
    await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?hub');
    await page.addStyleTag({ content: CHECKERBOARD });
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await expect(search).toBeFocused();
    await page.evaluate(appearance => window.gwApplyFixtureAppearance?.(appearance), { uiStyle, uiPanelOpacity });
    const measured: Awaited<ReturnType<typeof textContrast>> = [];
    measured.push(...await textContrast(page, TEXT_ROLES));
    await search.fill('kam'); measured.push(...await textContrast(page, TEXT_ROLES));
    await search.fill('build a'); measured.push(...await textContrast(page, TEXT_ROLES));
    await search.fill('build monk'); await search.press('ArrowDown'); await page.keyboard.press('ArrowRight');
    await expect(page.locator('.hub-summary-label')).toBeVisible();
    measured.push(...await textContrast(page, TEXT_ROLES));
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await search.fill('settings'); await search.press('Enter');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.locator('.hub-crumb')).toBeVisible();
    measured.push(...await textContrast(page, { ...TEXT_ROLES, setting: '.hub-setting-row strong, .hub-setting-row small, .hub-settings h2' }));
    for (const role of ['title', 'detail', 'group', 'count', 'keycap', 'name', 'caption', 'context', 'crumb', 'separator', 'summary', 'scope', 'primary', 'placeholder', 'setting']) {
      expect(measured.some(label => label.role === role), `${role} was measured`).toBe(true);
    }
    for (const label of measured) expect(label.ratio, `${label.role} “${label.text}”`).toBeGreaterThanOrEqual(4.5);
  });
}

test('one scrim policy: the game around the Hub is never dimmed, even with Reduce Transparency', async ({ page }) => {
  const media = await page.context().newCDPSession(page);
  const reduce = (value: 'reduce' | 'no-preference') => media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value }] });
  await reduce('no-preference');
  await page.goto('/?hub');
  await page.addStyleTag({ content: CHECKERBOARD });
  await expect(page.getByRole('combobox', { name: 'Search people, places, builds' })).toBeFocused();
  const hub = page.locator('#hub');
  const outside = async () => [...(PNG.sync.read(await page.screenshot({ clip: { x: 100, y: 400, width: 1, height: 1 } })).data.subarray(0, 3))];
  const scene = await page.evaluate(() => { document.getElementById('hub')!.style.visibility = 'hidden'; return true; })
    .then(outside).finally(() => page.evaluate(() => document.getElementById('hub')!.style.removeProperty('visibility')));
  const inks = () => page.evaluate(() => ({
    detail: getComputedStyle(document.querySelector('.hub-row:not([aria-selected=true]) > .hub-detail')!).color,
    keycap: getComputedStyle(document.querySelector('.hub-row:not([aria-selected=true]) .ui-kbd')!).color,
    placeholder: getComputedStyle(document.querySelector('#hub .hub-search input')!, '::placeholder').color,
  }));
  for (const uiStyle of ['guild-wars', 'obsidian'] as const) {
    await page.evaluate(uiStyle => window.gwApplyFixtureAppearance?.({ uiStyle, uiPanelOpacity: 100 }), uiStyle);
    const opaque = await inks();
    for (const uiPanelOpacity of [94, 65]) {
      await page.evaluate(appearance => window.gwApplyFixtureAppearance?.(appearance), { uiStyle, uiPanelOpacity });
      await expect.poll(() => hub.evaluate(element => getComputedStyle(element, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      expect(await outside()).toEqual(scene);
    }
    await reduce('reduce');
    await expect.poll(() => hub.evaluate(element => getComputedStyle(element, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await outside()).toEqual(scene);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-panel-opacity'))).toBe('0.65');
    await expect.poll(inks).toEqual(opaque);
    await reduce('no-preference');
    await expect.poll(inks).not.toEqual(opaque);
  }
});

test('a narrow or minimum Hub keeps one footer line while arrowing', async ({ page }) => {
  for (const size of [{ viewport: { width: 390, height: 800 } }, { viewport: { width: 1280, height: 800 }, panel: { width: 340, height: 380 } }]) {
    await page.setViewportSize(size.viewport);
    await page.goto('/?hub');
    if (size.panel) await page.locator('.hub-panel').evaluate((panel, box) => Object.assign(panel.style, { transform: 'none', left: '100px', top: '100px', width: `${box.width}px`, height: `${box.height}px` }), size.panel);
    for (const uiFont of ['guild-wars', 'georgia', 'inter']) {
      await page.evaluate(uiFont => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94, uiFont }), uiFont);
      const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
      await search.fill('k');
      const geometry = new Set<string>();
      for (let step = 0; step < 10; step += 1) {
        geometry.add(await page.evaluate(() => [document.querySelector('.hub-footer')!, document.querySelector('.hub-results')!, document.querySelector('.hub-primary')!].map(element => Math.round(element.getBoundingClientRect().height)).join('/')));
        await page.keyboard.press('ArrowDown');
      }
      expect([...geometry], `${uiFont} footer/list/primary heights`).toHaveLength(1);
      const visibleRows = await page.evaluate(() => { const list = document.querySelector('.hub-results')!.getBoundingClientRect(); return [...document.querySelectorAll('.hub-row')].filter(row => { const box = row.getBoundingClientRect(); return box.top >= list.top - 1 && box.bottom <= list.bottom + 1; }).length; });
      expect(visibleRows).toBeGreaterThanOrEqual(3);
      const primary = page.locator('.hub-primary');
      await expect(primary).toHaveAccessibleName(/^(Open|Travel|Switch|Whisper|Search|Browse|Show|Call|Invite).+/u);
    }
  }
});

test('compact Hub keeps navigation reachable with reduced motion over a bright backdrop', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?hub');
  await page.addStyleTag({ content: CHECKERBOARD });
  await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 65 }));
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('travel'); await search.press('Enter');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeInViewport();
  await expect(page.getByRole('combobox', { name: 'Destination, phrase, or friend' })).toBeInViewport();
  expect(await page.locator('.hub-panel').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('travel-bright-390-reduced-motion.png') });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('travel');
  for (const label of await textContrast(page, { title: '.hub-title', detail: '.hub-row > .hub-detail' })) {
    expect(label.ratio, label.text).toBeGreaterThanOrEqual(4.5);
  }
});
