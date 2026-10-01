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
      const search = page.locator('.hub-search input');
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
  const search = page.locator('.hub-search input');
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
  const search = page.locator('.hub-search input');
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

test('Modern hover stays clearly weaker than the selection it is not', async ({ page }, info) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'obsidian', uiPanelOpacity: 100 }));
  const rows = page.locator('#hub .hub-row');
  // The pointer rests on row 2 while the keyboard selects row 1: row 2 shows hover, not selection.
  const resting = (await rows.nth(2).boundingBox())!;
  await page.mouse.move(resting.x + resting.width * 0.7, resting.y + resting.height / 2, { steps: 4 });
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'false');
  const png = PNG.sync.read(await page.screenshot());
  const sample = async (index: number) => {
    const box = (await rows.nth(index).boundingBox())!;
    const offset = (Math.round(box.y + 4) * png.width + Math.round(box.x + box.width * 0.7)) * 4;
    return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
  };
  const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, channel) => value - b[channel]!));
  const [selected, hover, plain] = [await sample(1), await sample(2), await sample(3)];
  await page.screenshot({ path: info.outputPath('modern-hover-vs-selection.png') });
  // Hover is a faint lift; the selection stands at least 1.5 times further from it than hover from a plain row.
  expect(distance(selected, hover)).toBeGreaterThan(1.5 * distance(hover, plain));
});


const CHECKERBOARD = 'body { background: repeating-conic-gradient(#fff 0% 25%, #ddd 0% 50%) 0 / 32px 32px !important; } .hub-fixture-controls { visibility:hidden; }';
const NIGHT = 'body { background: #000 !important; } .hub-fixture-controls { visibility:hidden; }';
const luminance = (rgb: readonly number[]) => {
  const linear = rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
  return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
};

/** Composed contrast of visible text: the ink comes from the computed colour,
 * the background from a screenshot with every glyph and shadow hidden, so the
 * game backdrop, panel material, art strip, hover and selection fills count. */
async function textContrast(page: Page, selectors: Record<string, string>) {
  const labels = await page.evaluate(selectors => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const srgb = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
    return Object.entries(selectors).flatMap(([role, selector]) => {
      if (role === 'placeholder') {
        const input = document.querySelector<HTMLInputElement>('#hub .hub-search input')!;
        const box = input.getBoundingClientRect();
        return input.value ? [] : [{ role, text: input.placeholder, color: srgb(getComputedStyle(input, '::placeholder').color), box: { x: box.x, y: box.y, width: 160, height: box.height } }];
      }
      return [...document.querySelectorAll<HTMLElement>(selector.split(',').map(part => `#hub ${part.trim()}`).join(','))].flatMap(element => {
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
    // The 5th percentile ignores a stray antialiased edge of a neighbour.
    ratios.sort((a, b) => a - b);
    return { role: label.role, text: label.text, ratio: ratios[Math.floor(ratios.length * .05)] ?? 0 };
  });
}

const TEXT_ROLES = {
  title: '.hub-title', detail: '.hub-row > .hub-detail', group: '.hub-group', count: '.hub-count', keycap: '.hub-row-type .ui-kbd', legend: '.hub-legend > *',
  name: '.hub-name', caption: '.hub-caption', context: '.hub-context', crumb: '.hub-crumb', separator: '.hub-breadcrumbs > span[aria-hidden]',
  summary: '.hub-summary-label', scope: '.hub-scope:not([hidden])', placeholder: '', setting: '.hub-setting-row strong, .hub-setting-row small, .hub-settings h2',
};
const BLUE_ACCENT = { material: 'classic', window: '#0B0B0B', titlebar: '#292927', surface: '#202225', recessed: '#080807', selected: '#1B3554', accent: '#4A6FA5', text: '#F1EBDD', mutedText: '#B7B09F', border: '#D8D2BF', windowGradient: true } as const;
// Modern gold headings (HUB-249) and the Classic head (HUB-106) are the known worst cases.
for (const [name, appearance, scene] of [
  ['Modern 65% over snow', { uiStyle: 'obsidian', uiPanelOpacity: 65 }, CHECKERBOARD],
  ['Classic 94% over snow', { uiStyle: 'guild-wars', uiPanelOpacity: 94 }, CHECKERBOARD],
  ['Classic 65% over snow', { uiStyle: 'guild-wars', uiPanelOpacity: 65 }, CHECKERBOARD],
  ['a blue custom accent at 94% over night', { uiStyle: 'custom', uiPanelOpacity: 94, uiCustomTheme: BLUE_ACCENT }, NIGHT],
] as const) {
  test(`every Hub text role reads at 4.5:1 in ${name}`, async ({ page }) => {
    const media = await page.context().newCDPSession(page);
    await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?hub');
    await page.addStyleTag({ content: scene });
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await expect(search).toBeFocused();
    await page.evaluate(value => window.gwApplyFixtureAppearance?.(value), appearance);
    const measured = await textContrast(page, TEXT_ROLES);
    await search.fill('build a');
    await expect(page.locator('.hub-scope')).toBeVisible();
    measured.push(...await textContrast(page, TEXT_ROLES));
    await search.fill('build monk'); await search.press('ArrowRight');
    await expect(page.locator('.hub-summary-label')).toBeVisible();
    measured.push(...await textContrast(page, TEXT_ROLES));
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await search.fill('settings'); await search.press('Enter');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.locator('.hub-crumb').first()).toBeVisible();
    measured.push(...await textContrast(page, TEXT_ROLES));
    for (const role of Object.keys(TEXT_ROLES)) expect(measured.some(label => label.role === role), `${role} was measured`).toBe(true);
    for (const label of measured) expect(label.ratio, `${label.role} “${label.text}”`).toBeGreaterThanOrEqual(4.5);
    // A crumb is a button; it keeps the head's text shadow like the caption beside it.
    const shadows = await page.locator('.hub-heading').evaluate(head => [head.querySelector('.hub-crumb'), head.querySelector('.hub-caption')].map(element => getComputedStyle(element!).textShadow));
    expect(shadows[0]).toBe(shadows[1]);
  });
}

test('Reduce Transparency makes the Hub opaque without hiding the game or re-inking its text', async ({ page }) => {
  const media = await page.context().newCDPSession(page);
  const reduce = (value: 'reduce' | 'no-preference') => media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value }] });
  await reduce('no-preference');
  await page.goto('/?hub');
  await page.addStyleTag({ content: CHECKERBOARD });
  await expect(page.getByRole('combobox', { name: 'Search people, places, builds' })).toBeFocused();
  const look = async () => {
    const png = PNG.sync.read(await page.screenshot());
    const outside = [...png.data.subarray((20 * png.width + 20) * 4, (20 * png.width + 20) * 4 + 3)];
    return { outside, ...await page.evaluate(() => {
      const hub = document.querySelector('#hub')!;
      return {
        backdrop: getComputedStyle(hub, '::backdrop').backgroundColor,
        inks: ['.hub-row > .hub-detail', '.hub-row-type .ui-kbd', '.hub-group'].map(selector => getComputedStyle(hub.querySelector(selector)!).color),
        placeholder: getComputedStyle(hub.querySelector('.hub-search input')!, '::placeholder').color,
      };
    }) };
  };
  for (const uiStyle of ['guild-wars', 'obsidian'] as const) {
    await page.evaluate(value => window.gwApplyFixtureAppearance?.({ uiStyle: value, uiPanelOpacity: 100 }), uiStyle);
    const opaque = await look();
    await page.evaluate(value => window.gwApplyFixtureAppearance?.({ uiStyle: value, uiPanelOpacity: 65 }), uiStyle);
    const translucent = await look();
    await reduce('reduce');
    await expect.poll(() => page.locator('.hub-panel').evaluate(element => getComputedStyle(element, '::before').backgroundColor), uiStyle).not.toMatch(/0\.65\)/);
    const reduced = await look();
    // The scrim is not a material: the game stays exactly as visible around the Hub.
    expect(reduced.backdrop, uiStyle).toBe(translucent.backdrop);
    expect(reduced.outside, uiStyle).toEqual(translucent.outside);
    // The opaque panel keeps its designed inks, as at 100 %.
    expect({ inks: reduced.inks, placeholder: reduced.placeholder }, uiStyle).toEqual({ inks: opaque.inks, placeholder: opaque.placeholder });
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-panel-opacity'))).toBe('0.65');
    await reduce('no-preference');
  }
});

const PANEL_FONTS = ['guild-wars', 'inter', 'system', 'georgia', 'avenir', 'palatino'] as const;

for (const [name, viewport, hub] of [['a narrow window', { width: 390, height: 800 }, null], ['the smallest Hub', { width: 1280, height: 800 }, { width: 340, height: 300 }]] as const) {
  test(`the footer stays one line while arrowing in ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?hub');
    const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
    await expect(search).toBeFocused();
    if (hub) await page.locator('.hub-panel').evaluate((panel, size) => { panel.style.width = `${size.width}px`; panel.style.height = `${size.height}px`; }, hub);
    const primary = page.locator('.hub-primary');
    for (const uiFont of PANEL_FONTS) {
      await page.evaluate(value => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94, uiFont: value }), uiFont);
      await search.fill(''); await search.fill('k');
      const heights = new Set<number>();
      for (let step = 0; step < 6; step += 1) {
        heights.add(await page.locator('.hub-footer').evaluate(element => Math.round(element.getBoundingClientRect().height)));
        await search.press('ArrowDown');
      }
      expect([...heights], uiFont).toHaveLength(1);
      expect([...heights][0], `${uiFont} footer`).toBeLessThanOrEqual(52);
      // The full label stays the primary's name even where it ends in an ellipsis.
      expect(await primary.getAttribute('title')).toBe(await primary.locator('.hub-primary-label').textContent());
    }
  });
}

test('every Settings section fits one line in all six panel fonts', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(nav).toBeVisible();
  for (const uiFont of PANEL_FONTS) {
    await page.evaluate(value => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94, uiFont: value }), uiFont);
    const heights = await nav.getByRole('button').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().height)));
    expect(new Set(heights).size, `${uiFont}: ${heights.join(', ')}`).toBe(1);
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
    await search.fill('build Word of Healing');
    await page.keyboard.press('Meta+j');
    await page.getByRole('menuitem', { name: 'Open in Build Library', exact: true }).click();
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
