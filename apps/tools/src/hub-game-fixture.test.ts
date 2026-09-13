/** The browser party fixture must satisfy the real planner before it can prove UI flows. */
import { expect, test } from 'vitest';
import { createHubGameFixture } from './hub-game-fixture';
import { resolveTeamApplyPlan } from '../../../src/shared/builds/team-apply';
import { validateBuildFor } from '../../../src/shared/builds/validate';

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
  expect(source!.search('build monk')[0]).toMatchObject({ action: 'Review', skills: expect.arrayContaining([expect.objectContaining({ name: 'Word of Healing' })]) });
  dispose?.(); app.unmount();
});
