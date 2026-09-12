import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SkillDetails from "./SkillDetails.vue";
import { ELITE_FIXTURE_SKILLS } from "../elite-fixture";

describe("shared skill details", () => {
  it("labels the real stat icons and preserves fractional seconds and health percentages", () => {
    const wrapper = mount(SkillDetails, { props: { skill: { ...ELITE_FIXTURE_SKILLS[0]!,
      energyCost: 5, adrenalineCost: 8, activationSeconds: 0.25, rechargeSeconds: 12,
      healthCost: 10, overcast: 5, aftercastSeconds: 0.75 } } });
    expect(wrapper.findAll('.skill-stats img').map(icon => icon.attributes('alt'))).toEqual([
      'Energy', 'Adrenaline', 'Activation', 'Recharge', 'Health sacrifice', 'Overcast',
    ]);
    expect(wrapper.findAll('.skill-stats dd').map(value => value.text())).toEqual(['5', '8', '0.25s', '12s', '10%', '5', '0.75s']);
    expect(wrapper.findAll('.skill-stats img').every(icon => icon.attributes('src')?.includes('.png'))).toBe(true);
    expect(wrapper.text()).toContain('Warrior');
    wrapper.unmount();
  });
  it("omits zero mechanics and explains unavailable descriptions without inventing values", () => {
    const wrapper = mount(SkillDetails, { props: { skill: { ...ELITE_FIXTURE_SKILLS[0]!,
      energyCost: 0, adrenalineCost: 0, activationSeconds: 0, rechargeSeconds: 0,
      healthCost: 0, overcast: 0, aftercastSeconds: 0, description: '' } } });
    expect(wrapper.find('.skill-stats').exists()).toBe(false);
    expect(wrapper.text()).toContain('Description is unavailable from this installed client.');
    wrapper.unmount();
  });
});
