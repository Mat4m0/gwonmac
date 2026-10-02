import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PAINTED_INKS,
  PAINTED_SURFACES,
  appearanceVariables,
  applyAppearance,
} from "../../src/renderer/appearance.js";
import { accessibleForeground, compositeColor, contrastRatio, customThemeReadable, parseRgb, readableForeground, readableSharedForeground, renderedCustomTheme } from "../../src/shared/ui-color.js";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "../../src/shared/contracts.js";
import { defaultCustomUiTheme, type UiThemeColor } from "../../src/shared/ui-theme.js";

/* Where text sits over the game: the panel over snow and over a black scene,
 * each with and without the accent hover layer. */
const worstBackgrounds = (window: UiThemeColor, accent: UiThemeColor, opacity: number) =>
  (["#FFFFFF", "#000000"] as const).flatMap((scene) => {
    const panel = compositeColor(window, scene, opacity);
    return [panel, compositeColor(accent, panel, 0.1)];
  });
const inkRoles = { "--ui-text": "text", "--ui-text-bright": "bright", "--ui-text-muted": "mutedText", "--ui-text-faint": "faintText", "--ui-accent-text": "accent" } as const;
const publishedInks = (settings: AppSettings, options?: { reducedTransparency?: boolean }) => {
  const variables = appearanceVariables(settings, options);
  const painted = PAINTED_INKS[settings.uiStyle === "obsidian" ? "modern" : "classic"];
  return Object.fromEntries(Object.entries(inkRoles).map(([name, role]) =>
    [name, (variables[name] ?? painted[role]) as UiThemeColor]));
};

describe("appearance settings", () => {
  it("derives the complete public token override from canonical settings", () => {
    const appearance: AppSettings = {
      ...DEFAULT_SETTINGS,
      uiPanelOpacity: 100,
    };
    assert.deepEqual(appearanceVariables(appearance), {
      "--ui-panel-opacity": "1",
      "--ui-text-faint": "#A6A192",
    });
  });

  it("scales interface text without scaling the game and removes the override at 100%", () => {
    assert.equal(appearanceVariables({ ...DEFAULT_SETTINGS, uiTextSize: 200 })["--ui-text-scale"], "2");
    assert.equal(appearanceVariables(DEFAULT_SETTINGS)["--ui-text-scale"], undefined);
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

describe("panel text legibility over the game", () => {
  it("measures the inks tokens.css actually paints", () => {
    const css = readFileSync(new URL("../../src/shared/ui/tokens.css", import.meta.url), "utf8");
    const block = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf("\n}", css.indexOf(`${selector} {`)));
    const hex = (value: string): string => {
      const oklch = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/u.exec(value);
      if (!oklch) return value.toUpperCase();
      const [lightness, chroma, hue] = oklch.slice(1).map(Number) as [number, number, number];
      const a = chroma * Math.cos(hue * Math.PI / 180);
      const b = chroma * Math.sin(hue * Math.PI / 180);
      const [l, m, s] = [
        lightness + 0.3963377774 * a + 0.2158037573 * b,
        lightness - 0.1055613458 * a - 0.0638541728 * b,
        lightness - 0.0894841775 * a - 1.291485548 * b,
      ].map((channel) => channel ** 3) as [number, number, number];
      return `#${[
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ].map((linear) => {
        const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, encoded)) * 255).toString(16).padStart(2, "0");
      }).join("")}`.toUpperCase();
    };
    const token = (source: string, name: string) => hex(new RegExp(`${name}: ([^;]+);`, "u").exec(source)![1]!.trim());
    for (const [material, source, window] of [
      ["classic", block(":root"), `#${[...block(":root").match(/--gw-panel-rgb: ([\d ]+);/u)![1]!.split(" ")].map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase()],
      ["modern", block(':root[data-ui-style="obsidian"]'), hex(/--ui-panel-fill: (oklch\([\d. ]+)/u.exec(block(':root[data-ui-style="obsidian"]'))![1]!)],
    ] as const) {
      assert.deepEqual(PAINTED_INKS[material], {
        window,
        text: token(source, "--ui-text"),
        bright: token(source, "--ui-text-bright"),
        mutedText: token(source, "--ui-text-muted"),
        faintText: token(source, "--ui-text-faint"),
        accent: token(source, "--ui-accent"),
      }, material);
      const gradient = (name: string) => {
        const value = new RegExp(`${name}: ([\\s\\S]+?);`, "u").exec(source)![1]!;
        return [...value.matchAll(/#[a-f\d]{6}|oklch\([\d. ]+\)/giu)].map((match) => hex(match[0]));
      };
      assert.deepEqual(PAINTED_SURFACES[material], material === "classic" ? {
        raised: gradient("--gw-face-graphite"), command: gradient("--gw-face-navy-quiet"),
        well: token(source, "--ui-well"), wellFill: "#000000",
        wellOpacity: Number(/--gw-sunk: rgb\(0 0 0 \/ ([\d]+)%\)/u.exec(source)![1]) / 100,
      } : {
        raised: gradient("--ui-raised-fill").slice(0, 1), command: gradient("--ui-raised-fill").slice(0, 1),
        well: token(source, "--ui-well"), wellFill: token(source, "--ui-well"),
        wellOpacity: Number(/--ui-well-fill: oklch\([\d. ]+ \/ ([\d.]+)\)/u.exec(source)![1]),
      }, `${material} structural paint`);
    }
  });

  it("keeps every text role at 4.5:1 in both styles at every opacity", () => {
    for (const uiStyle of ["guild-wars", "obsidian"] as const) {
      const painted = PAINTED_INKS[uiStyle === "obsidian" ? "modern" : "classic"];
      for (let uiPanelOpacity = 65; uiPanelOpacity <= 100; uiPanelOpacity += 1) {
        const inks = publishedInks({ ...DEFAULT_SETTINGS, uiStyle, uiPanelOpacity });
        const surfaces = PAINTED_SURFACES[uiStyle === "obsidian" ? "modern" : "classic"];
        const panels = (["#FFFFFF", "#000000"] as const).map((scene) => compositeColor(painted.window, scene, uiPanelOpacity / 100));
        for (const background of [
          ...worstBackgrounds(painted.window, painted.accent, uiPanelOpacity / 100),
          ...surfaces.raised, ...surfaces.command, surfaces.well,
          ...panels.map((panel) => compositeColor(surfaces.wellFill, panel, surfaces.wellOpacity)),
        ]) {
          for (const [name, ink] of Object.entries(inks)) {
            assert.ok(contrastRatio(ink, background) >= 4.5, `${uiStyle} ${uiPanelOpacity}% ${name} ${ink} on ${background}`);
          }
        }
      }
    }
  });

  it("re-inks the accent only where it is text and keeps a custom accent's fills exact", () => {
    // Modern gold headings measured 3.3:1 at 65 % over snow (HUB-249).
    for (const uiPanelOpacity of [65, 70]) {
      const variables = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: "obsidian", uiPanelOpacity });
      assert.ok(variables["--ui-accent-text"], `Modern ${uiPanelOpacity}% publishes an accent text ink`);
      assert.equal(variables["--ui-accent"], undefined, "the accent fill stays the token");
    }
    assert.equal(appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: "obsidian", uiPanelOpacity: 94 })["--ui-accent-text"], undefined);
    // Only lightness moves: at 70 % the heading still reads as gold, not cream.
    const [red, , blue] = parseRgb(appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: "obsidian", uiPanelOpacity: 70 })["--ui-accent-text"] as UiThemeColor);
    assert.ok(red - blue >= 80, `gold keeps its chroma (${red - blue})`);
    for (const accent of ["#4A6FA5", "#B03A2E"] as const) {
      const variables = appearanceVariables({
        ...DEFAULT_SETTINGS,
        uiStyle: "custom",
        uiCustomTheme: { ...DEFAULT_SETTINGS.uiCustomTheme, accent },
      });
      assert.equal(variables["--ui-accent"], accent);
      assert.equal(variables["--ui-primary-fill"], `linear-gradient(${accent}, ${accent})`);
      const text = variables["--ui-accent-text"] as UiThemeColor;
      for (const background of worstBackgrounds(PAINTED_INKS.classic.window, PAINTED_INKS.classic.accent, 0.94)) {
        assert.ok(contrastRatio(text, background) >= 4.5, `${accent} as text ${text} on ${background}`);
      }
    }
  });

  it("lets a light custom window's unchanged controls follow it, so every role reads at 4.5:1", () => {
    // One ink cannot pass on a white panel and the default dark controls, so the
    // controls the player left unchanged follow the window (decided 2026-10-01).
    for (const material of ["classic", "modern"] as const) {
      const theme = { ...defaultCustomUiTheme(material), window: "#FFFFFF" as UiThemeColor };
      const variables = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle: "custom", uiPanelOpacity: 100, uiCustomTheme: theme });
      const rendered = renderedCustomTheme(theme);
      const surfaces = [rendered.window, rendered.titlebar, rendered.surface, rendered.recessed];
      for (const name of Object.keys(inkRoles)) {
        for (const background of surfaces) {
          assert.ok(contrastRatio(variables[name] as UiThemeColor, background) >= 4.5, `${material} ${name} ${variables[name]} on ${background}`);
        }
      }
      assert.ok(contrastRatio(variables["--ui-selection-ink"] as UiThemeColor, rendered.selected) >= 4.5, `${material} selection`);
    }
    // A dark custom window and a colour the player chose keep their exact paint.
    const dark = { ...DEFAULT_SETTINGS.uiCustomTheme, window: "#101820" as UiThemeColor };
    assert.deepEqual(renderedCustomTheme(dark), dark);
    const chosen = { ...DEFAULT_SETTINGS.uiCustomTheme, window: "#FFFFFF" as UiThemeColor, recessed: "#123456" as UiThemeColor };
    assert.equal(renderedCustomTheme(chosen).recessed, "#123456");
    // Only those deliberately opposing colours make the editor warn.
    assert.deepEqual([DEFAULT_SETTINGS.uiCustomTheme, { ...chosen, recessed: "#F0F0F0" as UiThemeColor }, chosen].map(customThemeReadable), [true, true, false]);
  });

  it("moves each ink only a little per opacity step", () => {
    // One step from 77 to 76 % used to re-ink every keycap at once (HUB-252).
    for (const uiStyle of ["guild-wars", "obsidian"] as const) {
      let previous = publishedInks({ ...DEFAULT_SETTINGS, uiStyle, uiPanelOpacity: 100 });
      for (let uiPanelOpacity = 99; uiPanelOpacity >= 65; uiPanelOpacity -= 1) {
        const inks = publishedInks({ ...DEFAULT_SETTINGS, uiStyle, uiPanelOpacity });
        for (const [name, ink] of Object.entries(inks)) {
          const step = contrastRatio(ink, previous[name]!);
          assert.ok(step <= 1.1, `${uiStyle} ${uiPanelOpacity + 1}→${uiPanelOpacity}% moves ${name} by ${step.toFixed(2)}:1`);
        }
        previous = inks;
      }
    }
  });

  it("guards the opaque panel under Reduce Transparency and keeps the saved opacity", () => {
    for (const uiStyle of ["guild-wars", "obsidian"] as const) {
      const reduced = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle, uiPanelOpacity: 65 }, { reducedTransparency: true });
      const opaque = appearanceVariables({ ...DEFAULT_SETTINGS, uiStyle, uiPanelOpacity: 100 });
      assert.deepEqual({ ...reduced, "--ui-panel-opacity": "1" }, opaque);
      assert.equal(reduced["--ui-panel-opacity"], "0.65");
    }
  });
});
