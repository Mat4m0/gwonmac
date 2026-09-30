/** The browser party fixture must satisfy the real planner before it can prove UI flows. */
import { expect, test } from 'vitest';
import { createHubGameFixture } from './hub-game-fixture';
import { resolveTeamApplyPlan } from '../../../src/shared/builds/team-apply';
import { validateBuildFor } from '../../../src/shared/builds/validate';
import type { HubTask } from '../../../src/shared/hub';

/** A task on a page that still shows. */
const task: HubTask = { live: () => true, progress() {}, done() {} };

test('Hub rereads a native template before applying and refuses a replaced file', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { encodeSkillTemplate } = await import('../../../src/shared/builds/skill-template');
  const { host } = createHubGameFixture(() => {});
  const { library } = await host.loadLibrary();
  const monk = library.builds.find(build => build.professions[0] === 'Mo')!;
  let contents = encodeSkillTemplate(monk)!;
  let calls = 0;
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let rows: (() => readonly import('../../../src/shared/hub').HubRow[]) | undefined;
  let dispose: (() => void) | undefined;
  const app = createApp({ setup() {
    dispose = createHubLibrary(useLibrary(host), { ...host,
      async loadTemplates() { return [{ path: 'Skills/Monk/Native.txt', contents }]; },
      async applyBuild() { calls++; return { commandId: 1, completedChanges: 1, skippedSkills: [] }; },
    }, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows(_title, getRows) { rows = getRows; }, showView() {} }).dispose;
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  source!.setVisible(true); await nextTick(); await nextTick();
  await source!.search('build native')[0]!.run(task);
  const apply = rows!().find(row => row.title === 'Apply to me')!;
  contents = encodeSkillTemplate({ ...monk, attributes: {} })!;
  await expect(apply.run(task)).rejects.toThrow('saved configuration changed');
  expect(calls).toBe(0);
  dispose?.(); app.unmount();
});

test('the flagship team passes canonical validation', async () => {
  const { host } = createHubGameFixture(() => {});
  const { library } = await host.loadLibrary();
  const result = resolveTeamApplyPlan(library.teams[0]!, library, (build, context) => {
    const checked = validateBuildFor(build, id => id !== null && host.skills.has(id) ? host.skills.get(id) : null, context);
    expect(checked).toEqual({ valid: true });
    return checked;
  });
  expect(result.valid).toBe(true);
});

test('the mounted controller validates the same flagship team', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { host } = createHubGameFixture(() => {});
  let controller: ReturnType<typeof useLibrary> | undefined;
  const target = document.createElement('div');
  const app = createApp({ setup() { controller = useLibrary(host); return () => h('div'); } });
  app.mount(target); await nextTick(); await nextTick();
  const library = controller!.library.value!;
  expect(resolveTeamApplyPlan(library.teams[0]!, library, controller!.validate)).toMatchObject({ valid: true });
  app.unmount();
});

test('Hub exposes a ready exact team from the shared controller', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { host } = createHubGameFixture(() => {});
  let source: import('../../../src/shared/hub').HubSource | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary(host), host, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  expect(source!.search('team gom afk')[0]?.unavailable).toBeUndefined();
  app.unmount();
});

test('profession search includes every saved primary-profession build without a result cap', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { buildId } = await import('../../../src/shared/builds/library');
  const { host } = createHubGameFixture(() => {});
  const { library } = await host.loadLibrary();
  const monk = library.builds.find(build => build.professions[0] === 'Mo')!;
  const builds = Array.from({ length: 15 }, (_, index) => ({ ...monk, id: buildId(`monk-${index}`), name: `Support ${index}` }));
  const fixtureHost = { ...host, async loadLibrary() { return { library: { ...library, builds }, recovered: false }; } };
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let dispose: (() => void) | undefined;
  const app = createApp({ setup() {
    dispose = createHubLibrary(useLibrary(fixtureHost), fixtureHost, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView() {} }).dispose;
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  expect(source!.search('build monk')).toHaveLength(15);
  expect(source!.search('build mo')).toHaveLength(15);
  expect(source!.search('build mesmer')).toHaveLength(0);
  expect(source!.search('build monk support')).toHaveLength(15);
  expect(source!.search('build monk')[0]).toMatchObject({ action: 'Choose target', skills: expect.arrayContaining([expect.objectContaining({ name: 'Word of Healing' })]) });
  dispose?.(); app.unmount();
});

test('Hub current-build comparison follows observations and never substitutes the incoming bar', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { host } = createHubGameFixture(() => {});
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let rows: (() => readonly import('../../../src/shared/hub').HubRow[]) | undefined;
  let summary: import('../../../src/shared/hub').HubSummary | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary(host), host, { attach(next) { source = next; return () => {}; }, close() {}, notify() {},
      showRows(_title, next, context) { rows = next; summary = context; }, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  await source!.search('build smiter')[0]!.run(task);
  const incoming = summary!.skills;
  expect(rows!()[0]!.skills).not.toEqual(incoming);
  host.party.value = { ...host.party.value, player: { ...host.party.value.player!, skills: null, attributes: null } };
  expect(rows!()[0]!.skills).toBeUndefined();
  expect(rows!()[0]!.detail).toContain('Current build not available');
  expect(summary!.skills).toEqual(incoming);
  host.party.value = { ...host.party.value, status: 'unavailable' };
  expect(rows!()[0]!.skills).toBeUndefined();
  app.unmount();
});

test('build folder search handles paths, words, quotes, prefixes and ambiguous names without applying', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { encodeSkillTemplate } = await import('../../../src/shared/builds/skill-template');
  const { host } = createHubGameFixture(() => { throw new Error('Search must not apply'); });
  const { library } = await host.loadLibrary();
  const monk = library.builds.find(build => build.professions[0] === 'Mo')!;
  const mesmer = library.builds.find(build => build.professions[0] === 'Me')!;
  const entries = [
    ['Skills/Team Builds/Farming/Protection.txt', monk],
    ['Skills/Team Builds/Dungeons/Protection.txt', monk],
    ['Skills/Other/Farming/Protection.txt', monk],
    ['Skills/Monk/Panic.txt', mesmer],
    ['Skills/Root.txt', monk],
    ['Skills/Mo/Me/Panic.txt', mesmer],
  ] as const;
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let dispose: (() => void) | undefined;
  const fixtureHost = { ...host, async loadTemplates() { return entries.map(([path, build]) => ({ path, contents: encodeSkillTemplate(build)! })); } };
  const app = createApp({ setup() {
    dispose = createHubLibrary(useLibrary(fixtureHost), fixtureHost, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView() {} }).dispose;
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  source!.setVisible(true); await nextTick(); await nextTick();
  const folders = (query: string) => source!.search(query).map(row => row.folder);
  for (const query of ['build team builds farming monk', 'build "Team Builds" farming mo', 'build "Team Builds/Farming" monk', 'build folder:"team builds/farm" protection', 'build "TEAM BUILDS/Farming/" Mo/Me', 'build "Team Builds\\Farming" monk', 'build folder:"team builds/farming']) {
    expect(folders(query), query).toEqual(['Team Builds/Farming']);
  }
  expect(folders('build folder:"team builds" monk')).toEqual(['Team Builds/Dungeons', 'Team Builds/Farming']);
  expect(folders('build farming monk')).toEqual(['Other/Farming', 'Team Builds/Farming']);
  for (const query of ['build other/farming monk', 'build other farming monk', 'build monk farming other', 'build folder:/other/farm monk']) expect(folders(query), query).toEqual(['Other/Farming']);
  expect(folders('build "Monk" panic')).toEqual(['Monk']);
  expect(folders('build folder:monk')).toEqual(['Monk']);
  expect(folders('build folder:monk mesmer')).toEqual(['Monk']);
  expect(folders('build folder:monk monk')).toEqual([]);
  expect(folders('build Mo/Me')).not.toContain('Mo/Me');
  expect(folders('build folder:Mo/Me')).toEqual(['Mo/Me']);
  expect(folders('build Mo/Me mesmer')).toEqual([]);
  expect(folders('build folder:/ monk')).toEqual(['']);
  for (const query of ['build missing monk', 'build farming/team monk', 'build folder:protection', 'build folder:template-code', 'build folder:', 'build travel monk']) expect(folders(query), query).toEqual([]);
  expect(source!.search('build folder:"Team Builds/Farming" monk')[0]).toMatchObject({ title: 'Protection', folder: 'Team Builds/Farming', action: 'Choose target' });
  dispose?.(); app.unmount();
});

test('template source failures preserve valid results and retry distinguishes malformed files', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { encodeSkillTemplate } = await import('../../../src/shared/builds/skill-template');
  const { host } = createHubGameFixture(() => {});
  const { library } = await host.loadLibrary();
  const template = encodeSkillTemplate(library.builds[0]!)!;
  let fail = false;
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let dispose: (() => void) | undefined;
  const app = createApp({ setup() {
    const fixture = { ...host, async loadTemplates() {
      if (fail) throw new Error('Unavailable');
      return [{ path: 'Skills/Native.txt', contents: template }, { path: 'Skills/Broken.txt', contents: 'invalid' }];
    } };
    dispose = createHubLibrary(useLibrary(fixture), fixture, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView() {} }).dispose;
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  source!.setVisible(true); await nextTick(); await nextTick();
  expect(source!.search('build native').some(row => row.title === 'Native')).toBe(true);
  expect(source!.search('build native').some(row => row.title === '1 unreadable template')).toBe(true);
  fail = true; source!.setVisible(false); source!.setVisible(true); await nextTick(); await nextTick();
  const rows = source!.search('build native');
  expect(rows.some(row => row.title === 'Native')).toBe(true);
  expect(rows.some(row => row.id === 'templates-retry')).toBe(true);
  fail = false; await rows.find(row => row.id === 'templates-retry')!.run(task);
  expect(source!.search('build native').some(row => row.id === 'templates-retry')).toBe(false);
  dispose?.(); app.unmount();
});


test('recent-use bookkeeping preserves the next meaningful Undo and bounds target references', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { host } = createHubGameFixture(() => {});
  let controller: ReturnType<typeof useLibrary> | undefined;
  const app = createApp({ setup() { controller = useLibrary(host); return () => h('div'); } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  const build = controller!.library.value!.builds[0]!;
  expect(controller!.canUndo.value).toBe(false);
  await controller!.recordBuildUse(build.id, null);
  expect(controller!.canUndo.value).toBe(false);
  const heroes = host.party.value.heroes.slice(0, 3).map(member => member.hero);
  for (const hero of heroes) await controller!.recordBuildUse(build.id, hero);
  expect(controller!.recentBuilds.value).toEqual([...heroes].reverse().map(hero => ({ id: build.id, hero })));
  expect(controller!.recentBuilds.value).toHaveLength(3);
  await controller!.renameBuild(build.id, 'Renamed for test');
  await controller!.recordBuildUse(build.id, null);
  await controller!.undo();
  expect(controller!.library.value!.builds.find(item => item.id === build.id)?.name).toBe(build.name);
  app.unmount();
});

test('a scale library grows to the requested size and never overwrites saved fixture data', async () => {
  localStorage.removeItem('hub-fixture-library');
  const { host, librarySize } = createHubGameFixture(() => {}, { librarySize: 1000 });
  const { library } = await host.loadLibrary();
  expect(librarySize).toBe(1000);
  expect(library.builds).toHaveLength(1000);
  expect(new Set(library.builds.map(build => build.id)).size).toBe(1000);
  expect(new Set(library.builds.map(build => build.name)).size).toBe(1000);
  expect(library.teams.length).toBeGreaterThanOrEqual(50);
  await host.saveLibrary(library);
  expect(localStorage.getItem('hub-fixture-library')).toBeNull();
});

test('the party is observed only in a loaded map, and an explorable area is no outpost', () => {
  const { host, setPlayRegion } = createHubGameFixture(() => {});
  const ready = { status: 'ready', sequence: 2, mapId: 58, instanceType: 1, playRegion: 'pve', travelContext: 'world',
    characterKey: null, unlockedMapWords: null, guildHall: false, hasGuildHall: false } as const;
  setPlayRegion(ready);
  expect([host.party.value.status, host.party.value.inOutpost, host.party.value.playRegion]).toEqual(['ready', false, 'pve']);
  setPlayRegion({ ...ready, mapId: 188, instanceType: 0, playRegion: 'pvp' });
  expect([host.party.value.status, host.party.value.inOutpost, host.party.value.playRegion]).toEqual(['ready', true, 'pvp']);
  setPlayRegion({ status: 'waiting', reason: 'loading' });
  expect([host.party.value.status, host.party.value.inOutpost, host.party.value.playRegion]).toEqual(['unavailable', null, 'unknown']);
});

test('a team apply names counted progress and closes only the page that started it (HUB-004, HUB-083)', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  localStorage.removeItem('hub-fixture-library');
  const { host } = createHubGameFixture(() => {});
  let source: import('../../../src/shared/hub').HubSource | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary(host), host, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  const row = source!.search('team gom afk')[0]!;
  expect(row.pending).toEqual({ label: 'Applying GOM AFK…', again: 'GOM AFK is still being applied.' });
  const progress: string[] = [];
  const receipts: string[] = [];
  await row.run({ live: () => true, progress: message => progress.push(message), done: receipt => { if (receipt) receipts.push(receipt); } });
  expect(progress[0]).toBe('Applying GOM AFK…');
  expect(progress).toContain('Applying GOM AFK… 1/16');
  expect(progress.at(-1)).toBe('Applying GOM AFK… 16/16');
  expect(receipts).toEqual(['GOM AFK applied.']);
  app.unmount();
});

test('a team apply that fails after the player moved on names the team and keeps the outcome (HUB-016)', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  localStorage.removeItem('hub-fixture-library');
  const fixture = createHubGameFixture(() => {});
  fixture.setScenario('partial');
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let review: import('../../../src/shared/hub').HubViewMount<HTMLElement> | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary(fixture.host), fixture.host, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView(_title, mount) { review = mount; } });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  const done: string[] = [];
  await expect(source!.search('team gom afk')[0]!.run({ live: () => false, progress() {}, done: receipt => { if (receipt) done.push(receipt); } }))
    .rejects.toThrow('GOM AFK partly applied. Open Hub to review.');
  expect(done).toEqual([]);
  // The reopened Hub shows the outcome, and opening the review keeps it.
  expect(source!.search('team gom afk')[0]!.detail).toBe('Partly applied · Review');
  source!.search('team gom af')[0]!.run(task);
  const target = document.createElement('div');
  review!(target, () => {}, { primary() {}, secondary() {}, openActions() {}, own() {} });
  expect(target.querySelector('[role=status]')?.textContent).toMatch(/Synthetic interruption/);
  expect(source!.search('team gom afk')[0]!.detail).toBe('Partly applied · Review');
  app.unmount();
});
