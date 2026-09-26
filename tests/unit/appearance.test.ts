import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appearanceVariables,
  applyAppearance,
  sceneCapCurve,
} from "../../src/renderer/appearance.js";
import { accessibleForeground, compositeColor, contrastRatio, parseRgb, readableForeground, readableSharedForeground } from "../../src/shared/ui-color.js";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "../../src/shared/contracts.js";
import { defaultCustomUiTheme, type UiThemeColor } from "../../src/shared/ui-theme.js";

describe("appearance settings", () => {
  it("derives the complete public token override from canonical settings", () => {
    const appearance: AppSettings = {
      ...DEFAULT_SETTINGS,
      uiStyle: "obsidian",
      uiPanelOpacity: 100,
    };
    assert.deepEqual(appearanceVariables(appearance), {
      "--ui-panel-opacity": "1",
    });
  });

  /* The rendered worst cases the projector must beat, using the colours
   * tokens.css actually paints: the panel over snow, the same with the
   * accent hover layer, and the panel over black. */
  const PANEL = { "guild-wars": "#080807", obsidian: "#0F0D0A" } as const;
  const HOVER = { "guild-wars": "#E6C882", obsidian: "#DBB568" } as const;
  const DEFAULT_INK = {
    "guild-wars": { "--ui-text": "#EBE5D3", "--ui-text-muted": "#B2AC9D", "--ui-text-faint": "#948E7E", "--ui-accent-text": "#E6C882" },
    obsidian: { "--ui-text": "#ECE7DF", "--ui-text-muted": "#B5B0A7", "--ui-text-faint": "#908C84", "--ui-accent-text": "#DBB568" },
  } as const;
  const worstCases = (style: "guild-wars" | "obsidian", opacity: number) => {
    const snow = compositeColor(PANEL[style], "#FFFFFF", opacity / 100);
    return [snow, compositeColor(HOVER[style], snow, 0.1), compositeColor(PANEL[style], "#000000", opacity / 100)];
  };
  const inks = (style: "guild-wars" | "obsidian", opacity: number, reducedTransparency = false) => {
    const variables = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: style, uiPanelOpacity: opacity }, { reducedTransparency });
    return Object.fromEntries(Object.entries(DEFAULT_INK[style]).map(([name, color]) =>
      [name, (variables[name] ?? color) as UiThemeColor]));
  };

  it("keeps every built-in text role at 4.5:1 over snow at every opacity", () => {
    for (const style of ["guild-wars", "obsidian"] as const) {
      for (let opacity = 65; opacity <= 100; opacity += 1) {
        for (const [name, color] of Object.entries(inks(style, opacity))) {
          for (const background of worstCases(style, opacity)) {
            assert.ok(contrastRatio(color, background) >= 4.5, `${style} ${opacity}% ${name} ${color} on ${background}`);
          }
        }
      }
    }
  });

  /* The Hub holds the scene's highlights back behind its fill, so its inks
   * only have to beat the capped scene. */
  const hubInks = (style: "guild-wars" | "obsidian", opacity: number) => {
    const variables = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: style, uiPanelOpacity: opacity });
    const shared = inks(style, opacity);
    const cap = Number(variables["--ui-hub-scene-cap"] ?? 1);
    const level = Math.round(cap * 255).toString(16).padStart(2, "0");
    const scene = `#${level}${level}${level}` as UiThemeColor;
    const snow = compositeColor(PANEL[style], scene, opacity / 100);
    return {
      cap,
      worstCases: [snow, compositeColor(HOVER[style], snow, 0.1), compositeColor(PANEL[style], "#000000", opacity / 100)],
      inks: Object.fromEntries(Object.entries(shared).map(([name, color]) =>
        [name, (variables[name.replace("--ui-", "--ui-hub-")] ?? color) as UiThemeColor])),
    };
  };

  it("keeps the Hub's title, muted and gold ink at every opacity by capping bright scenes", () => {
    for (const style of ["guild-wars", "obsidian"] as const) {
      for (let opacity = 65; opacity <= 100; opacity += 1) {
        const hub = hubInks(style, opacity);
        for (const [name, color] of Object.entries(hub.inks)) {
          for (const background of hub.worstCases) {
            assert.ok(contrastRatio(color, background) >= 4.5, `Hub ${style} ${opacity}% ${name} ${color} on ${background}`);
          }
        }
        for (const name of ["--ui-text", "--ui-text-muted", "--ui-accent-text"] as const) {
          assert.equal(hub.inks[name], DEFAULT_INK[style][name], `Hub ${style} ${opacity}% keeps ${name}`);
        }
        /* The hierarchy the shared guard flattens stays visible in the Hub. */
        assert.ok(contrastRatio(hub.inks["--ui-text"]!, hub.inks["--ui-text-muted"]!) >= 1.5, `${style} ${opacity}% title and detail`);
        assert.ok(contrastRatio(hub.inks["--ui-text"]!, hub.inks["--ui-text-faint"]!) >= 1.5, `${style} ${opacity}% typed text and placeholder`);
      }
      assert.equal(hubInks(style, 65).cap < 0.55, true);
      assert.equal(hubInks(style, 94).cap, 1);
      assert.equal(appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: style, uiPanelOpacity: 94 })["--ui-hub-backdrop"], undefined);
      assert.equal(appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: style, uiPanelOpacity: 65 }, { reducedTransparency: true })["--ui-hub-backdrop"], undefined);
      /* At the shipped minimum the shared guard alone flattens every role. */
      const shared = inks(style, 65);
      assert.ok(contrastRatio(shared["--ui-text"]!, shared["--ui-text-muted"]!) < 1.1);
    }
  });

  it("caps only highlights: dark scenes pass unchanged and nothing brightens", () => {
    for (const cap of [0.45, 0.4824, 0.75, 0.99]) {
      const curve = sceneCapCurve(cap);
      assert.equal(curve.length, 17);
      curve.forEach((value, index) => {
        assert.ok(value <= index / 16 + 1e-9 && value <= cap, `${cap}: ${index / 16} → ${value}`);
        if (index / 16 <= cap * 0.6) assert.equal(value, index / 16);
        if (index > 0) assert.ok(value >= curve[index - 1]!, `${cap} stays monotonic`);
      });
    }
  });

  it("keeps bright and display ink readable on recoloured light surfaces", () => {
    for (const recolour of [{ titlebar: "#E0E0E0" }, { surface: "#D8D8D8" }] as const) {
      for (const material of ["classic", "modern"] as const) {
        const theme = { ...defaultCustomUiTheme(material), ...recolour };
        const variables = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: "custom", uiCustomTheme: theme });
        const light = Object.values(recolour)[0] as UiThemeColor;
        const text = variables["--ui-text"] as UiThemeColor;
        assert.ok(text, `${material} ${light} moves text`);
        for (const name of ["--ui-text-bright", "--ui-display-text"]) {
          const ink = variables[name] as UiThemeColor | undefined;
          assert.ok(ink, `${material} ${light} publishes ${name}`);
          assert.ok(contrastRatio(ink!, light) >= contrastRatio(text, light) - 0.05, `${material} ${name} ${ink} on ${light}`);
        }
      }
    }
  });

  it("re-inks the accent only as text and keeps gold where it already reads", () => {
    for (const opacity of [65, 70]) {
      const variables = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: "obsidian", uiPanelOpacity: opacity });
      assert.ok(variables["--ui-accent-text"], `Modern ${opacity}% re-inks accent text`);
      assert.equal(variables["--ui-accent"], undefined);
    }
    for (const uiStyle of ["guild-wars", "obsidian"] as const) {
      assert.equal(appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle, uiPanelOpacity: 94 })["--ui-accent-text"], undefined);
    }
    for (const accent of ["#4A6FA5", "#B03A2E"] as const) {
      const variables = appearanceVariables({
        ...DEFAULT_SETTINGS,
        uiStyle: "custom",
        uiCustomTheme: { ...DEFAULT_SETTINGS.uiCustomTheme, accent },
      });
      assert.equal(variables["--ui-accent"], accent);
      assert.equal(variables["--ui-primary-fill"], `linear-gradient(${accent}, ${accent})`);
      const text = variables["--ui-accent-text"] as UiThemeColor;
      assert.ok(contrastRatio(text, compositeColor("#0B0B0B", "#000000", 0.94)) >= 4.5, `${accent} as text`);
    }
  });

  it("moves each ink gradually and keeps faint distinct where it reads", () => {
    for (const style of ["guild-wars", "obsidian"] as const) {
      for (let opacity = 66; opacity <= 100; opacity += 1) {
        for (const [scope, read] of [["shared", inks], ["Hub", (s: typeof style, o: number) => hubInks(s, o).inks]] as const) {
          const [before, after] = [read(style, opacity - 1), read(style, opacity)];
          for (const name of Object.keys(before)) {
            const step = parseRgb(before[name]!).map((channel, index) => Math.abs(channel - parseRgb(after[name]!)[index]!));
            assert.ok(Math.max(...step) <= 12, `${scope} ${style} ${opacity - 1}→${opacity}% ${name} jumps ${step.join(",")}`);
          }
        }
      }
      const opaque = inks(style, 100);
      assert.notEqual(opaque["--ui-text-faint"], opaque["--ui-text-muted"]);
    }
  });

  it("guards on effective opacity, so Reduce Transparency keeps the opaque inks", () => {
    for (const style of ["guild-wars", "obsidian"] as const) {
      assert.deepEqual(inks(style, 65, true), inks(style, 100));
      assert.equal(appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: style, uiPanelOpacity: 65 }, { reducedTransparency: true })["--ui-panel-opacity"], "0.65");
    }
  });

  it("projects untouched custom palettes exactly like their built-in material", () => {
    for (const [material, uiStyle] of [
      ["classic", "guild-wars"],
      ["modern", "obsidian"],
    ] as const) {
      const builtIn = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle });
      const custom = appearanceVariables({
        ...DEFAULT_SETTINGS,
        uiStyle: "custom",
        uiCustomTheme: defaultCustomUiTheme(material),
      });
      assert.deepEqual(custom, builtIn);
    }
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
