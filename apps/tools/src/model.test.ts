import { describe, expect, it } from "vitest";
import { demoLibrary } from "./fixtures";
import {
  buildById,
  buildUsage,
  cloneLibrary,
  forkBuild,
  orderedBuilds,
  removeBuild,
  searchLibrary,
} from "./model";

describe("build library domain", () => {
  it("keeps variants directly under their root", () => {
    const order = orderedBuilds(demoLibrary.builds);
    const parent = order.findIndex((build) => build.id === "b-woh");
    const child = order.findIndex((build) => build.id === "b-woh-aegis");
    expect(child).toBe(parent + 1);
  });

  it("forks a variant as a sibling and never grows a lineage chain", () => {
    const library = cloneLibrary(demoLibrary);
    const copy = forkBuild(library, "b-woh-aegis", "b-next");
    expect(copy.parentId).toBe("b-woh");
    expect(library.builds.filter((build) => build.parentId === "b-woh")).toHaveLength(2);
  });

  it("deleting a shared build empties references and promotes its variants", () => {
    const library = cloneLibrary(demoLibrary);
    expect(buildUsage(library, "b-woh").length).toBeGreaterThan(0);
    removeBuild(library, "b-woh");
    expect(buildById(library, "b-woh")).toBeUndefined();
    expect(buildById(library, "b-woh-aegis")?.parentId).toBeNull();
    expect(
      library.teams.flatMap((team) => team.slots).some((slot) => slot.buildId === "b-woh"),
    ).toBe(false);
  });

  it("searches the visible meaning, including skill names and hero names", () => {
    expect(searchLibrary(demoLibrary, "build", "barrage", null)).toHaveLength(1);
    expect(searchLibrary(demoLibrary, "team", "tahlkora", null)).toHaveLength(3);
    expect(searchLibrary(demoLibrary, "team", "", "vanquish")).toHaveLength(1);
  });
});
