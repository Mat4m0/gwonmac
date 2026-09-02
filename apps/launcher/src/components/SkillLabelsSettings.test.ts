import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SKILL_KEY_BINDINGS } from "@shared/skill-key-bindings";
import SkillLabelsSettings from "./SkillLabelsSettings.vue";
import type { LauncherSettingsPatch } from "@shared/launcher-contracts";

describe("skill label customization", () => {
  it("captures physical keyboard labels without changing other slots", async () => {
    const save = vi.fn<(patch: LauncherSettingsPatch) => Promise<void>>(async () => undefined);
    const wrapper = mount(SkillLabelsSettings, { props: { bindings: EMPTY_SKILL_KEY_BINDINGS, save } });
    await wrapper.get('[aria-label="Set skill 3 label"]').trigger("click");
    await wrapper.get('[aria-label="Skill label capture"]').trigger("keydown", { code: "KeyG", key: "g", ctrlKey: true });
    await flushPromises();
    const bindings = save.mock.calls[0]?.[0];
    expect(bindings).toEqual({ skillKeyBindings: [null, null, { input: { kind: "keyboard", code: "KeyG" }, modifiers: { control: true, option: false, shift: false, command: false } }, null, null, null, null, null] });
    expect(wrapper.text()).toContain("Skill 3 label saved");
  });
  it("supports mouse labels and reports rejected persistence", async () => {
    const save = vi.fn(async () => { throw new Error("disk"); });
    const wrapper = mount(SkillLabelsSettings, { props: { bindings: EMPTY_SKILL_KEY_BINDINGS, save } });
    await wrapper.get('[aria-label="Set skill 1 label"]').trigger("click");
    await wrapper.get('[aria-label="Skill label capture"]').trigger("mousedown", { button: 4, altKey: true });
    await flushPromises();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ skillKeyBindings: expect.arrayContaining([expect.objectContaining({ input: { kind: "mouse-button", button: 4 } })]) }));
    expect(wrapper.get('[role="status"]').text()).toContain("could not be saved");
  });
});
