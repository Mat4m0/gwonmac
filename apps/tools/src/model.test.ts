import { describe, expect, it } from "vitest";
import { demoLibrary, demoSkillCatalogue } from "./fixtures";
import {
  buildById,
  buildUsage,
  cloneLibrary,
  forkBuild,
  orderedBuilds,
  removeBuild,
  exclusiveTeamBuildIds,
  removeTeam,
  searchLibrary,
} from "./model";

describe("Vue library projections", () => {
  it("keeps variants directly under their root", () => {
    const order = orderedBuilds(demoLibrary.builds);
    const parent = order.findIndex((build) => build.id === "b-woh");
    const child = order.findIndex((build) => build.id === "b-woh-aegis");
    expect(child).toBe(parent + 1);
  });

  it("forks a variant as a sibling and never grows a lineage chain", () => {
    const library = forkBuild(cloneLibrary(demoLibrary), "b-woh-aegis", "b-next");
    expect(buildById(library, "b-next")?.parent).toBe("b-woh");
    expect(library.builds.filter((build) => build.parent === "b-woh")).toHaveLength(2);
  });

  it("deleting a shared build empties references and promotes variants", () => {
    const library = removeBuild(cloneLibrary(demoLibrary), "b-woh");
    expect(buildUsage(demoLibrary, "b-woh").length).toBeGreaterThan(0);
    expect(buildById(library, "b-woh")).toBeUndefined();
    expect(buildById(library, "b-woh-aegis")?.parent).toBeNull();
    expect(
      library.teams.flatMap((team) => team.slots).some((slot) => slot.build === "b-woh"),
    ).toBe(false);
  });

  it("deletes only builds exclusive to a removed team", () => {
    expect(exclusiveTeamBuildIds(demoLibrary, "t-vanquish").sort()).toEqual([
      "b-discord-rot",
      "b-woh-aegis",
    ]);
    const library = removeTeam(cloneLibrary(demoLibrary), "t-vanquish", true);
    expect(library.teams.some((team) => team.id === "t-vanquish")).toBe(false);
    expect(buildById(library, "b-discord-rot")).toBeUndefined();
    expect(buildById(library, "b-woh-aegis")).toBeUndefined();
    expect(buildById(library, "b-barrage")).toBeDefined();
    expect(buildById(library, "b-woh")).toBeDefined();
  });

  it("searches derived skill and hero names without storing them twice", () => {
    expect(searchLibrary(demoLibrary, demoSkillCatalogue, "build", "barrage", null)).toHaveLength(1);
    expect(searchLibrary(demoLibrary, demoSkillCatalogue, "team", "tahlkora", null)).toHaveLength(3);
    expect(searchLibrary(demoLibrary, demoSkillCatalogue, "team", "", "vanquish")).toHaveLength(1);
  });
});
