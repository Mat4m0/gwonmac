import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CUSTOM_UI_THEME,
  decodeCustomUiTheme,
  defaultCustomUiTheme,
  encodeCustomUiTheme,
  normaliseCustomUiTheme,
  normaliseUiThemeColor,
} from "../../src/shared/ui-theme.js";

describe("custom UI theme contract", () => {
  it("has the durable v1 defaults", () => {
    assert.deepEqual(DEFAULT_CUSTOM_UI_THEME, {
      material: "classic",
      window: "#0B0B0B",
      titlebar: "#292927",
      surface: "#202225",
      recessed: "#080807",
      selected: "#1B3554",
      accent: "#E6C882",
      text: "#F1EBDD",
      mutedText: "#B7B09F",
      border: "#D8D2BF",
      windowGradient: true,
    });
  });

  it("restores one canonical palette for each material", () => {
    assert.equal(defaultCustomUiTheme("classic"), DEFAULT_CUSTOM_UI_THEME);
    assert.deepEqual(defaultCustomUiTheme("modern"), {
      material: "modern",
      window: "#1B1A18",
      titlebar: "#22211F",
      surface: "#2B2926",
      recessed: "#11100F",
      selected: "#3C3832",
      accent: "#D5B86E",
      text: "#F4EFE5",
      mutedText: "#BDB5A8",
      border: "#5F5A52",
      windowGradient: false,
    });
  });

  it("strictly parses and normalises six-digit colours", () => {
    assert.equal(normaliseUiThemeColor("#a1b2c3"), "#A1B2C3");
    for (const value of ["#fff", "fff", "#12345g", "#12345678", 123456]) {
      assert.equal(normaliseUiThemeColor(value), null);
    }
  });

  it("normalises only the complete semantic theme shape", () => {
    assert.deepEqual(normaliseCustomUiTheme({
      ...DEFAULT_CUSTOM_UI_THEME,
      window: "#abcdef",
      recessed: "#000000",
      selected: "#102030",
      accent: "#fedcba",
      windowGradient: false,
    }), {
      ...DEFAULT_CUSTOM_UI_THEME,
      window: "#ABCDEF",
      recessed: "#000000",
      selected: "#102030",
      accent: "#FEDCBA",
      windowGradient: false,
    });
    assert.equal(normaliseCustomUiTheme({ ...DEFAULT_CUSTOM_UI_THEME, unknown: true }), null);
    assert.equal(normaliseCustomUiTheme({ ...DEFAULT_CUSTOM_UI_THEME, accent: "#fff" }), null);
    assert.equal(normaliseCustomUiTheme(null), null);
  });

  it("round trips the versioned share format and rejects malformed input", () => {
    const encoded = encodeCustomUiTheme(DEFAULT_CUSTOM_UI_THEME);
    assert.equal(encoded, "gwonmac-theme-v1:classic:#0B0B0B:#292927:#202225:#080807:#1B3554:#E6C882:#F1EBDD:#B7B09F:#D8D2BF:1");
    assert.deepEqual(decodeCustomUiTheme(encoded), DEFAULT_CUSTOM_UI_THEME);
    for (const value of [
      encoded.replace("v1", "v2"),
      encoded.replace("#E6C882", "#E6C88"),
      encoded.replace(/:1$/u, ":true"),
      encoded.replace(":classic:", ":ornate:"),
      `${encoded}:extra`,
      "",
    ]) assert.equal(decodeCustomUiTheme(value), null);
  });
});
