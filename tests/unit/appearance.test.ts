import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appearanceVariables,
  applyAppearance,
} from "../../src/renderer/appearance.js";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "../../src/shared/contracts.js";

describe("appearance settings", () => {
  it("derives the complete public token override from canonical settings", () => {
    const appearance: AppSettings = {
      ...DEFAULT_SETTINGS,
      uiPanelOpacity: 78,
    };
    assert.deepEqual(appearanceVariables(appearance), {
      "--ui-panel-opacity": "0.78",
    });
  });

  it("sets independent style and font markers and removes their defaults", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {} as DOMStringMap,
      style: {
        setProperty(name: string, value: string) {
          properties.set(name, value);
        },
      },
    } as HTMLElement;

    applyAppearance({
      ...DEFAULT_SETTINGS,
      uiStyle: "obsidian",
      uiFont: "inter",
    }, root);
    assert.equal(root.dataset.uiStyle, "obsidian");
    assert.equal(root.dataset.uiFont, "inter");
    assert.equal(properties.get("--ui-panel-opacity"), "0.94");

    applyAppearance(DEFAULT_SETTINGS, root);
    assert.equal(root.dataset.uiStyle, undefined);
    assert.equal(root.dataset.uiFont, undefined);
  });
});
