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
  for (const query of ['library', 'lib', 'bu', 'team', 'teams', 'skills', 'build library']) {
    const rows = source!.search(query);
    expect(rows.filter(row => row.id === 'builds'), query).toHaveLength(1);
    expect(rows.find(row => row.id === 'builds')?.detail).toBe('Browse saved builds and teams');
    expect(rows.find(row => row.id === 'builds')?.unavailable).toBeUndefined();
  }
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
    ['Skills/Moon pressure.txt', mesmer],
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
  // HUB-059: short codes remain additive, with actual profession matches before name prefixes.
  const professionRows = source!.search('build mo');
  expect(professionRows[0]?.professions?.[0]?.code).toBe('Mo');
  expect(professionRows.map(row => row.title)).toContain('Moon pressure');
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
  const commands: string[] = [];
  const { host } = createHubGameFixture(command => commands.push(command));
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
  expect(source!.search('team gom afk')[0]!.preview).toContain('Already matches');
  const sent = commands.length;
  await source!.search('team gom afk')[0]!.run({ live: () => true, progress() {}, done: receipt => { if (receipt) receipts.push(receipt); } });
  expect(commands).toHaveLength(sent);
  expect(receipts).toEqual(['GOM AFK applied.', 'GOM AFK already matches.']);
  app.unmount();
});

test('a team apply that fails after the player moved on names the team and keeps the outcome (HUB-016)', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  localStorage.removeItem('hub-fixture-library');
  const commands: string[] = [];
  const fixture = createHubGameFixture(command => commands.push(command));
  fixture.setScenario('partial');
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let controller: import('./use-library').LibraryController | undefined;
  let review: import('../../../src/shared/hub').HubViewMount<HTMLElement> | undefined;
  const app = createApp({ setup() {
    controller = useLibrary(fixture.host);
    createHubLibrary(controller, fixture.host, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView(_title, mount) { review = mount; } });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  const done: string[] = [];
  await expect(source!.search('team gom afk')[0]!.run({ live: () => false, progress() {}, done: receipt => { if (receipt) done.push(receipt); } }))
    .rejects.toThrow('GOM AFK partly applied. Open Hub to review.');
  expect(done).toEqual([]);
  // The reopened Hub shows the outcome, and opening the review keeps it.
  expect(source!.search('team gom afk')[0]!.detail).toBe('Partly applied · Review');
  expect(source!.search('team gom afk')[0]!.action).toBe('Review GOM AFK');
  source!.search('team gom afk')[0]!.run(task);
  const target = document.createElement('div');
  let primary: import('../../../src/shared/hub').HubViewAction | null = null;
  review!(target, () => {}, { primary(next) { primary = next; }, secondary() {}, openActions() {} });
  expect(target.querySelector('[role=status]')?.textContent).toMatch(/^Team partly applied\. Synthetic interruption/);
  expect(target.textContent).toContain('Completed');
  expect(target.textContent).toContain('Enabling Hard Mode confirmed.');
  expect(target.textContent).toContain('Remaining');
  expect(target.textContent).toContain('Update your build');
  expect(source!.search('team gom afk')[0]!.detail).toBe('Partly applied · Review');
  // The player can finish the same configuration outside Hub before retrying.
  fixture.setScenario('standard');
  const loaded = await fixture.host.loadLibrary();
  const { resolveTeamApplyPlan } = await import('../../../src/shared/builds/team-apply');
  const resolved = resolveTeamApplyPlan(loaded.library.teams[0]!, loaded.library, controller!.validate);
  if (!resolved.valid) throw new Error('Expected valid saved fixture team');
  await fixture.host.applyTeam(resolved.plan);
  const sent = commands.length;
  await primary!.run({ live: () => true, progress() {}, done: receipt => { if (receipt) done.push(receipt); } });
  expect(done).toEqual(['GOM AFK already matches.']);
  expect(commands).toHaveLength(sent);
  expect(source!.search('team gom afk')[0]!.detail).toBe('Saved team · Hard Mode · 7 heroes');
  app.unmount();
});


test('Library browse includes saved teams and only an exact scoped team can apply', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { host } = createHubGameFixture(() => {});
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let browse: (() => readonly import('../../../src/shared/hub').HubRow[]) | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary(host), host, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows(_title, rows) { browse = rows; }, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  source!.lookup!('builds')!.run(task);
  expect(browse!().filter(row => row.group === 'Teams').map(row => row.title)).toEqual(['GOM AFK', 'Balanced vanquish', 'Classic Discordway', 'Story and missions']);
  for (const query of ['team ', 'teams ', 'team gom']) {
    const rows = source!.search(query);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.action.startsWith('Review ') && !row.consequential), query).toBe(true);
  }
  expect(source!.search('team gom afk')[0]?.action).toBe('Apply team GOM AFK');
  app.unmount();
});


test('scoped teams show Loading until the library settles and publish their ready replacement', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { flushPromises } = await import('@vue/test-utils');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { host } = createHubGameFixture(() => {});
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let source: import('../../../src/shared/hub').HubSource | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary({ ...host, loadLibrary: async () => { await gate; return host.loadLibrary(); } }), host,
      { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick();
  expect(source!.search('team gom').map(row => [row.title, row.unavailable])).toEqual([['Loading teams…', 'Build Library is loading.']]);
  let latest: readonly import('../../../src/shared/hub').HubRow[] = [];
  const stop = source!.subscribe(() => { latest = source!.search('team gom'); });
  release(); await flushPromises();
  expect(latest.map(row => row.title)).toEqual(['GOM AFK']);
  expect(latest[0]?.unavailable).toBeUndefined();
  stop(); app.unmount();
});


test('hero targets preserve observed party slots, name secondary changes and keep refusals inspectable', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { host } = createHubGameFixture(() => {});
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let rows: (() => readonly import('../../../src/shared/hub').HubRow[]) | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary(host), host, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows(_title, next) { rows = next; }, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  source!.search('build monk')[0]!.run(task);
  rows!().find(row => row.id === 'choose-hero')!.run(task);
  const party = rows!().filter(row => row.group === 'In your party');
  expect(party.map(row => row.title)).toEqual(['Livia', 'Master of Whispers', 'Norgu', 'Gwen', 'Tahlkora', 'Razah', 'Vekk']);
  expect(party.map(row => row.detail.split(' · ')[0])).toEqual(['Slot 2', 'Slot 3', 'Slot 4', 'Slot 5', 'Slot 6', 'Slot 7', 'Slot 8']);
  expect(party[0]?.detail).toContain('Secondary profession: None → Mesmer');
  const dunkoro = rows!().find(row => row.title === 'Dunkoro')!;
  expect(dunkoro.detail).toBe('Add Dunkoro to your party first.');
  expect(dunkoro.readOnly).toBe(true);
  expect(dunkoro.action).toBe('Review availability');
  app.unmount();
});


test('single-build refusals name the build operation, locked skills and primary professions', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const fixture = createHubGameFixture(() => {});
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let rows: (() => readonly import('../../../src/shared/hub').HubRow[]) | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary(fixture.host), fixture.host, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows(_title, next) { rows = next; }, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  fixture.setPlayRegion({ status: 'ready', sequence: 1, mapId: 55, instanceType: 1, playRegion: 'pve', travelContext: 'world', characterKey: 'a', unlockedMapWords: null, guildHall: false, hasGuildHall: false });
  source!.search('build smiter')[0]!.run(task);
  expect(rows!()[0]?.unavailable).toBe('Enter an outpost to apply this build.');
  fixture.host.party.value = { ...fixture.host.party.value, inOutpost: true, characterSkills: { knownThrough: 1_000, unlocked: new Set() } };
  expect(rows!()[0]?.unavailable).toContain('Word of Healing');
  expect(rows!()[0]?.unavailable).not.toMatch(/skill 20[0-9]/u);
  const player = fixture.host.party.value.player;
  if (!player) throw new Error('Fixture player is missing');
  fixture.host.party.value = { ...fixture.host.party.value, characterSkills: null, player: { ...player, professions: ['Me', null] } };
  expect(rows!()[0]?.unavailable).toBe('Your assigned build is for Monk, but the observed primary is Mesmer.');
  app.unmount();
});


test('team previews name removals, a roster rebuild and the mode change before Apply', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { mapTeamSlots, teamId } = await import('../../../src/shared/builds/library');
  const { host } = createHubGameFixture(() => {});
  const loaded = await host.loadLibrary();
  const original = loaded.library.teams[0]!;
  const trio = { ...original, id: teamId('trio'), name: 'GOM trio', slots: mapTeamSlots(original.slots, (slot, index) => index < 4 ? slot : { build: null, hero: null, behaviour: 'guard' }) };
  const keep = { ...trio, id: teamId('keep'), name: original.name, mode: 'none' as const };
  const duplicate = { ...trio, id: teamId('duplicate'), name: original.name, mode: 'normal' as const };
  const reordered = { ...original, id: teamId('reordered'), name: 'GOM reordered', slots: mapTeamSlots(original.slots, (slot, index) => index === 1 ? original.slots[2] : index === 2 ? original.slots[1] : slot) };
  let source: import('../../../src/shared/hub').HubSource | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary({ ...host, loadLibrary: async () => ({ ...loaded, library: { ...loaded.library, teams: [trio, reordered, original, duplicate, keep] } }) }), host,
      { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  expect(source!.search('team gom trio')[0]?.preview).toContain('Removes Gwen, Tahlkora, Razah, Vekk');
  expect(source!.search('team gom reordered')[0]?.preview).toContain('Rebuilds hero order');
  expect(source!.search('team gom reordered')[0]?.preview).toContain('Switches to Hard Mode');
  expect(source!.search('team gom afk').map(row => row.detail).sort()).toEqual(['Saved team · Hard Mode · 7 heroes', 'Saved team · Keep difficulty · 3 heroes', 'Saved team · Normal Mode · 3 heroes']);
  app.unmount();
});


test('invalid team reviews name the failing slot and open the same saved team in its editor', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  const { mapTeamSlots } = await import('../../../src/shared/builds/library');
  const { host } = createHubGameFixture(() => {});
  const loaded = await host.loadLibrary();
  const original = loaded.library.teams[0]!;
  const invalid = { ...original, slots: mapTeamSlots(original.slots, (slot, index) => index === 7 ? { ...slot, hero: null } : slot) };
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let review: import('../../../src/shared/hub').HubViewMount<HTMLElement> | undefined;
  let edit: import('../../../src/shared/hub').HubViewAction | null = null;
  let selected: import('../../../src/shared/builds/library').Build | import('../../../src/shared/builds/library').Team | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary({ ...host, loadLibrary: async () => ({ ...loaded, library: { ...loaded.library, teams: [invalid] } }) }), host,
      { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows() {}, showView(_title, mount) { review = mount; } }, item => { selected = item; });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  const row = source!.search('team gom afk')[0]!;
  expect(row.unavailable).toBe('Choose a hero for slot 8.');
  row.navigate!(task);
  const target = document.createElement('div');
  review!(target, () => {}, { primary(action) { expect(action?.disabled).toBe(true); }, secondary(action) { edit = action; }, openActions() {} });
  expect(target.querySelector('[role=status]')?.textContent).toBe('Choose a hero for slot 8.');
  expect(edit).toMatchObject({ label: 'Open in Build Library' });
  if (!edit) throw new Error('Editor action missing');
  const action: import('../../../src/shared/hub').HubViewAction = edit;
  await action.run(task);
  expect(selected).toEqual(invalid);
  app.unmount();
});


test('single-build receipts distinguish changes from reapplication and use the sentence target (HUB-183)', async () => {
  const { createApp, h, nextTick } = await import('vue');
  const { useLibrary } = await import('./use-library');
  const { createHubLibrary } = await import('./hub-library');
  localStorage.removeItem('hub-fixture-library');
  const commands: string[] = [];
  const { host } = createHubGameFixture(command => commands.push(command));
  let failSave = false;
  const fixtureHost = { ...host, async saveLibrary(value: Parameters<typeof host.saveLibrary>[0]) {
    if (failSave) throw new Error('Synthetic save refusal');
    return host.saveLibrary(value);
  } };
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let rows: (() => readonly import('../../../src/shared/hub').HubRow[]) | undefined;
  const app = createApp({ setup() {
    createHubLibrary(useLibrary(fixtureHost), fixtureHost, { attach(next) { source = next; return () => {}; }, close() {}, notify() {}, showRows(_title, next) { rows = next; }, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  const receipts: string[] = [];
  const apply = async () => {
    await source!.search('build smiter')[0]!.run(task);
    expect(rows!()[0]!.action).toBe('Apply Smiter to your character');
    await rows!()[0]!.run({ live: () => true, progress() {}, done: receipt => { if (receipt) receipts.push(receipt); } });
  };
  try {
    await apply();
    expect(receipts).toEqual(['Smiter applied to your character.']);
    const changed = host.party.value.player;
    const sent = commands.length;
    await apply();
    expect(receipts).toEqual(['Smiter applied to your character.', 'Smiter already matches.']);
    expect(commands.slice(sent)).toEqual(['apply-build']);
    failSave = true;
    await apply();
    expect(receipts.at(-1)).toBe('Smiter already matches. Recent use could not be saved.');
    host.party.value = { ...host.party.value, player: { ...changed!, attributes: {} } };
    await apply();
    expect(receipts.at(-1)).toBe('Smiter applied to your character. Recent use could not be saved.');
  } finally { app.unmount(); }
});
