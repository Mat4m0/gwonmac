import { describe, expect, it } from "vitest";
import { traderItemIcon, traderProfessionIcon } from "./trader-assets";
import { TRADER_ITEMS, TRADER_PROFESSIONS } from "./trader-catalog";

describe("trader artwork", () => {
  it("bundles an item icon for the complete trader catalogue", () => {
    for (const item of TRADER_ITEMS) {
      expect(traderItemIcon(item), item.name).toMatch(/^data:image\/png|\.png(?:\?|$)/u);
    }
  });

  it("bundles every profession icon", () => {
    for (const profession of TRADER_PROFESSIONS.filter((entry) => entry !== "general")) {
      expect(traderProfessionIcon(profession), profession)
        .toMatch(/^data:image\/png|\.png(?:\?|$)/u);
    }
  });
});
