import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import EliteSkillsApp from "./EliteSkillsApp.vue";
import { ELITE_FIXTURE_SKILLS, eliteFixtureView } from "./elite-fixture";
import { createSkillCatalogue } from "./skill-catalog";
import { useEliteTracking, type EliteTrackingHost } from "./use-elite-tracking";
import { ELITE_LOCATIONS } from "../../../src/shared/elite-locations";
import { EMPTY_ELITE_TRACKING, changeEliteTracking, type EliteTracking } from "../../../src/shared/elite-skills";
import { travelCharacterKey, type TravelCharacterKey } from "../../../src/shared/travel-history";
import { eliteMarkerAt, eliteSpawnLinks, eliteZoomGrowth, placeEliteMarkers, type EliteMapHit, type EliteMarkerScene, type EliteSceneMarker } from "../../../src/shared/elite-map-scene";
import type { EliteLocation } from "../../../src/shared/elite-skills";
import { installEliteMapPointer } from "../../../src/shared/ui/elite-map-pointer";
import { skillId } from "../../../src/shared/builds/library";
function host(): EliteTrackingHost {
  const saved = new Map<string, EliteTracking>();
  return { get: vi.fn(async ({ characterKey }) => saved.get(characterKey) ?? EMPTY_ELITE_TRACKING), update: vi.fn(async ({ characterKey, change }) => {
    const current = changeEliteTracking(saved.get(characterKey) ?? EMPTY_ELITE_TRACKING, change, ELITE_LOCATIONS);
    saved.set(characterKey, current); return current;
  }) };
}
let scenes: EliteMarkerScene[] = [];
const scene = () => scenes.at(-1)!;
const ids = (markers: readonly EliteSceneMarker[]) => [...new Set(markers.map(marker => marker.locationId))];
async function planner(trackingHost = host(), catalogue = createSkillCatalogue(ELITE_FIXTURE_SKILLS)) {
  scenes = [];
  const wrapper = mount(EliteSkillsApp, { attachTo: document.body, props: {
    view: eliteFixtureView(), catalogue, catalogueVersion: 1,
    catalogueProblem: "", trackingHost, openWiki: vi.fn(), reloadSkills: vi.fn(),
    present: (next: EliteMarkerScene) => { scenes.push(next); }, setMissionMarkers: vi.fn(),
  } });
  await flushPromises();
  if (wrapper.find('.elite-map-trigger').exists()) await wrapper.get('.elite-map-trigger').trigger('click');
  await flushPromises();
  return wrapper;
}
type PlannerApi = { pointer(hit: EliteMapHit | null): void; activate(hit: EliteMapHit): void };
const api = (wrapper: Awaited<ReturnType<typeof planner>>) => wrapper.vm as unknown as PlannerApi;
const hitOn = (location: EliteLocation, surface: EliteMapHit["surface"] = "mission", nearby: readonly EliteLocation[] = [location]): EliteMapHit =>
  ({ surface, locationIds: [location.id], nearbyIds: nearby.map(entry => entry.id), x: 120, y: 140 });
function sceneOf(locations: readonly EliteLocation[], target: string | null = null): EliteSceneMarker[] {
  return locations.flatMap(location => location.points.map(([mapX, mapY], index) => ({ key: `${location.id}:${index}`, locationId: location.id,
    skillId: location.skillId, mapId: location.mapId, mapX, mapY, iconUrl: null, hovered: false, captured: false, position: null,
    emphasis: location.id === target ? "target" as const : "match" as const })));
}
const lissah = ELITE_LOCATIONS.find((entry) => entry.boss === "Lissah the Packleader")!;

describe("Elite Skills", () => {
  it("saves a drag once on release and cancels it when the map closes", async () => {
    const api = host();
    const wrapper = await planner(api);
    const grip = wrapper.get<HTMLElement>('.elite-panel-resize');
    grip.element.setPointerCapture = vi.fn();
    const before = vi.mocked(api.update).mock.calls.length;
    await grip.trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 500 });
    await grip.trigger('pointermove', { pointerId: 1, clientX: 50, clientY: 452 });
    expect(vi.mocked(api.update).mock.calls).toHaveLength(before);
    await grip.trigger('pointerup', { pointerId: 1 });
    await flushPromises();
    expect(vi.mocked(api.update).mock.calls).toHaveLength(before + 1);
    await grip.trigger('pointerdown', { pointerId: 2, clientX: 0, clientY: 500 });
    await grip.trigger('pointermove', { pointerId: 2, clientX: 0, clientY: 600 });
    await wrapper.setProps({ view: { ...eliteFixtureView(), world: null } });
    await flushPromises();
    expect(vi.mocked(api.update).mock.calls).toHaveLength(before + 1);
    wrapper.unmount();
  });
  it("resizes within map bounds and restores each character's height", async () => {
    const api = host();
    const wrapper = await planner(api);
    const view = eliteFixtureView();
    const maxHeight = Math.min(view.world!.box.height - 24, window.innerHeight - view.world!.box.top - 28);
    const height = () => Number.parseFloat(wrapper.get<HTMLElement>('.elite-panel').element.style.height);
    expect(height()).toBe(Math.min(maxHeight, Math.max(440, window.innerHeight * 0.8)));
    const grip = wrapper.get('[aria-label="Resize Elite Skills height"]');
    await grip.trigger('keydown', { key: 'ArrowUp', shiftKey: true });
    await flushPromises();
    const smaller = height();
    expect(smaller).toBeLessThan(maxHeight);
    expect((await api.get({ characterKey: view.characterKey! })).view.panelHeightRatio).toBe(smaller / window.innerHeight);
    await wrapper.get('[aria-label="Collapse Elite Skills"]').trigger('click');
    expect(wrapper.get<HTMLElement>('.elite-map-summary').element.style.height).toBe('');
    await wrapper.get('.elite-map-trigger').trigger('click');
    expect(height()).toBe(smaller);
    await wrapper.setProps({ view: eliteFixtureView(false, true) });
    await flushPromises();
    await wrapper.get('.elite-map-trigger').trigger('click');
    expect(height()).toBe(Math.min(maxHeight, Math.max(440, window.innerHeight * 0.8)));
    await wrapper.setProps({ view });
    await flushPromises();
    expect(height()).toBe(smaller);
    wrapper.unmount();
    const restarted = await planner(api);
    expect(Number.parseFloat(restarted.get<HTMLElement>('.elite-panel').element.style.height)).toBe(smaller);
    const nextGrip = restarted.get('[aria-label="Resize Elite Skills height"]');
    for (let index = 0; index < 20; index++) await nextGrip.trigger('keydown', { key: 'ArrowDown', shiftKey: true });
    expect(Number.parseFloat(restarted.get<HTMLElement>('.elite-panel').element.style.height)).toBe(maxHeight);
    restarted.unmount();
  });

  it("finds a skill through boss and area names, and carries the selected boss to the mission map", async () => {
    const wrapper = await planner();
    await wrapper.get('input[type="search"]').setValue("Lissah");
    expect(wrapper.findAll('.elite-result')).toHaveLength(1);
    expect(wrapper.get('.elite-result').text()).toContain('Eviscerate');
    await wrapper.get('.elite-result-main').trigger('click');
    const target = wrapper.findAll('.elite-location').find((entry) => entry.text().includes('Lissah'))!;
    await target.get('button').trigger('click');
    await flushPromises();
    expect(target.text()).toContain('✓ Target');
    expect(wrapper.get('.elite-current-target').text()).toContain('Target: Lissah the Packleader');
    await wrapper.setProps({ view: eliteFixtureView(true) });
    expect(wrapper.find('.elite-panel').exists()).toBe(false);
    // The Mission Map carries no planner controls; only the target is drawn.
    expect(wrapper.find('.elite-map-summary').exists()).toBe(false);
    expect(scene().mission.map(marker => [marker.locationId, marker.emphasis])).toEqual(lissah.points.map(() => [lissah.id, 'target']));
    api(wrapper).pointer(hitOn(lissah));
    await flushPromises();
    expect(wrapper.find('.elite-preview').exists()).toBe(true);
    expect(scene().mission.every(marker => marker.hovered)).toBe(true);
    await wrapper.setProps({ view: { ...eliteFixtureView(true), mission: null } });
    expect(wrapper.find('.elite-preview').exists()).toBe(false);
    expect(scene().mission).toEqual([]);
    const missionView = eliteFixtureView(true);
    await wrapper.setProps({ view: { ...missionView, mission: { box: missionView.mission!.box, transform: null } } });
    expect(scene().mission).toEqual([]);
    (wrapper.vm as unknown as { find(id: number): void }).find(lissah.skillId);
    await flushPromises();
    expect(wrapper.get('.elite-panel-footer').text()).toContain('Boss markers are unavailable in this area');
    await wrapper.setProps({ view: { ...eliteFixtureView(true), mapId: 55 } });
    expect(scene().mission).toEqual([]);
    expect(wrapper.get('.elite-panel-footer').text()).toContain('In Bjora Marches');
    wrapper.unmount();
  });
  it("adds a matching skill to the Hunt list without expanding it or choosing a target", async () => {
    const api = host();
    const wrapper = await planner(api);
    await wrapper.get('input[type="search"]').setValue('Hundred Blades');
    const markers = ids(scene().world);
    await wrapper.get('[aria-label="Add Hundred Blades to Hunt list"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.elite-result-main').attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('.elite-inline-detail').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Remove Hundred Blades from Hunt list"]').attributes('aria-pressed')).toBe('true');
    expect(ids(scene().world)).toEqual(markers);
    // The only uncaptured Hunt list boss becomes the target automatically; nothing is saved for it.
    expect(scene().world.every(marker => marker.emphasis === 'saved' || marker.emphasis === 'target')).toBe(true);
    expect(wrapper.get('.elite-current-target').text()).toContain('Chosen for you');
    const saved = await api.get({ characterKey: eliteFixtureView().characterKey! });
    expect(saved.skills).toContain(ELITE_FIXTURE_SKILLS.find(skill => skill.name === 'Hundred Blades')!.id);
    expect(saved.activeLocation).toBe(null);
    await wrapper.get('[aria-label="Remove Hundred Blades from Hunt list"]').trigger('click');
    await flushPromises();
    expect((await api.get({ characterKey: eliteFixtureView().characterKey! })).skills).toEqual([]);
    wrapper.unmount();
  });
  it("keeps one inline detail open while preserving filters and neighboring results", async () => {
    const wrapper = await planner();
    const count = wrapper.findAll('.elite-result').length;
    await wrapper.findAll('.elite-result-main')[0]!.trigger('click');
    expect(wrapper.findAll('.elite-inline-detail')).toHaveLength(1);
    expect(wrapper.findAll('.elite-result')).toHaveLength(count);
    expect(wrapper.get('input[type="search"]').isVisible()).toBe(true);
    await wrapper.findAll('.elite-result-main')[1]!.trigger('click');
    expect(wrapper.findAll('.elite-inline-detail')).toHaveLength(1);
    expect(wrapper.findAll('.elite-result-main')[0]!.attributes('aria-expanded')).toBe('false');
    expect(wrapper.findAll('.elite-result-main')[1]!.attributes('aria-expanded')).toBe('true');
    wrapper.unmount();
  });
  it("toggles professions freely, persists them, and returns to All when none remain", async () => {
    const api = host();
    let wrapper = await planner(api);
    const pressed = () => wrapper.findAll('.elite-profession[aria-pressed="true"]').map(button => button.attributes('aria-label'));
    const names = () => wrapper.findAll('.elite-result').map(row => row.text()).join(' ');
    expect(wrapper.findAll('.elite-profession img')).toHaveLength(10);
    expect(pressed()).toEqual([]);
    for (const name of ['Warrior', 'Ranger', 'Monk', 'Necromancer', 'Mesmer', 'Elementalist', 'Assassin', 'Ritualist', 'Paragon', 'Dervish']) {
      await wrapper.get(`.elite-profession[aria-label="${name}"]`).trigger('click');
      expect(pressed()).toEqual([name]);
      await wrapper.get(`.elite-profession[aria-label="${name}"]`).trigger('click');
      expect(pressed()).toEqual([]);
    }
    await wrapper.get('.elite-profession[aria-label="Warrior"]').trigger('click');
    await wrapper.get('.elite-profession[aria-label="Monk"]').trigger('click');
    expect(names()).toContain('Eviscerate'); expect(names()).toContain('Restore Condition'); expect(names()).not.toContain('Barrage');
    await flushPromises();
    wrapper.unmount();
    wrapper = await planner(api);
    expect(pressed()).toEqual(['Warrior', 'Monk']);
    await wrapper.findAll('.elite-quick-classes button').find(button => button.text() === 'All')!.trigger('click');
    expect(pressed()).toEqual([]);
    expect(names()).toContain('Barrage');
    wrapper.unmount();
  });
  it("filters by learned status and shows every skill while that status is unknown", async () => {
    const wrapper = await planner();
    const names = () => wrapper.findAll('.elite-result').map((entry) => entry.text()).join();
    const status = (label: string) => wrapper.findAll('.elite-learned button').find(button => button.text() === label)!;
    expect(status('Not learned').attributes('aria-pressed')).toBe('true');
    await wrapper.setProps({ view: eliteFixtureView(false, false, true) });
    expect(names()).not.toContain('Eviscerate');
    await status('Learned').trigger('click');
    expect(wrapper.findAll('.elite-result').map(entry => entry.find('strong').text())).toEqual(['Eviscerate']);
    expect(wrapper.find('[data-kind="captured"]').text()).toBe('✓ Captured');
    await status('Not learned').trigger('click');
    await wrapper.setProps({ view: { ...eliteFixtureView(), observation: { status: 'waiting' } } });
    expect(status('Not learned').attributes('disabled')).toBeDefined();
    expect(names()).toContain('Eviscerate');
    wrapper.unmount();
  });
  it("keeps unsaved changes visible and retries the intended action", async () => {
    const api = host();
    const update = vi.spyOn(api, 'update');
    const wrapper = await planner(api);
    await wrapper.get('input[type="search"]').setValue('Eviscerate');
    await flushPromises();
    update.mockRejectedValueOnce(new Error('disk full'));
    await wrapper.get('.elite-track-button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Changes are not saved');
    expect(wrapper.get('.elite-track-button').attributes('aria-pressed')).toBe('true');
    await wrapper.get('[role="alert"] .ui-button').trigger('click');
    await flushPromises();
    expect(wrapper.get('.elite-track-button').attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });
  it("withdraws missing coordinates rather than placing them at zero", async () => {
    const missing = ELITE_LOCATIONS.find((entry) => entry.boss === 'Reaper of Agony')!;
    expect(missing.points).toEqual([]);
    const wrapper = await planner(host(), createSkillCatalogue([...ELITE_FIXTURE_SKILLS,
      { ...ELITE_FIXTURE_SKILLS[0]!, id: skillId(missing.skillId), name: 'Missing position' }]));
    await wrapper.get('input[type="search"]').setValue('Missing position');
    expect(wrapper.findAll('.elite-result')).toHaveLength(1);
    expect(scene().world.some(marker => marker.locationId === missing.id)).toBe(false);
    wrapper.unmount();
    const view = eliteFixtureView(true);
    const placed = placeEliteMarkers(sceneOf([lissah], lissah.id), { ...view.mission!, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } });
    expect(placed[0]?.outside).toBe(true);
    expect(placed[0]!.x).toBeLessThan(view.mission!.box.width);
  });
  it("deduplicates touching copies and preserves the active boss position", () => {
    const surface = { box: { left: 0, top: 0, width: 400, height: 300 },
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
    const locations = [
      { ...lissah, id: 'a', points: [[35, 80], [36, 80]] as const },
      { ...lissah, id: 'b', points: [[37, 80]] as const },
    ];
    const markers = placeEliteMarkers(sceneOf(locations, 'b'), surface);
    expect(markers.map(marker => [marker.marker.key, marker.x, marker.marker.locationId])).toEqual([['b:0', 37, 'b']]);
    expect(markers[0]!.locationIds).toEqual(['a', 'b']);
    expect(markers[0]!.marker.emphasis).toBe('target');
  });
  it("maintains keyboard focus through opening, inline details, and collapse", async () => {
    const wrapper = await planner();
    expect(document.activeElement).toBe(wrapper.get('input[type="search"]').element);
    await wrapper.get('input[type="search"]').setValue('Eviscerate');
    const row = wrapper.get('.elite-result-main');
    (row.element as HTMLButtonElement).focus();
    await row.trigger('click', { detail: 0 });
    expect(wrapper.get('.elite-result-main').attributes('aria-expanded')).toBe('true');
    await wrapper.get('.elite-result-main').trigger('click', { detail: 0 });
    expect(document.activeElement).toBe(wrapper.get('.elite-result-main').element);
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('Eviscerate');
    await wrapper.get('[aria-label="Collapse Elite Skills"]').trigger('click', { detail: 0 });
    expect(document.activeElement).toBe(wrapper.get('.elite-map-trigger').element);
    wrapper.unmount();
  });
  it("ignores an old character's pending load and save after switching characters", async () => {
    const character = ref<TravelCharacterKey | null>(travelCharacterKey('0123456789abcdef'));
    let resolveLoad!: (value: EliteTracking) => void;
    let resolveSave!: (value: EliteTracking) => void;
    const api: EliteTrackingHost = { get: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; })).mockResolvedValue(EMPTY_ELITE_TRACKING),
      update: () => new Promise((resolve) => { resolveSave = resolve; }) };
    const controller = useEliteTracking(character, api);
    character.value = travelCharacterKey('fedcba9876543210');
    await flushPromises();
    resolveLoad({ ...EMPTY_ELITE_TRACKING, skills: [338], activeLocation: lissah.id });
    await flushPromises();
    expect(controller.tracking.value.skills).toEqual([]);
    void controller.change({ kind: 'track', skillId: 338 });
    character.value = null;
    await flushPromises();
    resolveSave({ ...EMPTY_ELITE_TRACKING, skills: [338], activeLocation: lissah.id });
    await flushPromises();
    expect(controller.tracking.value.skills).toEqual([]);
    expect(controller.loaded.value).toBe(false);
    controller.dispose();
  });
});


describe("elite map preferences", () => {
  it("keeps the same markers through inline details and collapse without losing list position", async () => {
    const wrapper = await planner();
    const markers = () => ids(scene().world);
    const original = markers();
    expect(original.length).toBeGreaterThan(1);
    wrapper.get<HTMLElement>('.elite-panel-content').element.scrollTop = 177;
    await wrapper.get('.elite-result-main').trigger('click');
    expect(markers()).toEqual(original);
    await wrapper.get('.elite-result-main').trigger('click');
    expect(wrapper.get<HTMLElement>('.elite-panel-content').element.scrollTop).toBe(177);
    await wrapper.get('[aria-label="Collapse Elite Skills"]').trigger('click');
    expect(markers()).toEqual(original);
    expect(wrapper.find('.elite-map-trigger').exists()).toBe(true);
    wrapper.unmount();
  });
  it("restores Hundred Blades and panel preference after restart and native map closure", async () => {
    const api = host();
    let wrapper = await planner(api);
    await wrapper.get('input[type="search"]').setValue('Hundred Blades');
    await flushPromises();
    await wrapper.setProps({ view: { ...eliteFixtureView(), world: null } });
    expect(wrapper.find('.elite-panel').exists()).toBe(false);
    await wrapper.setProps({ view: eliteFixtureView() });
    expect(wrapper.find('.elite-panel').exists()).toBe(true);
    wrapper.unmount();
    wrapper = await planner(api);
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('Hundred Blades');
    expect(wrapper.findAll('.elite-result')).toHaveLength(1);
    await wrapper.get('[aria-label="Collapse Elite Skills"]').trigger('click');
    await flushPromises();
    wrapper.unmount();
    const saved = await api.get({ characterKey: eliteFixtureView().characterKey! });
    expect(saved.view.panelOpen).toBe(false);
    wrapper = mount(EliteSkillsApp, { props: { view: eliteFixtureView(), catalogue: createSkillCatalogue(ELITE_FIXTURE_SKILLS),
      catalogueVersion: 1, catalogueProblem: '', trackingHost: api, openWiki: vi.fn(), reloadSkills: vi.fn() } });
    await flushPromises();
    expect(wrapper.find('.elite-panel').exists()).toBe(false);
    await wrapper.get('.elite-map-trigger').trigger('click');
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('Hundred Blades');
    await wrapper.findAll('button').find(button => button.text() === 'Clear filters')!.trigger('click');
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('');
    wrapper.unmount();
  });
  it("follows both live professions only in Mine mode", async () => {
    const wrapper = await planner();
    const names = () => wrapper.findAll('.elite-result').map(row => row.text()).join(' ');
    const quick = (label: string) => wrapper.findAll('.elite-quick-classes button').find(button => button.text() === label)!;
    await quick('Mine').trigger('click');
    expect(names()).toContain('Barrage');
    expect(names()).toContain('Eviscerate');
    expect(names()).not.toContain('Restore Condition');
    await wrapper.setProps({ view: eliteFixtureView(false, false, false, 3) });
    expect(names()).not.toContain('Barrage');
    expect(names()).toContain('Restore Condition');
    await wrapper.get('.elite-profession[aria-label="Monk"]').trigger('click');
    await wrapper.get('.elite-profession[aria-label="Ranger"]').trigger('click');
    expect(names()).toContain('Barrage');
    expect(names()).not.toContain('Restore Condition');
    await wrapper.setProps({ view: { ...eliteFixtureView(), observation: { status: 'waiting' } } });
    expect(names()).toContain('Barrage');
    await quick('Mine').trigger('click');
    expect(wrapper.findAll('.elite-result')).toHaveLength(0);
    expect(wrapper.text()).toContain('Your professions are unavailable');
    wrapper.unmount();
  });
  it("shows the Hunt list or everything on the Mission Map, and nothing when off", async () => {
    const wrapper = await planner();
    await wrapper.get('input[type="search"]').setValue('Lissah');
    const mission = (mode: "off" | "saved" | "all") => wrapper.setProps({ view: eliteFixtureView(true, false, false, 2, mode) });
    await mission('saved');
    expect(scene().mission).toEqual([]);
    await mission('all');
    expect(ids(scene().mission)).toEqual([lissah.id]);
    expect(scene().mission.every(marker => marker.emphasis === 'match')).toBe(true);
    expect(scene().mission.map(marker => marker.position)).toEqual(lissah.points.length > 1 ? lissah.points.map((_, index) => `${index + 1}/${lissah.points.length}`) : [null]);
    await wrapper.setProps({ view: eliteFixtureView() });
    await wrapper.get('input[type="search"]').setValue('Hundred Blades');
    await mission('all');
    expect(scene().mission).toEqual([]);
    const plan = host();
    wrapper.unmount();
    const hunting = await planner(plan);
    await hunting.get('input[type="search"]').setValue('Eviscerate');
    await hunting.get('[aria-label="Add Eviscerate to Hunt list"]').trigger('click');
    await flushPromises();
    await hunting.get('input[type="search"]').setValue('Hundred Blades');
    await hunting.setProps({ view: eliteFixtureView(true, false, false, 2, 'saved') });
    // The Hunt list stays on the Mission Map even when planner filters hide it; its boss is the target.
    expect(ids(scene().mission)).toEqual([lissah.id]);
    expect(scene().mission.every(marker => marker.emphasis === 'target')).toBe(true);
    await hunting.setProps({ view: eliteFixtureView(true, false, false, 2, 'off') });
    expect(scene().mission).toEqual([]);
    hunting.unmount();
  });
  it("changes the Mission Map mode through the host setting", async () => {
    const wrapper = await planner();
    const buttons = wrapper.findAll('.elite-mission-markers button');
    expect(buttons.map(button => button.text())).toEqual(['Hunt list', 'All', 'Off']);
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true');
    await buttons[1]!.trigger('click');
    expect(wrapper.props('setMissionMarkers')).toHaveBeenCalledWith('all');
    wrapper.unmount();
  });
  it("isolates search and marker visibility between characters", async () => {
    const api = host();
    const wrapper = await planner(api);
    await wrapper.get('input[type="search"]').setValue('Hundred Blades');
    await wrapper.findAll('.elite-panel-footer label').find(label => label.text() === 'World Map markers')!.get('input').setValue(false);
    await flushPromises();
    await wrapper.setProps({ view: eliteFixtureView(false, true) });
    await flushPromises();
    expect(scene().world.length).toBeGreaterThan(0);
    await wrapper.setProps({ view: eliteFixtureView() });
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('Hundred Blades');
    expect(scene().world).toHaveLength(0);
    wrapper.unmount();
  });
  it("only focuses a skill through an explicit action", async () => {
    const wrapper = await planner();
    const count = scene().world.length;
    await wrapper.get('.elite-result-main').trigger('click');
    expect(scene().world).toHaveLength(count);
    await wrapper.findAll('button').find(button => button.text() === 'Show only this skill')!.trigger('click');
    await wrapper.get('.elite-result-main').trigger('click');
    expect(wrapper.findAll('.elite-result')).toHaveLength(1);
    expect(wrapper.text()).toContain('Clear skill focus');
    wrapper.unmount();
  });
  it("finishes rapid edits for the correct character while a save is pending", async () => {
    const character = ref<TravelCharacterKey | null>(travelCharacterKey('0123456789abcdef'));
    const api = host();
    const update = api.update;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    api.update = vi.fn(async value => { await gate; return update(value); });
    const plan = useEliteTracking(character, api);
    await flushPromises();
    for (const search of ['H', 'Hundred', 'Hundred Blades']) plan.change({ kind: 'view', view: { ...plan.tracking.value.view, search } });
    plan.change({ kind: 'track', skillId: 338 });
    expect(plan.tracking.value.view.search).toBe('Hundred Blades');
    character.value = travelCharacterKey('fedcba9876543210');
    await flushPromises();
    release();
    await flushPromises();
    expect(plan.tracking.value.view.search).toBe('');
    expect(plan.tracking.value.skills).toEqual([]);
    const old = await api.get({ characterKey: '0123456789abcdef' });
    expect(old.view.search).toBe('Hundred Blades');
    expect(old.skills).toEqual([338]);
    plan.dispose();
  });
  it("waits for queued edits when returning to a character before its save completes", async () => {
    const key = travelCharacterKey('0123456789abcdef');
    const character = ref<TravelCharacterKey | null>(key);
    const api = host();
    const update = api.update;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    api.update = async value => { await gate; return update(value); };
    const plan = useEliteTracking(character, api);
    await flushPromises();
    plan.change({ kind: 'view', view: { ...plan.tracking.value.view, search: 'H' } });
    plan.change({ kind: 'view', view: { ...plan.tracking.value.view, search: 'Hundred Blades' } });
    character.value = travelCharacterKey('fedcba9876543210');
    await flushPromises();
    character.value = key;
    await flushPromises();
    expect(plan.loaded.value).toBe(false);
    release();
    await flushPromises();
    expect(plan.tracking.value.view.search).toBe('Hundred Blades');
    expect(plan.loaded.value).toBe(true);
    plan.dispose();
  });

});


describe("elite hover previews", () => {
  it("allows crossing onto a preview and removes it immediately when the map closes", async () => {
    const wrapper = await planner();
    vi.useFakeTimers();
    try {
      const row = wrapper.get('.elite-result-main');
      await row.trigger('pointerenter');
      expect(wrapper.get('[role="tooltip"]').attributes('id')).toBe(row.attributes('aria-describedby'));
      await row.trigger('pointerleave');
      await wrapper.get('[role="tooltip"]').trigger('pointerenter');
      await vi.advanceTimersByTimeAsync(150);
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);
      await wrapper.setProps({ view: { ...eliteFixtureView(), world: null } });
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(150);
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it("opens keyboard previews without motion and lets Escape dismiss them", async () => {
    const wrapper = await planner();
    const row = wrapper.get('.elite-result-main');
    await row.trigger('focus');
    expect(wrapper.get('[role="tooltip"]').attributes('data-keyboard')).toBe('');
    await row.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    expect(wrapper.find('.elite-panel').exists()).toBe(true);
    wrapper.unmount();
  });
});


describe("overlapping elite markers", () => {
  it("deduplicates the real Sorrow's Furnace row without hiding another area or distant spawn", () => {
    const row = ELITE_LOCATIONS.filter(location => location.mapId === 190);
    const surface = { box: { left: 0, top: 0, width: 800, height: 600 }, transform: { a: 1, b: 0, c: 0, d: 1, e: -4800, f: -5200 } };
    const marks = placeEliteMarkers(sceneOf(row), surface);
    expect(marks).toHaveLength(6);
    const anguish = marks.find(marker => marker.marker.skillId === 54)!;
    const bosses = anguish.locationIds.map(id => row.find(location => location.id === id)!.boss).sort();
    expect(bosses).toEqual(['Garbok Handsmasher', 'Hierophant Morlog', 'Korvald Willcrusher', 'Vokur Grimshackles']);
    const source = row.find(location => location.id === anguish.marker.locationId)!;
    const otherArea = { ...source, id: 'other-area', mapId: 100 };
    const distant = { ...source, id: 'distant', points: [[5300, 5500]] as const };
    expect(placeEliteMarkers(sceneOf([...row, otherArea, distant]), surface)).toHaveLength(8);
  });
  it("finds the topmost marker and every nearby location under a point", () => {
    const surface = { box: { left: 0, top: 0, width: 400, height: 300 }, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
    const a = { ...lissah, id: 'a', points: [[80, 80], [81, 80]] as const };
    const b = { ...lissah, id: 'b', points: [[80, 80]] as const };
    const far = { ...lissah, id: 'far', points: [[180, 80]] as const };
    const placed = placeEliteMarkers(sceneOf([a, b, far]), surface);
    expect(placed).toHaveLength(2);
    expect(eliteMarkerAt(placed, 84, 82)).toMatchObject({ marker: { locationIds: ['a', 'b'] }, nearbyIds: ['a', 'b'] });
    expect(eliteMarkerAt(placed, 130, 80)).toBeNull();
  });
  it("keeps overlapping choices reachable, changes the preview, and opens details without filtering", async () => {
    const wrapper = await planner();
    await wrapper.get('[aria-label="Collapse Elite Skills"]').trigger('click');
    const crowded = { ...eliteFixtureView().world!, transform: { a: 0.001, b: 0, c: 0, d: 0.001, e: 100, f: 100 } };
    const placed = placeEliteMarkers(scene().world, crowded);
    const first = eliteMarkerAt(placed, placed[0]!.x, placed[0]!.y)!;
    const original = ids(scene().world);
    api(wrapper).pointer({ surface: 'world', locationIds: first.marker.locationIds, nearbyIds: first.nearbyIds, x: 100, y: 100 });
    await flushPromises();
    expect(wrapper.get('.elite-preview').attributes('role')).toBe('region');
    const choices = wrapper.findAll('.elite-nearby-choice');
    expect(choices.length).toBeGreaterThan(1);
    expect(new Set(choices.map(choice => choice.attributes('aria-label')!.split(' —')[0])).size).toBe(choices.length);
    const barrage = choices.find(choice => choice.attributes('aria-label')!.startsWith('Barrage —'))!;
    vi.useFakeTimers();
    try {
      await wrapper.get('.elite-preview').trigger('pointerenter');
      // Crossing onto the preview leaves the drawn marker; the host then reports no hit.
      api(wrapper).pointer(null);
      await barrage.trigger('pointerenter');
      await vi.advanceTimersByTimeAsync(150);
      expect(wrapper.get('.elite-preview .inspector-identity strong').text()).toBe('Barrage');
      const boss = barrage.attributes('aria-label')!.split('— ')[1]!.split(' ·')[0]!;
      expect(wrapper.get('.elite-preview-where').text()).toContain(boss);
      expect(ids(scene().world)).toEqual(original);
      await barrage.trigger('click');
      expect(wrapper.find('.elite-preview').exists()).toBe(false);
      expect(wrapper.get('.elite-panel .inspector-identity strong').text()).toBe('Barrage');
      expect(ids(scene().world)).toEqual(original);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
});

describe("marker activation", () => {
  it("pins a small action card on a marker click and targets without opening the planner", async () => {
    const plan = host();
    const wrapper = await planner(plan);
    await wrapper.get('[aria-label="Collapse Elite Skills"]').trigger('click');
    await wrapper.setProps({ view: eliteFixtureView(true, false, false, 2, 'all') });
    api(wrapper).activate(hitOn(lissah));
    await flushPromises();
    expect(wrapper.find('.elite-panel').exists()).toBe(false);
    expect(wrapper.get('.elite-preview').attributes('aria-label')).toBe('Eviscerate capture location');
    // A pinned card ignores later pointer reports until it is closed.
    api(wrapper).pointer(null);
    await flushPromises();
    await wrapper.findAll('.elite-preview-actions button').find(button => button.text() === 'Set as target')!.trigger('click');
    await flushPromises();
    expect((await plan.get({ characterKey: eliteFixtureView().characterKey! })).activeLocation).toBe(lissah.id);
    expect(wrapper.get('.elite-preview-actions').text()).toContain('✓ Target');
    expect(wrapper.get('.elite-preview-actions').text()).toContain('★ Hunting');
    expect(wrapper.get('.elite-preview-where').text()).toContain('◆ Target');
    expect(scene().mission.every(marker => marker.emphasis === 'target')).toBe(true);
    await wrapper.get('[aria-label="Close capture details"]').trigger('click');
    expect(wrapper.find('.elite-preview').exists()).toBe(false);
    api(wrapper).activate(hitOn(lissah));
    await flushPromises();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(wrapper.find('.elite-preview').exists()).toBe(false);
    wrapper.unmount();
  });
  it("opens the details in an open planner instead of pinning a card", async () => {
    const wrapper = await planner();
    api(wrapper).activate(hitOn(lissah, 'world'));
    await flushPromises();
    expect(wrapper.find('.elite-preview').exists()).toBe(false);
    expect(wrapper.get('.elite-panel .inspector-identity strong').text()).toBe('Eviscerate');
    wrapper.unmount();
  });
});

describe("elite map pointer", () => {
  const surface = { box: { left: 10, top: 20, width: 400, height: 300 }, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
  const placed = placeEliteMarkers(sceneOf([{ ...lissah, id: 'a', points: [[100, 100]] as const }]), surface);
  function install(owns: () => boolean) {
    const game = document.createElement('canvas'); document.body.append(game);
    const hover = vi.fn(); const activate = vi.fn(); const reached = vi.fn();
    game.addEventListener('pointerdown', reached); game.addEventListener('pointermove', reached);
    const pointer = installEliteMapPointer({ view: window, accepts: target => target === game,
      surfaces: () => [{ name: 'mission', box: surface.box, placed, ownsPointer: owns }], hover, activate });
    const send = (type: string, x: number, y: number) => {
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, isPrimary: true });
      game.dispatchEvent(event); return event;
    };
    return { game, hover, activate, reached, pointer, send };
  }
  it("lets every move reach the game and claims only a press on a marker the map owns", () => {
    const { game, hover, activate, reached, pointer, send } = install(() => true);
    send('pointermove', 110, 120);
    expect(hover).toHaveBeenLastCalledWith(expect.objectContaining({ surface: 'mission', locationIds: ['a'], x: 110, y: 120 }));
    expect(reached).toHaveBeenCalledTimes(1);
    const press = send('pointerdown', 110, 120);
    expect(press.defaultPrevented).toBe(true);
    expect(reached).toHaveBeenCalledTimes(1);
    send('pointerup', 110, 120);
    expect(activate).toHaveBeenCalledTimes(1);
    send('pointermove', 300, 300);
    expect(hover).toHaveBeenLastCalledWith(null);
    expect(send('pointerdown', 300, 300).defaultPrevented).toBe(false);
    expect(reached).toHaveBeenCalledTimes(3);
    pointer.dispose(); game.remove();
  });
  it("never carries a claimed press past a lost window", () => {
    const { game, activate, pointer, send } = install(() => true);
    send('pointermove', 110, 120);
    expect(send('pointerdown', 110, 120).defaultPrevented).toBe(true);
    window.dispatchEvent(new Event('blur'));
    const ui = document.createElement('button'); document.body.append(ui);
    const release = new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, isPrimary: true });
    const reached = vi.fn(); ui.addEventListener('pointerup', reached); ui.dispatchEvent(release);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
    pointer.dispose(); game.remove(); ui.remove();
  });
  it("leaves a covered marker to the game panel above it", () => {
    const { game, hover, activate, reached, pointer, send } = install(() => false);
    send('pointermove', 110, 120);
    expect(hover).not.toHaveBeenCalled();
    expect(send('pointerdown', 110, 120).defaultPrevented).toBe(false);
    send('pointerup', 110, 120);
    expect(activate).not.toHaveBeenCalled();
    expect(reached).toHaveBeenCalledTimes(2);
    pointer.dispose(); game.remove();
  });
});

describe("hunting", () => {
  it("targets the Hunt list boss in this area, then moves on and announces a capture", async () => {
    const plan = host();
    const key = eliteFixtureView().characterKey!;
    const barrage = ELITE_FIXTURE_SKILLS.find(skill => skill.name === 'Barrage')!;
    await plan.update({ characterKey: key, change: { kind: 'track', skillId: barrage.id } });
    await plan.update({ characterKey: key, change: { kind: 'track', skillId: lissah.skillId } });
    const wrapper = await planner(plan);
    // Eviscerate was added second, but its boss is in this area.
    expect(wrapper.get('.elite-current-target').text()).toContain('Target: Lissah the Packleader');
    expect(wrapper.get('.elite-current-target').text()).toContain('Chosen for you · In this area.');
    await wrapper.findAll('.elite-view-switch button').find(button => button.text().startsWith('Hunt list'))!.trigger('click');
    expect(wrapper.findAll('.elite-result').map(row => row.find('strong').text())).toEqual(['Barrage', 'Eviscerate']);
    await wrapper.setProps({ view: eliteFixtureView(false, false, true) });
    await flushPromises();
    expect(wrapper.get('.elite-notice').text()).toContain('✓ Eviscerate captured');
    expect(wrapper.get('.elite-notice').text()).toContain('1 of 2 on your Hunt list');
    expect(wrapper.get('.elite-current-target').text()).not.toContain('Lissah');
    expect(wrapper.get('.elite-view-switch').text()).toContain('1/2');
    expect(wrapper.findAll('.elite-section-title').map(title => title.text())).toEqual(['Captured · 1']);
    expect(scene().world.filter(marker => marker.locationId === lissah.id).every(marker => marker.captured)).toBe(true);
    await wrapper.findAll('button').find(button => button.text() === 'Remove captured from Hunt list')!.trigger('click');
    await flushPromises();
    expect((await plan.get({ characterKey: key })).skills).toEqual([barrage.id]);
    wrapper.unmount();
  });
});

describe("spawn positions", () => {
  it("joins one boss's positions by the shortest links, only while hovered or targeted", () => {
    const at = (key: string, x: number, y: number, extra: Partial<EliteSceneMarker> = {}): EliteSceneMarker => ({ key, locationId: "boss", skillId: 1, mapId: 1,
      mapX: x, mapY: y, iconUrl: null, emphasis: "match", hovered: false, captured: false, position: null, ...extra });
    expect(eliteSpawnLinks([at("a", 0, 0), at("b", 10, 0)])).toEqual([]);
    const links = eliteSpawnLinks([at("a", 0, 0, { hovered: true }), at("c", 100, 0, { hovered: true }), at("b", 50, 0, { hovered: true })]);
    expect(links.map(link => [link.from[0], link.to[0]])).toEqual([[0, 50], [50, 100]]);
    expect(eliteSpawnLinks([at("a", 0, 0, { emphasis: "target" }), at("b", 0, 30, { emphasis: "target" })])[0]).toMatchObject({ hovered: false });
  });
  it("grows markers with the game's zoom in tenths and never beyond 1.8×", () => {
    expect([0, 0.5, 1, 7, Number.NaN].map(eliteZoomGrowth)).toEqual([1, 1.4, 1.8, 1.8, 1]);
  });
  it("labels positions of the hovered boss and the target on the World Map only", async () => {
    const wrapper = await planner();
    await wrapper.get('input[type="search"]').setValue('Lissah');
    expect(scene().world.every(marker => marker.position === null)).toBe(true);
    api(wrapper).pointer(hitOn(lissah, 'world'));
    await flushPromises();
    const hovered = scene().world.filter(marker => marker.locationId === lissah.id);
    expect(hovered.map(marker => marker.position)).toEqual(lissah.points.length > 1 ? lissah.points.map((_, index) => `${index + 1}/${lissah.points.length}`) : [null]);
    wrapper.unmount();
  });
});
