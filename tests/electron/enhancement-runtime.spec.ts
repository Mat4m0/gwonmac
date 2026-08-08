import { expect, test } from "@playwright/test";
import {
  enhancementCapabilitiesFor,
  enhancementCapabilitiesRequested,
} from "../../src/shared/contracts.js";
import {
  closeOffline,
  launchOffline,
} from "./fixtures.mjs";

test.describe("Enhancement runtime selection", () => {
  test("Tools off still selects required Core", async () => {
    const fixture = await launchOffline("gw-enhancement-core-e2e-");

    try {
      const init = await fixture.page.evaluate(() => window.gwNative.init);
      expect(init).toEqual({
        enhancementProgram: "none",
        enhancementSelection: {
          nativeCursor: true,
          tools: false,
        },
        templateFsTrace: false,
      });
      const enhancementCapabilities = enhancementCapabilitiesFor(
        init.enhancementSelection,
        init.enhancementProgram,
      );
      const enhancementRequested = enhancementCapabilitiesRequested(
        enhancementCapabilities,
      );
      expect(enhancementCapabilities).toMatchObject({ nativeCursor: true });
      expect(enhancementRequested).toBe(true);
    } finally {
      await closeOffline(fixture);
    }
  });
});
