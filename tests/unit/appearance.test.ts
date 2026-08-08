import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appearanceVariables } from "../../src/renderer/appearance.js";
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
});
