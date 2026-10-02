import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { timeBudget } from './performance-budget.js';
import type { HubSource } from '../../../src/shared/hub.js';

test('root caps matching builds and carries the complete query to Build Library (HUB-110)', async ({ page }) => {
  await page.goto('/?hub&library=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  await search.fill('m');
  const builds = page.locator('.hub-row[data-id^="build:"]');
  expect(await builds.count()).toBeLessThanOrEqual(8);
  const more = page.getByRole('option', { name: /^\d+ more — open in Build Library/ });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('.hub-caption')).toHaveText('Build Library');
  await expect(search).toHaveValue('m');
  expect(await builds.count()).toBeGreaterThan(8);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('build m');
  expect(await builds.count()).toBeGreaterThan(8);
});

test('arrow selection mutates only the old and new rows (HUB-112)', async ({ page }) => {
  await page.goto('/?hub&library=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  await search.fill('build m');
  // Rows past the first chunks paint in later frames (HUB-112).
  await expect.poll(() => page.locator('.hub-row[data-id^="build:"]').count()).toBeGreaterThan(100);
  const mutations = await search.evaluate(input => {
    const list = document.getElementById('hub-results')!;
    const observer = new MutationObserver(() => {});
    observer.observe(list, { subtree: true, attributes: true });
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const records = observer.takeRecords().length;
    observer.disconnect();
    return records;
  });
  expect(mutations).toBeLessThanOrEqual(4);
  await expect(search).toBeFocused();
  await expect(page.locator('#hub [aria-selected="true"]')).toHaveCount(1);
  const footerMutations = await page.locator('#hub [aria-selected="true"]').evaluate(row => {
    const observer = new MutationObserver(() => {});
    observer.observe(document.querySelector('.hub-footer')!, { childList: true, subtree: true });
    row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, movementX: 1 }));
    const count = observer.takeRecords().length; observer.disconnect(); return count;
  });
  expect(footerMutations).toBe(0);
});

test('explicit close clears result DOM while suspension retains its selection (HUB-171)', async ({ page }) => {
  await page.goto('/?hub&library=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  await search.fill('build m');
  await search.press('ArrowDown');
  const selected = await page.locator('#hub [aria-selected="true"]').getAttribute('data-id');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#hub')).toBeHidden();
  await expect.poll(() => page.locator('.hub-row').count()).toBeGreaterThan(100);
  await page.keyboard.press('Meta+r');
  await expect(page.locator('#hub [aria-selected="true"]')).toHaveAttribute('data-id', selected!);
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#hub-results')).toBeEmpty();
});

test('source bursts coalesce while typing stays synchronous and opening searches once (HUB-111)', async ({ page }) => {
  await page.goto('/?hub&library=1000&templates-ms=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const hub = window.gwHub!;
    let calls = 0;
    let notify = () => {};
    const detach = hub.attach({
      search() { calls++; return []; },
      subscribe(listener) { notify = listener; return () => {}; },
      setVisible(visible) { if (visible) { notify(); notify(); } },
    });
    await new Promise(requestAnimationFrame);
    calls = 0;
    for (let index = 0; index < 20; index++) notify();
    const beforeFrame = calls;
    await new Promise(requestAnimationFrame);
    const afterFrame = calls;
    calls = 0;
    const input = document.querySelector<HTMLInputElement>('.hub-search input')!;
    input.value = 'mo'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const typing = calls;
    hub.close(); calls = 0; hub.show();
    const opening = calls;
    await new Promise(requestAnimationFrame);
    const afterOpeningFrame = calls;
    detach();
    return { beforeFrame, afterFrame, typing, opening, afterOpeningFrame };
  });
  expect(result).toEqual({ beforeFrame: 0, afterFrame: 1, typing: 1, opening: 1, afterOpeningFrame: 1 });
});

test('an owned list ignores unrelated observations and still follows its own source (HUB-111)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const measure = await page.evaluateHandle(() => {
    const hub = window.gwHub!;
    let notifyOwner = () => {}, notifyOther = () => {};
    let title = 'Original', reads = 0, lifecycle = '';
    const owner: HubSource = { search: () => [], setVisible() {}, subscribe(listener) { notifyOwner = listener; return () => {}; } };
    const detachOwner = hub.attach(owner);
    const detachOther = hub.attach({ search: () => [], lifecycle: () => lifecycle, setVisible() {}, subscribe(listener) { notifyOther = listener; return () => {}; } });
    hub.showRows('Owned list', () => { reads++; return [{ id: 'owned', title, detail: '', group: 'Builds', action: 'Choose', run() {} }]; }, undefined, undefined, owner);
    return async () => {
      reads = 0;
      const changes: MutationRecord[] = [];
      const observer = new MutationObserver(records => changes.push(...records));
      observer.observe(document.querySelector('#hub')!, { subtree: true, childList: true, attributes: true });
      for (let update = 0; update < 20; update++) notifyOther();
      await new Promise(requestAnimationFrame);
      const unrelatedReads = reads;
      changes.push(...observer.takeRecords()); observer.disconnect();
      const unrelatedMutations = changes.length;
      lifecycle = 'Updating'; notifyOther();
      const updatedLifecycle = document.querySelector('.hub-lifecycle')?.textContent;
      title = 'Updated'; notifyOwner();
      await new Promise(requestAnimationFrame);
      const updated = document.querySelector('#hub .hub-title')?.textContent;
      const ownReads = reads - unrelatedReads;
      detachOther(); detachOwner();
      return { unrelatedReads, unrelatedMutations, updatedLifecycle, ownReads, updated, withdrawn: document.querySelector('.hub-caption')?.textContent };
    };
  });
  // The list's own result announcement settles before unrelated observations are measured.
  await expect(page.locator('.hub-announce')).toHaveText('1 result');
  const result = await measure.evaluate(run => run());
  await measure.dispose();
  expect(result).toEqual({ unrelatedReads: 0, unrelatedMutations: 0, updatedLifecycle: 'Updating', ownReads: 1, updated: 'Updated', withdrawn: 'Home' });
});

test('the unopened Build workspace stays small and only a focused slot loads choices (HUB-254)', async ({ page }) => {
  await page.goto('/?hub&library=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  expect(await page.locator('#toolbox-foundation *').count()).toBeLessThan(500);
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.keyboard.press('Meta+b');
  const workspace = page.locator('.tools-window');
  await expect(workspace).toBeVisible();
  const picker = workspace.locator('#team-build-0');
  await expect(picker.locator('option')).toHaveCount(2);
  await picker.focus();
  expect(await picker.locator('option').count()).toBeGreaterThan(100);
  await expect(workspace.locator('#team-build-1 option')).toHaveCount(2);
  const name = workspace.locator('#team-name');
  await name.fill('Unsaved team name');
  await workspace.getByRole('button', { name: 'Close Build Library', exact: true }).click();
  await page.keyboard.press('Meta+b');
  await expect(name).toHaveValue('Unsaved team name');
});

test('settled results announce once, and empty results do not remain expanded (HUB-113)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  const announcement = page.locator('.hub-announce');
  await expect(announcement).toHaveAttribute('role', 'status');
  await expect(announcement).not.toHaveAttribute('hidden', '');
  await search.fill('kam');
  await expect(announcement).toHaveText('2 results');
  await search.fill('zzzq');
  await expect(announcement).toHaveText('No matches');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#hub-results')).toBeEmpty();
  await expect(page.locator('#hub .hub-empty')).toBeVisible();
});


test('root results are grouped by named sections without a Home count (HUB-160)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('.hub-count')).toBeEmpty();
  await page.locator('.hub-search input').fill('k');
  const places = page.locator('#hub-results').getByRole('group', { name: 'Places', exact: true });
  await expect(places).toBeVisible();
  expect(await places.getByRole('option').count()).toBeGreaterThan(0);
  await page.keyboard.press('Meta+t');
  await expect(page.getByRole('listbox', { name: 'Travel', exact: true })).toBeVisible();
  const destinations = page.getByRole('listbox', { name: 'Travel', exact: true }).getByRole('group');
  expect(await destinations.count()).toBeGreaterThan(0);
  await expect(destinations.first()).toHaveAccessibleName(/Destinations|Recent|Available destinations/);

});

test('build option names stay concise and describe skills separately (HUB-161)', async ({ page }) => {
  await page.goto('/?hub');
  await page.locator('.hub-search input').fill('build smiter');
  const build = page.locator('.hub-row[data-id="build:hub-smiter"]');
  await expect(build).toHaveAccessibleName('Smiter');
  await expect(build).toHaveAccessibleDescription(/Word of Healing/);
});

test('child dialog naming follows its visible title (HUB-166)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await expect(page.locator('#hub')).toHaveAccessibleName('Hub — Home');
  await expect(page.locator('#hub').getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await search.fill('library'); await search.press('Enter');
  await expect(page.locator('#hub')).toHaveAccessibleName('Hub — Build Library');
  await expect(page.locator('#hub').getByRole('heading', { name: 'Build Library', exact: true })).toBeVisible();
  await page.keyboard.press('Meta+r');
  await search.fill('settings'); await search.press('Enter');
  await expect(page.locator('#hub')).toHaveAccessibleName('Hub — Settings');
  await expect(page.locator('#hub').getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('a child cue describes the Right Arrow action (HUB-167)', async ({ page }) => {
  await page.goto('/?hub');
  await page.locator('.hub-search input').fill('build smiter');
  await expect(page.locator('.hub-row[data-id="build:hub-smiter"]')).toHaveAttribute('aria-description', /Right Arrow opens/);
});

test('only the selected whisper transcript announces appended messages (HUB-081)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('whisper Romi'); await search.press('Enter');
  const log = page.getByRole('log', { name: 'Messages with Romi Ranger', exact: true });
  await expect(log).toBeVisible();
  const before = await log.locator('article').count();
  await page.evaluate(() => window.dispatchEvent(new Event('hub-fixture-incoming')));
  await expect(log.locator('article')).toHaveCount(before + 1);
  await expect(log.locator('article').last()).toContainText('Ready for another mission?');
  await page.getByRole('button', { name: 'Hide Whispers', exact: true }).click();
  await expect(page.locator('[data-transcript][role="log"]')).toHaveCount(0);
});

test('root typing and complete library entry stay within the scale budget (HUB-110, 112, 169)', async ({ page }, info) => {
  await page.goto('/?hub&library=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const timings = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('.hub-search input')!;
    const longTasks: number[] = [];
    const observer = new PerformanceObserver(entries => longTasks.push(...entries.getEntries().map(entry => entry.duration)));
    observer.observe({ type: 'longtask' });
    const typing: number[] = [];
    const paints: number[] = [];
    for (const query of ['m', 'mo', 'mon', 'mo', 'm', '']) {
      const key = query.length < input.value.length ? 'Backspace' : query.at(-1) ?? 'Backspace';
      const started = performance.now();
      // Real typing runs the key handler before input; include its layout cost in the budget.
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
      typing.push(performance.now() - started);
      await new Promise(requestAnimationFrame); paints.push(performance.now() - started);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    const rootLongTasks = [...longTasks, ...observer.takeRecords().map(record => record.duration)];
    longTasks.length = 0;
    const started = performance.now(); window.gwHub!.browseBuilds();
    const entry = performance.now() - started;
    // Observe every deferred batch, including those beyond the first 100 ms.
    while (document.querySelectorAll('.hub-build-row').length < 1000) await new Promise(requestAnimationFrame);
    const row = document.querySelector<HTMLElement>('.hub-build-row')!;
    const height = row.getBoundingClientRect().height;
    // Long-task delivery is asynchronous; wait for the observer before judging its evidence.
    await new Promise(resolve => setTimeout(resolve, 100));
    longTasks.push(...observer.takeRecords().map(record => record.duration));
    observer.disconnect();
    return { typing, paints, entry, rootLongTasks, libraryLongTasks: longTasks, height };
  });
  await writeFile(info.outputPath('scale-timings.json'), JSON.stringify(timings, null, 2));
  await info.attach('scale-timings.json', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  expect(Math.max(...timings.typing)).toBeLessThan(timeBudget(32));
  expect(Math.max(...timings.paints)).toBeLessThanOrEqual(timeBudget(32));
  expect(timings.rootLongTasks.filter(duration => duration > timeBudget(50))).toEqual([]);
  expect(timings.entry).toBeLessThan(timeBudget(100));
  expect(timings.libraryLongTasks.filter(duration => duration > timeBudget(50))).toEqual([]);
});

test('End and Back reach rows the 1000-build Library has not painted yet (HUB-112)', async ({ page }) => {
  await page.goto('/?hub&library=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  // Entry and End in one task: later frames cannot have painted the last row yet.
  const end = await page.evaluate(() => {
    window.gwHub!.browseBuilds();
    const input = document.querySelector<HTMLInputElement>('.hub-search input')!;
    const painted = document.querySelectorAll('.hub-row').length;
    const height = document.getElementById('hub-results')!.getBoundingClientRect().height;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const option = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    const list = document.getElementById('hub-results')!.getBoundingClientRect(), box = option?.getBoundingClientRect();
    return { painted, height, heightAfter: list.height, last: option === [...document.querySelectorAll('.hub-row')].at(-1), selected: option?.getAttribute('aria-selected'),
      visible: !!box && box.top >= list.top - 1 && box.bottom <= list.bottom + 1 };
  });
  expect(end.painted).toBeLessThan(1000);
  expect(end.heightAfter).toBe(end.height);
  expect(end).toMatchObject({ last: true, selected: 'true', visible: true });
  // A place far below the first painted rows; the row opened there ends above the list's end.
  const search = page.locator('.hub-search input');
  await search.press('Home');
  const list = page.locator('#hub-results');
  await list.evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
  const scroll = await list.evaluate(element => element.scrollTop);
  const id = await list.evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)!.closest<HTMLElement>('.hub-row')!.dataset.id!;
  });
  await page.locator(`.hub-row[data-id="${id}"]`).click();
  await expect(page.locator('.hub-caption')).not.toHaveText('Build Library');
  await page.keyboard.press('Meta+Backspace');
  await expect(page.locator('.hub-caption')).toHaveText('Build Library');
  await expect(page.locator('#hub [aria-selected="true"]')).toHaveAttribute('data-id', id);
  expect(await list.evaluate(element => element.scrollTop)).toBe(scroll);
});

test('narrowing a large result list retains unchanged rows and their pointer action (HUB-170)', async ({ page }) => {
  await page.goto('/?hub&library=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  await search.fill('build healer');
  const row = page.locator('.hub-row[data-id="build:scale-8"]');
  const node = await row.elementHandle();
  await search.fill('build healer d');
  expect(await node!.evaluate(element => element.isConnected)).toBe(true);
  await row.click();
  await expect(page.locator('.hub-caption')).toHaveText('Deep Healer 0008');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action', /apply|command/);
});

test('Settings describes controls and shortcut labels cannot start a capture (HUB-115)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Resign', exact: true })).toHaveAccessibleDescription('Ask before sending /resign in PvE. Enter confirms; Escape cancels.');
  await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
  const change = page.getByRole('button', { name: 'Switch Character', exact: true });
  await page.locator('.hub-setting-row').filter({ has: change }).locator('strong').click();
  await expect(change).not.toHaveAttribute('data-capturing', 'true');
  await expect(page.getByRole('button', { name: 'Reset Switch Character', exact: true })).toBeDisabled();
  await change.click(); await change.press('a');
  await expect(page.locator('.hub-settings-status')).toContainText('That combination is not a shortcut.');
  await change.click(); await change.press('Meta+c');
  await expect(page.locator('.hub-settings-status')).toHaveText('Reserved by gwonmac or macOS. Choose another combination.');
  await expect(change).toBeFocused();
});


test('Trade counts and opacity values are passive, with slider value text (HUB-162)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Close Hub', exact: true }).click();
  await page.keyboard.press('Meta+k');
  await expect(page.locator('.trade-summary')).toBeVisible();
  await expect(page.locator('.trade-summary')).not.toHaveAttribute('aria-live');
  await expect(page.locator('.trade-status')).toHaveAttribute('role', 'status');
  await page.keyboard.press('Meta+r');
  const search = page.locator('.hub-search input');
  await search.fill('settings'); await search.press('Enter');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const opacity = page.getByRole('slider', { name: 'Panel opacity', exact: true });
  await opacity.focus(); await opacity.press('ArrowLeft');
  await expect(opacity).toHaveAttribute('aria-valuetext', `${await opacity.inputValue()}%`);
  await expect(page.locator('.hub-setting-range output')).toHaveCount(0);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('whisper Romi'); await search.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Message Romi Ranger', exact: true })).toBeVisible();
  await page.getByLabel('Chat options', { exact: true }).click();
  const whisperOpacity = page.getByRole('slider', { name: 'Background', exact: true });
  await whisperOpacity.focus(); await whisperOpacity.press('ArrowLeft');
  await expect(whisperOpacity).toHaveAttribute('aria-valuetext', `${await whisperOpacity.inputValue()}%`);
  await expect(page.locator('.whisper-opacity output')).toHaveCount(0);
});

test('Characters has one dialog and horizontal positions (HUB-163)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.keyboard.press('Meta+e');
  await expect(page.locator('#hub dialog')).toHaveCount(0);
  const characters = page.getByRole('listbox', { name: 'Characters', exact: true });
  await expect(characters).toHaveAttribute('aria-orientation', 'horizontal');
  const rows = characters.getByRole('option');
  await expect(rows.first()).toHaveAttribute('aria-posinset', '1');
  await expect(rows.first()).toHaveAttribute('aria-setsize', '7');
});


test('status owners are rendered before their first message (HUB-114)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const status = page.locator('.hub-status');
  await expect(status).toBeEmpty();
  await expect(status).toBeVisible();
  await expect(page.locator('.hub-receipt-announcement')).toBeVisible();
  const search = page.locator('.hub-search input');
  await search.fill('settings'); await search.press('Enter');
  await expect(page.locator('.hub-settings-status')).toBeEmpty();
  await expect(page.locator('.hub-settings-status')).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await search.fill('maps'); await search.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Settings');
  await expect(page.getByRole('button', {name: 'Maps', exact: true})).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.hub-settings-status')).toBeEmpty();
  await expect(page.locator('.hub-settings-status')).toBeVisible();
});


test('placement has one toggle name, a visible move hint and a 48px Shift step (HUB-164)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const lock = page.getByRole('button', { name: 'Lock Hub position', exact: true });
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  const panel = page.locator('.hub-panel');
  const footer = page.locator('.hub-footer');
  const footerHeight = (await footer.boundingBox())!.height;
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.hub-move-hint')).toBeVisible();
  const initial = (await panel.boundingBox())!;
  await lock.press('Alt+Shift+ArrowLeft');
  expect((await panel.boundingBox())!.x).toBeCloseTo(initial.x - 48);
  await lock.press('Alt+ArrowRight');
  expect((await panel.boundingBox())!.x).toBeCloseTo(initial.x - 32);
  expect((await footer.boundingBox())!.height).toBe(footerHeight);
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hub-move-hint')).toBeHidden();
});

test('breadcrumb keyboard focus leaves space around its text and outline (HUB-165)', async ({ page }) => {
  await page.goto('/?hub');
  const search = page.locator('.hub-search input');
  await search.fill('settings'); await search.press('Enter');
  const home = page.getByRole('button', { name: 'Home', exact: true });
  await home.focus();
  const geometry = await home.evaluate(button => {
    const style = getComputedStyle(button);
    const parent = getComputedStyle(button.parentElement!);
    return { padding: parseFloat(style.paddingLeft), offset: parseFloat(style.outlineOffset), room: parseFloat(parent.paddingLeft) };
  });
  expect(geometry.padding).toBeGreaterThanOrEqual(4);
  expect(geometry.offset).toBeGreaterThan(0);
  expect(geometry.room).toBeGreaterThanOrEqual(3);
  await expect(home).toBeFocused();
  await home.press('Enter');
  await expect(page.locator('.hub-caption')).toHaveText('Home');
});


test('twenty opens and resumes search once per transition without accumulating DOM (HUB-111, 171)', async ({ page }, info) => {
  await page.goto('/?hub&library=1000&templates-ms=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const hub = window.gwHub!;
    let calls = 0;
    const detach = hub.attach({ search() { calls++; return []; }, setVisible() {}, subscribe() { return () => {}; } } satisfies HubSource);
    const opens: number[] = [], paints: number[] = [], resumes: number[] = [], passes: number[] = [];
    const input = document.querySelector<HTMLInputElement>('.hub-search input')!;
    for (let cycle = 0; cycle < 20; cycle++) {
      hub.close(); calls = 0;
      const started = performance.now(); hub.show(); opens.push(performance.now() - started);
      passes.push(calls); await new Promise(requestAnimationFrame); paints.push(performance.now() - started);
      input.value = 'm'; input.dispatchEvent(new Event('input', { bubbles: true }));
      window.dispatchEvent(new Event('blur')); calls = 0;
      const resumed = performance.now(); hub.show(); resumes.push(performance.now() - resumed);
      passes.push(calls); await new Promise(requestAnimationFrame);
    }
    hub.close(); const remaining = document.querySelectorAll('#hub-results .hub-row').length;
    detach(); return { opens, paints, resumes, passes, remaining };
  });
  await info.attach('twenty-open-timings.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.passes).toEqual(Array(40).fill(1));
  expect(result.remaining).toBe(0);
  expect(Math.max(...result.opens)).toBeLessThanOrEqual(timeBudget(16));
  expect(Math.max(...result.paints)).toBeLessThanOrEqual(timeBudget(32));
  expect(Math.max(...result.resumes)).toBeLessThanOrEqual(timeBudget(32));
});


test('incoming bursts keep a deep build selection and bounded arrow mutations (HUB-111, 112)', async ({ page }, info) => {
  await page.goto('/?hub&library=1000');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search = page.locator('.hub-search input');
  await search.fill('build library'); await search.press('Enter');
  const deep = page.locator('.hub-row[data-id="build:scale-500"]');
  await deep.scrollIntoViewIfNeeded();
  await deep.dispatchEvent('pointermove', { movementX: 1 });
  await expect(deep).toHaveAttribute('aria-selected', 'true');
  const result = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('.hub-search input')!;
    const list = document.querySelector<HTMLElement>('#hub-results')!;
    const tasks: number[] = [], mutations: number[] = [];
    const observer = new PerformanceObserver(entries => tasks.push(...entries.getEntries().map(entry => entry.duration)));
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    observer.observe({ type: 'longtask' });
    for (let message = 0; message < 40; message++) {
      window.dispatchEvent(new Event('hub-fixture-incoming'));
      await new Promise(resolve => setTimeout(resolve, 125));
    }
    const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')!.dataset.id;
    const scroll = list.scrollTop;
    for (let arrow = 0; arrow < 10; arrow++) {
      const changes = new MutationObserver(() => {}); changes.observe(list, { attributes: true, subtree: true });
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      mutations.push(changes.takeRecords().length); changes.disconnect(); await new Promise(requestAnimationFrame);
    }
    await new Promise(resolve => setTimeout(resolve, 100)); tasks.push(...observer.takeRecords().map(record => record.duration)); observer.disconnect();
    return { selected, scroll, mutations, tasks };
  });
  await info.attach('incoming-burst.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.selected).toBe('build:scale-500');
  expect(result.scroll).toBeGreaterThan(0);
  expect(Math.max(...result.mutations)).toBeLessThanOrEqual(4);
  expect(result.tasks.filter(duration => duration > timeBudget(50))).toEqual([]);
});
