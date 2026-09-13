/** The browser party fixture must satisfy the real planner before it can prove UI flows. */
import { expect, test } from 'vitest';
import { createHubGameFixture } from './hub-game-fixture';
import { resolveTeamApplyPlan } from '../../../src/shared/builds/team-apply';
import { validateBuildFor } from '../../../src/shared/builds/validate';

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
    }, { attach(next) { source = next; return () => {}; }, close() {}, showRows(_title, getRows) { rows = getRows; }, showView() {} }).dispose;
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  source!.setVisible(true); await nextTick(); await nextTick();
  await source!.search('build native')[0]!.run();
  const apply = rows!().find(row => row.title === 'Apply to me')!;
  contents = encodeSkillTemplate({ ...monk, attributes: {} })!;
  await expect(apply.run()).rejects.toThrow('saved configuration changed');
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
    createHubLibrary(useLibrary(host), host, { attach(next) { source = next; return () => {}; }, close() {}, showRows() {}, showView() {} });
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
    dispose = createHubLibrary(useLibrary(fixtureHost), fixtureHost, { attach(next) { source = next; return () => {}; }, close() {}, showRows() {}, showView() {} }).dispose;
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
    createHubLibrary(useLibrary(host), host, { attach(next) { source = next; return () => {}; }, close() {},
      showRows(_title, next, context) { rows = next; summary = context; }, showView() {} });
    return () => h('div');
  } });
  app.mount(document.createElement('div')); await nextTick(); await nextTick();
  await source!.search('build smiter')[0]!.run();
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
  ] as const;
  let source: import('../../../src/shared/hub').HubSource | undefined;
  let dispose: (() => void) | undefined;
  const fixtureHost = { ...host, async loadTemplates() { return entries.map(([path, build]) => ({ path, contents: encodeSkillTemplate(build)! })); } };
  const app = createApp({ setup() {
    dispose = createHubLibrary(useLibrary(fixtureHost), fixtureHost, { attach(next) { source = next; return () => {}; }, close() {}, showRows() {}, showView() {} }).dispose;
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
  expect(folders('build folder:/ monk')).toEqual(['']);
  for (const query of ['build missing monk', 'build farming/team monk', 'build folder:protection', 'build folder:template-code', 'build folder:']) expect(folders(query), query).toEqual([]);
  expect(source!.search('build folder:"Team Builds/Farming" monk')[0]).toMatchObject({ title: 'Protection', folder: 'Team Builds/Farming', action: 'Choose target' });
  dispose?.(); app.unmount();
});
