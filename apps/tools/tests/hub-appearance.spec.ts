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


test('a live appearance change keeps query, caret, selection, list scroll and focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await expect(search).toBeFocused();
  await search.fill('k');
  for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowDown');
  // From here on nothing may move focus, reach <body> or paint a second selection.
  await page.evaluate(() => {
    const trace = { body: false, focusMoves: 0, doubleSelection: false };
    Object.assign(window, { appearanceTrace: trace });
    document.addEventListener('focusin', () => { trace.focusMoves += 1; }, true);
    const sample = () => {
      if (document.activeElement === document.body) trace.body = true;
      if (document.querySelectorAll('#hub .hub-row[aria-selected=true]').length > 1) trace.doubleSelection = true;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const task = () => page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#hub .hub-search input')!;
    const list = document.querySelector('#hub .hub-results')!;
    return {
      state: { query: input.value, caret: [input.selectionStart, input.selectionEnd], selected: document.querySelector('#hub .hub-row[aria-selected=true]')?.getAttribute('data-id'), active: input.getAttribute('aria-activedescendant'), focus: document.activeElement?.id || document.activeElement?.className },
      scrollTop: list.scrollTop, scrollMax: list.scrollHeight - list.clientHeight,
    };
  });
  const scrollTo = (top: number) => page.locator('#hub .hub-results').evaluate((list, top) => { list.scrollTop = top; return list.scrollTop; }, top);
  // Mid-list, every change keeps the exact scroll offset: rows have fixed
  // heights and the list opts out of the browser's baseline-driven anchoring.
  expect(await scrollTo(15)).toBe(15);
  const kept = await task();
  for (const appearance of [{ uiStyle: 'obsidian' }, { uiStyle: 'obsidian', uiFont: 'inter' }, { uiStyle: 'obsidian', uiFont: 'inter', uiPanelOpacity: 65 }]) {
    await page.evaluate(appearance => window.gwApplyFixtureAppearance?.({ uiPanelOpacity: 100, ...appearance }), appearance);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const now = await task();
    expect(now.state, JSON.stringify(appearance)).toEqual(kept.state);
    expect(now.scrollTop, JSON.stringify(appearance)).toBe(kept.scrollTop);
  }
  // At the very bottom a taller list viewport can only clamp to its new end.
  await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94 }));
  const bottom = await scrollTo(10_000);
  await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'obsidian', uiPanelOpacity: 94 }));
  const clamped = await task();
  expect(clamped.scrollTop).toBe(Math.min(bottom, clamped.scrollMax));
  expect(clamped.state).toEqual(kept.state);
  expect(await page.evaluate(() => (window as unknown as { appearanceTrace: object }).appearanceTrace)).toEqual({ body: false, focusMoves: 0, doubleSelection: false });
  await page.keyboard.type('a');
  await expect(search).toHaveValue('ka');
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

const relativeLuminance = (rgb: readonly number[]) => {
  const linear = rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
  return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
};
const ratio = (a: readonly number[], b: readonly number[]) => {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light! + .05) / (dark! + .05);
};

for (const uiStyle of ['guild-wars', 'obsidian'] as const) {
  test(`at 65% over a bright scene the Hub keeps title, detail, gold and placeholder distinct in ${uiStyle}`, async ({ page }, info) => {
    const media = await page.context().newCDPSession(page);
    await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?hub');
    const scene = await page.addStyleTag({ content: CHECKERBOARD });
    await expect(page.getByRole('combobox', { name: 'Search people, places, builds' })).toBeFocused();
    await page.evaluate(appearance => window.gwApplyFixtureAppearance?.(appearance), { uiStyle, uiPanelOpacity: 65 });
    const inks = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const srgb = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
      const color = (selector: string, pseudo?: string) => srgb(getComputedStyle(document.querySelector(`#hub ${selector}`)!, pseudo).color);
      return {
        title: color('.hub-row:not([aria-selected=true]) .hub-title'), detail: color('.hub-row:not([aria-selected=true]) > .hub-detail'),
        keycap: color('.hub-row:not([aria-selected=true]) .ui-kbd'), group: color('.hub-group'), count: color('.hub-count'),
        typed: color('.hub-search input'), placeholder: color('.hub-search input', '::placeholder'),
      };
    });
    expect(ratio(inks.title, inks.detail), 'title over detail').toBeGreaterThanOrEqual(1.5);
    expect(ratio(inks.title, inks.keycap), 'title over keycap').toBeGreaterThanOrEqual(1.5);
    expect(ratio(inks.title, inks.count), 'title over count').toBeGreaterThanOrEqual(1.5);
    expect(ratio(inks.typed, inks.placeholder), 'typed text over placeholder').toBeGreaterThanOrEqual(1.5);
    // Group headings stay gold: a warm hue, not a near-white tone.
    expect(inks.group[0]! - inks.group[2]!, `group ${inks.group.join(',')}`).toBeGreaterThanOrEqual(60);
    await page.screenshot({ path: info.outputPath(`${uiStyle}-65-hierarchy.png`) });
    // The cap holds back only highlights: over a dark scene the panel composes
    // exactly as it would without it, and the game around the Hub is untouched.
    const group = (await page.locator('.hub-group').first().boundingBox())!;
    const pixel = async () => [...PNG.sync.read(await page.screenshot({ clip: { x: Math.round(group.x + group.width - 24), y: Math.round(group.y + group.height / 2), width: 1, height: 1 } })).data.subarray(0, 3)];
    const withoutCap = async () => {
      await page.evaluate(() => document.documentElement.style.setProperty('--ui-hub-backdrop', 'none'));
      const value = await pixel();
      await page.evaluate(() => document.documentElement.style.setProperty('--ui-hub-backdrop', 'url("#ui-hub-scene-cap")'));
      return value;
    };
    const brightUncapped = await withoutCap();
    expect(relativeLuminance(await pixel())).toBeLessThan(relativeLuminance(brightUncapped));
    await scene.evaluate(element => { element.textContent = 'body { background: #202020 !important; } .hub-fixture-controls { visibility:hidden; }'; });
    expect(await pixel()).toEqual(await withoutCap());
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

test('at a larger text size the minimum Hub footer gives up the count before the named primary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?hub');
  await page.locator('.hub-panel').evaluate(panel => Object.assign(panel.style, { transform: 'none', left: '100px', top: '100px', width: '340px', height: '380px' }));
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  for (const hubTextSize of [100, 150, 200]) {
    await page.evaluate(hubTextSize => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94, hubTextSize }), hubTextSize);
    for (const query of ['kam', 'k', 'settings']) {
      await search.fill(query);
      const heights = new Set<number>();
      for (let step = 0; step < 4; step += 1) {
        const footer = await page.evaluate(() => {
          const label = document.querySelector<HTMLElement>('#hub .hub-primary-label')!;
          const style = getComputedStyle(label);
          const context = document.createElement('canvas').getContext('2d')!; context.font = style.font;
          return {
            height: Math.round(document.querySelector('#hub .hub-footer')!.getBoundingClientRect().height),
            text: label.textContent, title: label.title, visible: label.clientWidth, truncated: label.scrollWidth > label.clientWidth + 1,
            verb: context.measureText(label.textContent!.split(' ')[0]!).width, em: parseFloat(style.fontSize),
            count: document.querySelector('#hub .hub-count')!.getBoundingClientRect().width,
          };
        });
        const label = `${hubTextSize}% ${query} “${footer.text}”`;
        heights.add(footer.height);
        expect(footer.title, label).toBe(footer.text);
        // The count gives way before a single pixel of the primary does.
        if (footer.truncated) expect(footer.count, label).toBeLessThanOrEqual(1);
        // Up to 150 % the whole verb stays; at 200 % the label still shows its start.
        if (hubTextSize <= 150) expect(footer.visible, label).toBeGreaterThanOrEqual(footer.verb);
        else expect(footer.visible, label).toBeGreaterThanOrEqual(2.5 * footer.em);
        await page.keyboard.press('ArrowDown');
      }
      expect([...heights], `${hubTextSize}% ${query} footer height`).toHaveLength(1);
    }
  }
});

test('result rows stay 40 px with centred keycaps and whole titles in every panel font', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  for (const uiStyle of ['guild-wars', 'obsidian'] as const) {
    for (const uiPanelOpacity of [94, 65]) {
      for (const uiFont of ['guild-wars', 'inter', 'system', 'georgia', 'avenir', 'palatino']) {
        await page.evaluate(appearance => window.gwApplyFixtureAppearance?.(appearance), { uiStyle, uiPanelOpacity, uiFont });
        for (const query of ['kam', 'k']) {
          await search.fill(query);
          const rows = await page.locator('.hub-row:not(.hub-build-row)').evaluateAll(rows => rows.map(row => {
            const title = row.querySelector('.hub-title')!;
            const centre = (element: Element) => { const box = element.getBoundingClientRect(); return box.top + box.height / 2; };
            const keycap = row.querySelector('.hub-row-type .ui-kbd');
            return { height: row.getBoundingClientRect().height, offset: keycap ? Math.abs(centre(keycap) - centre(title)) : 0, clipped: title.scrollWidth - title.clientWidth };
          }));
          const label = `${uiStyle} ${uiPanelOpacity}% ${uiFont} ${query}`;
          expect(rows.length, label).toBeGreaterThan(0);
          expect(new Set(rows.map(row => Math.round(row.height))), label).toEqual(new Set([40]));
          for (const row of rows) {
            expect(row.offset, label).toBeLessThanOrEqual(1);
            expect(row.clipped, label).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  }
});

test('Hub text size scales every type role inside the fixed frame, keeps the task and never zooms the game', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  const game = () => page.evaluate(() => ({ canvas: JSON.stringify(document.getElementById('canvas')!.getBoundingClientRect()), ratio: devicePixelRatio, root: getComputedStyle(document.documentElement).fontSize, outside: getComputedStyle(document.querySelector('.hub-fixture-controls button')!).fontSize }));
  await expect(search).toBeFocused();
  const before = await game();
  const box = await page.locator('.hub-panel').boundingBox();
  await search.fill('kam');
  await page.keyboard.press('ArrowDown');
  const task = () => page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#hub .hub-search input')!;
    const focused = document.activeElement;
    return { query: input.value, caret: [input.selectionStart, input.selectionEnd], selected: document.querySelector('#hub .hub-row[aria-selected=true]')?.getAttribute('data-id'), active: input.getAttribute('aria-activedescendant'), focus: focused?.id || focused?.className };
  });
  const kept = await task();
  // A live size change is presentation only: the task and focus stay put.
  await page.evaluate(() => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94, hubTextSize: 150 }));
  await expect.poll(() => page.locator('.hub-title').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('21px');
  expect(await task()).toEqual(kept);
  expect(kept.focus).not.toBe('');
  expect(await game()).toEqual(before);

  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const size = page.getByLabel('Text size', { exact: true });
  await expect(size).toHaveAttribute('min', '100');
  await expect(size).toHaveAttribute('max', '200');
  await size.fill('200');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-hub-text-scale'))).toBe('2');
  expect(await page.locator('.hub-settings nav').getByRole('button').evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth + 1))).toBe(true);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  for (const reload of [false, true]) {
    if (reload) { await page.reload(); await expect(search).toBeFocused(); }
    await search.fill('kam');
    const type = await page.evaluate(() => {
      const size = (selector: string) => getComputedStyle(document.querySelector(`#hub ${selector}`)!).fontSize;
      return { title: size('.hub-title'), detail: size('.hub-row:not([aria-selected=true]) > .hub-detail'), group: size('.hub-group'), search: size('.hub-search input'), count: size('.hub-count') };
    });
    expect(type, reload ? 'after reload' : 'live').toEqual({ title: '28px', detail: '24px', group: '28px', search: '36px', count: '24px' });
    expect(await page.locator('.hub-panel').boundingBox()).toEqual(box);
    expect(await game()).toEqual(before);
    for (const query of ['kam', 'k', 'team', '10 ecto in p']) {
      await search.fill(query);
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('#hub .hub-panel')!; const list = document.querySelector('#hub .hub-results')!;
        const label = document.querySelector('#hub .hub-primary-label')!;
        return {
          overflow: Math.max(panel.scrollWidth - panel.clientWidth, list.scrollWidth - list.clientWidth, ...[...document.querySelectorAll('#hub .hub-row')].map(row => row.scrollWidth - row.clientWidth)),
          rows: [...document.querySelectorAll('#hub .hub-row:not(.hub-build-row, .hub-conversion)')].map(row => row.getBoundingClientRect().height),
          scrolls: list.scrollHeight > list.clientHeight,
          primaryLines: label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight || '0'),
        };
      });
      expect(layout.overflow, query).toBeLessThanOrEqual(1);
      for (const height of layout.rows) expect(height, `${query} rows grow`).toBeGreaterThan(40);
      if (query === 'k') expect(layout.scrolls, 'the list scrolls').toBe(true);
      expect(layout.primaryLines, `${query} footer primary`).toBeLessThan(1.5);
      await expect(page.locator('.hub-primary')).toHaveAccessibleName(/^(Travel to|Open|Copy|Search|Show|Whisper).+/u);
    }
  }
  await search.fill('travel'); await search.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Destination, phrase, or friend' })).toBeVisible();
  expect(await page.locator('.hub-panel').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  // Character cards grow with the text size: name, Current marker and meta stay inside every card.
  await page.keyboard.press('Meta+E');
  const cards = page.locator('#hub .character-switch-row');
  await expect(cards.first()).toBeVisible();
  for (const hubTextSize of [100, 150, 200]) {
    await page.evaluate(hubTextSize => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94, hubTextSize }), hubTextSize);
    const spills = await cards.evaluateAll(cards => cards.flatMap(card => {
      const frame = card.getBoundingClientRect();
      return [...card.querySelectorAll<HTMLElement>('.character-switch-name, .character-switch-current, .character-switch-meta')].flatMap(text => {
        const range = document.createRange(); range.selectNodeContents(text);
        const ink = range.getBoundingClientRect();
        const outside = Math.max(frame.left - ink.left, ink.right - frame.right, frame.top - ink.top, ink.bottom - frame.bottom, text.scrollWidth - text.clientWidth);
        return outside > 1 ? [`${text.className} “${text.textContent}” by ${outside.toFixed(1)} px`] : [];
      });
    }));
    expect(spills, `${hubTextSize}%`).toEqual([]);
    const heights = new Set(await cards.evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().height))));
    expect([...heights], `${hubTextSize}% one card height`).toHaveLength(1);
    if (hubTextSize === 100) expect([...heights], 'the ramp size keeps 154 px cards').toEqual([154]);
  }
});

test('Settings navigation keeps every section on one line in every panel font', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.getByRole('combobox', { name: 'Search people, places, builds' });
  await search.fill('settings'); await search.press('Enter');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(nav.getByRole('button')).toHaveText(['Tools', 'Appearance', 'Shortcuts', 'Maps', 'Characters', 'Chat']);
  for (const uiFont of ['guild-wars', 'inter', 'system', 'georgia', 'avenir', 'palatino']) {
    await page.evaluate(uiFont => window.gwApplyFixtureAppearance?.({ uiStyle: 'guild-wars', uiPanelOpacity: 94, uiFont }), uiFont);
    const heights = await nav.getByRole('button').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().height)));
    expect(new Set(heights).size, `${uiFont} ${heights.join(',')}`).toBe(1);
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
