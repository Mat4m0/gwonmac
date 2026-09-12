import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import EliteMarkers from "./components/EliteMarkers.vue";
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
    expect(target.text()).toContain('Current target');
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
  it("saves a matching skill directly without expanding it or changing the target", async () => {
    const api = host();
    const wrapper = await planner(api);
    await wrapper.get('input[type="search"]').setValue('Hundred Blades');
    const markers = wrapper.findAll('.elite-marker').map(marker => marker.attributes('aria-label'));
    await wrapper.get('[aria-label="Save Hundred Blades"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.elite-result-main').attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('.elite-inline-detail').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Unsave Hundred Blades"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAll('.elite-marker').map(marker => marker.attributes('aria-label'))).toEqual(markers);
    const saved = await api.get({ characterKey: eliteFixtureView().characterKey! });
    expect(saved.skills).toContain(ELITE_FIXTURE_SKILLS.find(skill => skill.name === 'Hundred Blades')!.id);
    expect(saved.activeLocation).toBe(null);
    await wrapper.get('[aria-label="Unsave Hundred Blades"]').trigger('click');
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
  it("selects each profession independently and persists deselect-all across remounts", async () => {
    const api = host();
    let wrapper = await planner(api);
    expect(wrapper.findAll('.elite-profession')).toHaveLength(10);
    expect(wrapper.findAll('.elite-profession img')).toHaveLength(10);
    await wrapper.findAll('button').find(button => button.text() === 'Deselect all')!.trigger('click');
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    expect(wrapper.findAll('.elite-result')).toHaveLength(0);
    for (const name of ['Warrior', 'Ranger', 'Monk', 'Necromancer', 'Mesmer', 'Elementalist', 'Assassin', 'Ritualist', 'Paragon', 'Dervish']) {
      const choice = wrapper.get(`.elite-profession[aria-label="${name}"]`);
      await choice.trigger('click');
      expect(choice.attributes('aria-pressed')).toBe('true');
      expect(wrapper.findAll('.elite-profession[aria-pressed="true"]')).toHaveLength(1);
      await choice.trigger('click');
    }
    await flushPromises();
    wrapper.unmount();
    wrapper = await planner(api);
    expect(wrapper.findAll('.elite-profession[aria-pressed="true"]')).toHaveLength(0);
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    await wrapper.findAll('button').find(button => button.text() === 'Select all')!.trigger('click');
    expect(wrapper.findAll('.elite-profession[aria-pressed="true"]')).toHaveLength(10);
    expect(wrapper.findAll('.elite-result').length).toBeGreaterThan(0);
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
  it("deduplicates touching copies and preserves the active boss position", () => {
    const surface = { box: { left: 0, top: 0, width: 400, height: 300 },
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
    const locations = [
      { ...lissah, id: 'a', points: [[35, 80], [36, 80]] as const },
      { ...lissah, id: 'b', points: [[37, 80]] as const },
    ];
    const markers = eliteMarkers(locations, surface, 'b');
    expect(markers.map(marker => [marker.key, marker.x, marker.location.id])).toEqual([
      ['b:0', 37, 'b'],
    ]);
    expect(markers[0]!.locations.map(location => location.id)).toEqual(['a', 'b']);
    expect(markers.filter(marker => marker.active).map(marker => marker.location.id)).toEqual(['b']);
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
  it("keeps the same markers through inline details and collapse without losing list position", async () => {
    const wrapper = await planner();
    const markers = () => wrapper.findAll('.elite-marker').map(marker => marker.attributes('aria-label'));
    const original = markers();
    expect(original.length).toBeGreaterThan(1);
    wrapper.get<HTMLElement>('.elite-panel-content').element.scrollTop = 177;
    await wrapper.get('.elite-result-main').trigger('click');
    expect(markers()).toEqual(original);
    await wrapper.get('.elite-result-main').trigger('click');
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
  it("follows both live professions only in Current class mode", async () => {
    const wrapper = await planner();
    const names = () => wrapper.findAll('.elite-result').map(row => row.text()).join(' ');
    await wrapper.findAll('button').find(button => button.text() === 'Current class')!.trigger('click');
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
    await wrapper.findAll('button').find(button => button.text() === 'Current class')!.trigger('click');
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
    const marks = eliteMarkers(row, surface, null);
    expect(marks).toHaveLength(6);
    const anguish = marks.find(marker => marker.location.skillId === 54)!;
    expect(anguish.locations.map(location => location.boss).sort()).toEqual(['Garbok Handsmasher', 'Hierophant Morlog', 'Korvald Willcrusher', 'Vokur Grimshackles']);
    const otherArea = { ...anguish.location, id: 'other-area', mapId: 100 };
    const distant = { ...anguish.location, id: 'distant', points: [[5300, 5500]] as const };
    expect(eliteMarkers([...row, otherArea, distant], surface, null)).toHaveLength(8);
  });
  it("keeps every boss behind one shared skill marker", async () => {
    const surface = { box: { left: 0, top: 0, width: 400, height: 300 }, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
    const a = { ...lissah, id: 'a', points: [[80, 80], [81, 80]] as const };
    const b = { ...lissah, id: 'b', points: [[80, 80]] as const };
    const far = { ...lissah, id: 'far', points: [[180, 80]] as const };
    const wrapper = mount(EliteMarkers, { props: { surface, locations: [a, b, far], activeLocation: null,
      previewLocationId: null, catalogue: createSkillCatalogue(ELITE_FIXTURE_SKILLS), label: 'Test locations' } });
    expect(wrapper.findAll('.elite-marker')).toHaveLength(2);
    await wrapper.get('.elite-marker').trigger('pointerenter');
    expect(wrapper.emitted('inspect')![0]).toEqual([a, 80, 80, false, [a, b]]);
    await wrapper.setProps({ locations: [a, far] });
    await wrapper.get('.elite-marker').trigger('focus');
    expect(wrapper.emitted('inspect')!.at(-1)).toEqual([a, 80, 80, true, [a]]);
    wrapper.unmount();
  });
  it("keeps overlapping choices reachable, changes the preview, and opens details without filtering", async () => {
    const wrapper = await planner();
    const view = eliteFixtureView();
    await wrapper.setProps({ view: { ...view, world: { ...view.world!, transform: { a: 0.001, b: 0, c: 0, d: 0.001, e: 100, f: 100 } } } });
    await wrapper.get('[aria-label="Collapse Elite Skills"]').trigger('click');
    const original = wrapper.findAll('.elite-marker').map(marker => marker.attributes('aria-label'));
    await wrapper.get('.elite-marker').trigger('pointerenter');
    expect(wrapper.get('.elite-preview').attributes('role')).toBe('region');
    const choices = wrapper.findAll('.elite-nearby-choice');
    expect(choices.length).toBeGreaterThan(1);
    expect(new Set(choices.map(choice => choice.attributes('aria-label')!.split(' —')[0])).size).toBe(choices.length);
    const barrage = choices.find(choice => choice.attributes('aria-label')!.startsWith('Barrage —'))!;
    vi.useFakeTimers();
    try {
      await wrapper.get('.elite-marker').trigger('pointerleave');
      await wrapper.get('.elite-preview').trigger('pointerenter');
      await barrage.trigger('pointerenter');
      await vi.advanceTimersByTimeAsync(150);
      expect(wrapper.get('.elite-preview .inspector-identity strong').text()).toBe('Barrage');
      expect(wrapper.findAll('.elite-preview-bosses li').length).toBeGreaterThan(1);
      expect(wrapper.findAll('.elite-marker').map(marker => marker.attributes('aria-label'))).toEqual(original);
      await barrage.trigger('click');
      expect(wrapper.find('.elite-preview').exists()).toBe(false);
      expect(wrapper.get('.elite-panel .inspector-identity strong').text()).toBe('Barrage');
      expect(wrapper.findAll('.elite-marker').map(marker => marker.attributes('aria-label'))).toEqual(original);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
});
