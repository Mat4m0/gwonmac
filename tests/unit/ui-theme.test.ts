import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CUSTOM_UI_THEME,
  decodeCustomUiTheme,
  encodeCustomUiTheme,
  normaliseCustomUiTheme,
  normaliseUiThemeColor,
} from "../../src/shared/ui-theme.js";

describe("custom UI theme contract", () => {
  it("has the durable v1 defaults", () => {
    assert.deepEqual(DEFAULT_CUSTOM_UI_THEME, {
      window: "#14120F",
      recessed: "#070707",
      selected: "#26374A",
      accent: "#E6C882",
      windowGradient: true,
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
      window: "#abcdef",
      recessed: "#000000",
      selected: "#102030",
      accent: "#fedcba",
      windowGradient: false,
    }), {
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
    assert.equal(encoded, "gwonmac-theme-v1:#14120F:#070707:#26374A:#E6C882:1");
    assert.deepEqual(decodeCustomUiTheme(encoded), DEFAULT_CUSTOM_UI_THEME);
    for (const value of [
      "gwonmac-theme-v2:#14120F:#070707:#26374A:#E6C882:1",
      "gwonmac-theme-v1:#14120F:#070707:#26374A:#E6C88:1",
      "gwonmac-theme-v1:#14120F:#070707:#26374A:#E6C882:true",
      `${encoded}:extra`,
      "",
    ]) assert.equal(decodeCustomUiTheme(value), null);
  });
});
