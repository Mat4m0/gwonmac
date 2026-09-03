import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { CARTOGRAPHY_BUILTIN_PRESETS } from "@shared/cartography-overlay";
import { fixtureSnapshot } from "../fixtures";
import MapStylePreview from "./MapStylePreview.vue";
import PanelStylePreview from "./PanelStylePreview.vue";

describe("settings previews", () => {
  it("renders the selected border and hides it at zero width", async () => {
    const style = CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style;
    const wrapper = mount(MapStylePreview, { props: { style, gridOpacity: 80, terrainOpacity: 60 } });
    expect(wrapper.find(`path[stroke="${style.walkability.boundaryColor}"]`).exists()).toBe(true);
    await wrapper.setProps({ style: { ...style, walkability: { ...style.walkability, boundaryWidth: 0 } } });
    expect(wrapper.find(`path[stroke="${style.walkability.boundaryColor}"]`).exists()).toBe(false);
  });
  it("explains readable text correction without changing the saved theme", () => {
    const theme = { ...fixtureSnapshot.settings.uiCustomTheme, text: '#000000' as const, window: '#000000' as const, titlebar: '#000000' as const, surface: '#000000' as const, recessed: '#000000' as const };
    const wrapper = mount(PanelStylePreview, { props: { settings: { ...fixtureSnapshot.settings, uiStyle: 'custom', uiCustomTheme: theme } } });
    expect(wrapper.get('[role="status"]').text()).toContain('low contrast');
    expect(theme.text).toBe('#000000');
    expect(wrapper.get('.panel-sample').attributes('style')).not.toContain('color: rgb(0, 0, 0)');
  });
});
