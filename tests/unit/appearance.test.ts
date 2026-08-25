import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accessibleForeground,
  appearanceVariables,
  applyAppearance,
  contrastRatio,
  readableForeground,
  readableSharedForeground,
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
        removeProperty(name: string) { properties.delete(name); },
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

  it("derives readable custom tokens and removes them when switching away", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {} as DOMStringMap,
      style: {
        setProperty(name: string, value: string) { properties.set(name, value); },
        removeProperty(name: string) { properties.delete(name); },
      },
    } as HTMLElement;
    applyAppearance({ ...DEFAULT_SETTINGS, uiStyle: "custom" }, root);
    assert.equal(root.dataset.uiStyle, undefined);
    assert.equal(root.dataset.uiMaterial, "classic");
    assert.equal(properties.has("--ui-panel-fill"), false);
    assert.equal(properties.has("--ui-title-fill"), false);
    assert.ok(contrastRatio("#0B0B0B", readableForeground("#0B0B0B")) >= 4.5);
    assert.equal(readableForeground("#FFFFFF"), "#171613");
    const shared = readableSharedForeground(["#000000", "#FFFFFF"]);
    assert.ok(contrastRatio("#000000", shared) >= 4.5);
    assert.ok(contrastRatio("#FFFFFF", shared) >= 4.5);
    assert.ok(contrastRatio("#595959", accessibleForeground("#948E7E", ["#595959"])) >= 4.5);

    applyAppearance({
      ...DEFAULT_SETTINGS,
      uiStyle: "custom",
      uiCustomTheme: { ...DEFAULT_SETTINGS.uiCustomTheme, accent: "#E6C883" },
    }, root);
    assert.equal(root.dataset.uiStyle, undefined);
    assert.equal(root.dataset.uiMaterial, "classic");
    assert.equal(properties.get("--ui-accent"), "#E6C883");
    assert.equal(properties.has("--ui-panel-fill"), false);

    applyAppearance({ ...DEFAULT_SETTINGS, uiStyle: "obsidian" }, root);
    assert.equal(root.dataset.uiStyle, "obsidian");
    assert.equal(root.dataset.uiMaterial, undefined);
    assert.equal(properties.has("--ui-accent"), false);

    applyAppearance({
      ...DEFAULT_SETTINGS,
      uiStyle: "custom",
      uiCustomTheme: { ...DEFAULT_SETTINGS.uiCustomTheme, surface: "#202226" },
    }, root);
    assert.equal(
      properties.get("--ui-command-fill"),
      properties.get("--ui-raised-fill"),
    );
  });

  it("activates a generation-keyed game font only after it loads", async () => {
    const sources: string[] = [];
    const added: unknown[] = [];
    const originalFontFace = globalThis.FontFace;
    const originalDocument = globalThis.document;
    class TestFontFace {
      constructor(_family: string, source: string) {
        sources.push(source);
      }
      async load() { return this; }
    }
    Object.defineProperty(globalThis, "FontFace", { configurable: true, value: TestFontFace });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { fonts: { add: (font: unknown) => added.push(font) } },
    });
    try {
      const root = {
        dataset: {} as DOMStringMap,
        style: {
          setProperty(name: string, value: string) {
            void name;
            void value;
          },
          removeProperty() { return ""; },
        },
      } as unknown as HTMLElement;
      applyAppearance(DEFAULT_SETTINGS, root, "generation-a");
      assert.equal(root.dataset.uiFont, undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(root.dataset.uiFont, "guild-wars");
      assert.equal(added.length, 2);
      assert.match(sources[0]!, /generation=generation-a/u);
      assert.match(sources[1]!, /game-font-display\.ttf/u);

      applyAppearance({ ...DEFAULT_SETTINGS, uiFont: "inter" }, root, "generation-b");
      await Promise.resolve();
      assert.equal(root.dataset.uiFont, "inter");
    } finally {
      Object.defineProperty(globalThis, "FontFace", { configurable: true, value: originalFontFace });
      Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    }
  });
});
