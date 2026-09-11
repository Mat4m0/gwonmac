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
  let current = EMPTY_ELITE_TRACKING;
  return { get: vi.fn(async () => current), update: vi.fn(async ({ change }) => {
    current = changeEliteTracking(current, change, ELITE_LOCATIONS); return current;
  }) };
}
async function planner(trackingHost = host()) {
  const wrapper = mount(EliteSkillsApp, { attachTo: document.body, props: {
    view: eliteFixtureView(), catalogue: createSkillCatalogue(ELITE_FIXTURE_SKILLS), catalogueVersion: 1,
    catalogueProblem: "", trackingHost, openWiki: vi.fn(), reloadSkills: vi.fn(),
  } });
  await flushPromises();
  await wrapper.get('.elite-map-trigger').trigger('click');
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
    expect(wrapper.get('.elite-mission-tracker').text()).toContain('Lissah');
    expect(wrapper.findAll('.elite-marker')).toHaveLength(1);
    await wrapper.get('.elite-marker').trigger('pointerenter');
    expect(wrapper.find('.elite-preview').exists()).toBe(true);
    await wrapper.setProps({ view: { ...eliteFixtureView(true), mission: null } });
    expect(wrapper.find('.elite-preview').exists()).toBe(false);
    expect(wrapper.find('.elite-marker').exists()).toBe(false);
    expect(wrapper.find('.elite-mission-tracker').exists()).toBe(false);
    const missionView = eliteFixtureView(true);
    await wrapper.setProps({ view: { ...missionView, mission: { box: missionView.mission!.box, transform: null } } });
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    expect(wrapper.get('.elite-mission-tracker').text()).toContain('Boss markers are unavailable in this area');
    await wrapper.setProps({ view: { ...eliteFixtureView(true), mapId: 55 } });
    expect(wrapper.findAll('.elite-marker')).toHaveLength(0);
    expect(wrapper.get('.elite-mission-tracker').text()).toContain('Target is in Bjora Marches');
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
  it("shows failed saves as unchanged and retries the intended action", async () => {
    const api = host();
    const update = vi.spyOn(api, 'update');
    update.mockRejectedValueOnce(new Error('disk full'));
    const wrapper = await planner(api);
    await wrapper.get('input[type="search"]').setValue('Eviscerate');
    await wrapper.get('.elite-track-button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('saved plan is unchanged');
    expect(wrapper.get('.elite-track-button').attributes('aria-pressed')).toBe('false');
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
    await wrapper.get('[aria-label="Close Elite Skills"]').trigger('click', { detail: 0 });
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
    resolveLoad({ skills: [338], activeLocation: lissah.id, missionMap: true });
    await flushPromises();
    expect(controller.tracking.value.skills).toEqual([]);
    void controller.change({ kind: 'track', skillId: 338 });
    character.value = null;
    await flushPromises();
    resolveSave({ skills: [338], activeLocation: lissah.id, missionMap: true });
    await flushPromises();
    expect(controller.tracking.value.skills).toEqual([]);
    expect(controller.loaded.value).toBe(false);
    controller.dispose();
  });
});
