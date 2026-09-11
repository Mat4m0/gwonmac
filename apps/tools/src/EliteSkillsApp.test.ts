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
import { eliteMarkers } from "./elite-map-markers";

function host(): EliteTrackingHost {
  const saved = new Map<string, EliteTracking>();
  return { get: vi.fn(async ({ characterKey }) => saved.get(characterKey) ?? EMPTY_ELITE_TRACKING), update: vi.fn(async ({ characterKey, change }) => {
    const current = changeEliteTracking(saved.get(characterKey) ?? EMPTY_ELITE_TRACKING, change, ELITE_LOCATIONS);
    saved.set(characterKey, current); return current;
  }) };
}
async function planner(trackingHost = host()) {
  const wrapper = mount(EliteSkillsApp, { attachTo: document.body, props: {
    view: eliteFixtureView(), catalogue: createSkillCatalogue(ELITE_FIXTURE_SKILLS), catalogueVersion: 1,
    catalogueProblem: "", trackingHost, openWiki: vi.fn(), reloadSkills: vi.fn(),
  } });
  await flushPromises();
  if (wrapper.find('.elite-map-trigger').exists()) await wrapper.get('.elite-map-trigger').trigger('click');
  await flushPromises();
  return wrapper;
}
const lissah = ELITE_LOCATIONS.find((entry) => entry.boss === "Lissah the Packleader")!;

describe("Elite Skills", () => {
  it("finds a skill through boss and area names, and carries the selected boss to the mission map", async () => {
    const wrapper = await planner();
    await wrapper.get('input[type="search"]').setValue("Lissah");
    expect(wrapper.findAll('.elite-result')).toHaveLength(1);
    expect(wrapper.get('.elite-result').text()).toContain('Eviscerate');
    await wrapper.get('.elite-result-main').trigger('click');
    const target = wrapper.findAll('.elite-location').find((entry) => entry.text().includes('Lissah'))!;
    await target.get('button').trigger('click');
    await flushPromises();
    expect(target.text()).toContain('Tracking this boss');
    await wrapper.setProps({ view: eliteFixtureView(true) });
    expect(wrapper.find('.elite-panel').exists()).toBe(false);
    expect(wrapper.get('.elite-map-trigger').attributes('title')).toContain('Lissah');
    expect(wrapper.findAll('.elite-marker')).toHaveLength(1);
    await wrapper.get('.elite-marker').trigger('pointerenter');
    expect(wrapper.find('.elite-preview').exists()).toBe(true);
    await wrapper.setProps({ view: { ...eliteFixtureView(true), mission: null } });
    expect(wrapper.find('.elite-preview').exists()).toBe(false);
    expect(wrapper.find('.elite-marker').exists()).toBe(false);
    expect(wrapper.find('.elite-map-summary').exists()).toBe(false);
    const missionView = eliteFixtureView(true);
    await wrapper.setProps({ view: { ...missionView, mission: { box: missionView.mission!.box, transform: null } } });
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    expect(wrapper.get('.elite-map-trigger').attributes('title')).toContain('Boss markers are unavailable in this area');
    await wrapper.setProps({ view: { ...eliteFixtureView(true), mapId: 55 } });
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    expect(wrapper.get('.elite-map-trigger').attributes('title')).toContain('Target is in Bjora Marches');
    wrapper.unmount();
  });
  it("keeps unknown skills visible and uses character learned status", async () => {
    const wrapper = await planner();
    expect(wrapper.text()).not.toContain('Learned status unavailable');
    await wrapper.setProps({ view: eliteFixtureView(false, false, true) });
    expect(wrapper.findAll('.elite-result').map((entry) => entry.text()).join()).not.toContain('Eviscerate');
    await wrapper.setProps({ view: { ...eliteFixtureView(), observation: { status: 'waiting' } } });
    expect(wrapper.text()).toContain('Learned status unavailable');
    expect(wrapper.findAll('.elite-result').map((entry) => entry.text()).join()).toContain('Eviscerate');
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
    const view = eliteFixtureView(true);
    expect(eliteMarkers([missing], { box: view.mission!.box, transform: view.mission!.transform! }, missing.id)).toEqual([]);
    const markers = eliteMarkers([lissah], { ...view.mission!, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }, lissah.id);
    expect(markers[0]?.outside).toBe(true);
    expect(markers[0]!.x).toBeLessThan(view.mission!.box.width);
  });
  it("keeps nearby and alternate positions as individual skill markers", () => {
    const surface = { box: { left: 0, top: 0, width: 400, height: 300 },
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
    const locations = [
      { ...lissah, id: 'a', points: [[35, 80], [36, 80]] as const },
      { ...lissah, id: 'b', points: [[37, 80]] as const },
    ];
    const markers = eliteMarkers(locations, surface, 'b');
    expect(markers.map(marker => [marker.key, marker.x, marker.location.id])).toEqual([
      ['a:0', 35, 'a'], ['a:1', 36, 'a'], ['b:0', 37, 'b'],
    ]);
    expect(markers.filter(marker => marker.active).map(marker => marker.location.id)).toEqual(['b']);
  });
  it("maintains keyboard focus through opening, details, back, and collapse", async () => {
    const wrapper = await planner();
    expect(document.activeElement).toBe(wrapper.get('input[type="search"]').element);
    await wrapper.get('input[type="search"]').setValue('Eviscerate');
    const row = wrapper.get('.elite-result-main');
    await row.trigger('click', { detail: 0 });
    expect(document.activeElement).toBe(wrapper.get('.elite-back').element);
    await wrapper.get('.elite-back').trigger('click', { detail: 0 });
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
    resolveLoad({ ...EMPTY_ELITE_TRACKING, skills: [338], activeLocation: lissah.id, missionMap: true });
    await flushPromises();
    expect(controller.tracking.value.skills).toEqual([]);
    void controller.change({ kind: 'track', skillId: 338 });
    character.value = null;
    await flushPromises();
    resolveSave({ ...EMPTY_ELITE_TRACKING, skills: [338], activeLocation: lissah.id, missionMap: true });
    await flushPromises();
    expect(controller.tracking.value.skills).toEqual([]);
    expect(controller.loaded.value).toBe(false);
    controller.dispose();
  });
});


describe("elite map preferences", () => {
  it("keeps the same markers through details, back and collapse, and restores list position", async () => {
    const wrapper = await planner();
    const markers = () => wrapper.findAll('.elite-marker').map(marker => marker.attributes('aria-label'));
    const original = markers();
    expect(original.length).toBeGreaterThan(1);
    wrapper.get<HTMLElement>('.elite-panel-content').element.scrollTop = 177;
    await wrapper.get('.elite-result-main').trigger('click');
    expect(markers()).toEqual(original);
    await wrapper.get('.elite-back').trigger('click');
    expect(wrapper.get<HTMLElement>('.elite-panel-content').element.scrollTop).toBe(177);
    await wrapper.get('[aria-label="Collapse Elite Skills"]').trigger('click');
    expect(markers()).toEqual(original);
    expect(wrapper.get('.elite-map-trigger').attributes('title')).toContain('All professions');
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
    expect(wrapper.get('.elite-map-trigger').attributes('title')).toContain('Hundred Blades');
    await wrapper.get('.elite-map-trigger').trigger('click');
    await wrapper.findAll('button').find(button => button.text() === 'Clear search')!.trigger('click');
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('');
    wrapper.unmount();
  });
  it("follows both live professions only in My professions mode", async () => {
    const wrapper = await planner();
    const names = () => wrapper.findAll('.elite-result').map(row => row.text()).join(' ');
    await wrapper.findAll('button').find(button => button.text() === 'My professions')!.trigger('click');
    expect(names()).toContain('Barrage');
    expect(names()).toContain('Eviscerate');
    expect(names()).not.toContain('Restore Condition');
    await wrapper.setProps({ view: eliteFixtureView(false, false, false, 3) });
    expect(names()).not.toContain('Barrage');
    expect(names()).toContain('Restore Condition');
    await wrapper.findAll('button').find(button => button.text() === 'Choose…')!.trigger('click');
    const choices = wrapper.findAll('.elite-profession-choices label');
    await choices.find(label => label.text() === 'Warrior')!.get('input').setValue(true);
    await choices.find(label => label.text() === 'Ranger')!.get('input').setValue(true);
    expect(names()).toContain('Barrage');
    expect(names()).not.toContain('Restore Condition');
    await wrapper.setProps({ view: { ...eliteFixtureView(), observation: { status: 'waiting' } } });
    expect(names()).toContain('Barrage');
    await wrapper.findAll('button').find(button => button.text() === 'My professions')!.trigger('click');
    expect(wrapper.findAll('.elite-result')).toHaveLength(0);
    expect(wrapper.text()).toContain('Your professions are unavailable');
    wrapper.unmount();
  });
  it("shares filters with untracked mission markers and applies the mission visibility switch", async () => {
    const wrapper = await planner();
    await wrapper.get('input[type="search"]').setValue('Lissah');
    await wrapper.setProps({ view: eliteFixtureView(true) });
    expect(wrapper.findAll('.elite-marker')).toHaveLength(1);
    await wrapper.get('.elite-map-summary input').setValue(false);
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    await wrapper.get('.elite-map-summary input').setValue(true);
    await wrapper.get('.elite-map-trigger').trigger('click');
    await wrapper.get('input[type="search"]').setValue('Hundred Blades');
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    wrapper.unmount();
  });
  it("isolates search and marker visibility between characters", async () => {
    const api = host();
    const wrapper = await planner(api);
    await wrapper.get('input[type="search"]').setValue('Hundred Blades');
    await wrapper.findAll('.elite-panel-footer label').find(label => label.text() === 'Show world map markers')!.get('input').setValue(false);
    await flushPromises();
    await wrapper.setProps({ view: eliteFixtureView(false, true) });
    await flushPromises();
    expect(wrapper.get('.elite-map-trigger').attributes('title')).not.toContain('Hundred Blades');
    expect(wrapper.findAll('.elite-marker').length).toBeGreaterThan(0);
    await wrapper.setProps({ view: eliteFixtureView() });
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('Hundred Blades');
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    wrapper.unmount();
  });
  it("only focuses a skill through an explicit action", async () => {
    const wrapper = await planner();
    const count = wrapper.findAll('.elite-marker').length;
    await wrapper.get('.elite-result-main').trigger('click');
    expect(wrapper.findAll('.elite-marker')).toHaveLength(count);
    await wrapper.findAll('button').find(button => button.text() === 'Show only this skill')!.trigger('click');
    await wrapper.get('.elite-back').trigger('click');
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
