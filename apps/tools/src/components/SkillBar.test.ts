import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  skillBarOf,
  skillId,
} from "../../../../src/shared/builds/library";
import { createSkillCatalogue } from "../skill-catalog";
import SkillBar from "./SkillBar.vue";

describe("SkillBar", () => {
  it("keeps a readable fallback when a promised icon cannot be served", async () => {
    const skill = skillId(281);
    const catalogue = createSkillCatalogue([{
      id: skill,
      name: "Orison of Healing",
      profession: "Mo",
      attribute: "HealingPrayers",
      elite: false,
      availability: "pve",
      energyCost: 5,
      adrenalineCost: 0,
      healthCost: 0,
      overcast: 0,
      activationSeconds: 1,
      aftercastSeconds: 0.75,
      rechargeSeconds: 2,
      description: null,
      iconUrl: "gw://app/skill-icons/281.bmp",
    }]);
    const wrapper = mount(SkillBar, {
      props: {
        skills: skillBarOf((slot) => slot === 0 ? skill : null),
        catalogue,
        editable: true,
      },
    });

    expect(wrapper.get(".skill-fallback").text()).toBe("OoH");
    await wrapper.get("img").trigger("error");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.get(".skill").attributes("data-icon-missing")).toBe("");
    expect(wrapper.get(".skill").attributes("aria-label")).toContain("Orison of Healing");
    wrapper.unmount();
  });
});
