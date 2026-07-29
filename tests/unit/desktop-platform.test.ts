import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESKTOP_PLATFORMS,
  desktopPlatformFor,
  isDesktopPlatform,
} from "../../src/shared/contracts.js";

describe("the trusted desktop platform contract", () => {
  it("maps only the three supported native process values", () => {
    assert.equal(desktopPlatformFor("darwin"), "macos");
    assert.equal(desktopPlatformFor("win32"), "windows");
    assert.equal(desktopPlatformFor("linux"), "linux");
    assert.throws(() => desktopPlatformFor("freebsd"), /unsupported/);
  });

  it("validates exactly the renderer-facing closed vocabulary", () => {
    for (const platform of DESKTOP_PLATFORMS) {
      assert.equal(isDesktopPlatform(platform), true);
    }
    for (const value of ["darwin", "win32", "freebsd", "", null, 1]) {
      assert.equal(isDesktopPlatform(value), false);
    }
  });
});
