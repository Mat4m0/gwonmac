import {
  buildId,
  forkParentOf,
  mapTeamSlots,
  teamId,
  usedBy,
  type Build,
  type BuildId,
  type BuildLibrary,
  type Team,
} from "../../../src/shared/builds/library";
import { diffBuilds } from "../../../src/shared/builds/diff";
import { heroLabel } from "../../../src/shared/builds/heroes";
import type { SkillCatalogue } from "./skill-catalog";

export type {
  Build,
  BuildId,
  BuildLibrary,
  Profession,
  SkillId,
  Team,
  TeamId,
} from "../../../src/shared/builds/library";

export type LibraryItem =
  | { kind: "build"; id: BuildId }
  | { kind: "team"; id: Team["id"] };

export function cloneLibrary(library: BuildLibrary): BuildLibrary {
  return structuredClone(library);
}

export function buildById(
  library: BuildLibrary,
  id: string,
): Build | undefined {
  return library.builds.find((build) => build.id === id);
}

export function teamById(
  library: BuildLibrary,
  id: string,
): Team | undefined {
  return library.teams.find((team) => team.id === id);
}

export function buildUsage(library: BuildLibrary, id: string): readonly Team[] {
  return usedBy(library, buildId(id));
}

/**
 * How far a variant has moved from its parent, as one number.
 *
 * `diffBuilds` owns this comparison and knows two things this file's own
 * version did not: an absent attribute and an explicit rank 0 are the same
 * build, not a change, and a changed profession pair counts.
 */
export function buildDifference(parent: Build, child: Build): number {
  return diffBuilds(parent, child).total;
}

export function orderedBuilds(builds: readonly Build[]): Build[] {
  const roots = builds.filter((build) => build.parent === null);
  const result = roots.flatMap((root) => [
    root,
    ...builds.filter((build) => build.parent === root.id),
  ]);
  return [
    ...result,
    ...builds.filter(
      (build) =>
        build.parent !== null
        && !builds.some((parent) => parent.id === build.parent),
    ),
  ];
}

export function forkBuild(
  library: BuildLibrary,
  sourceId: string,
  nextId: string,
): BuildLibrary {
  const source = buildById(library, sourceId);
  if (!source) throw new Error("Build not found");
  return {
    ...library,
    builds: [
      {
        ...structuredClone(source),
        id: buildId(nextId),
        name: `${source.name} — variant`,
        parent: forkParentOf(source),
        favourite: false,
        lastUsed: null,
      },
      ...library.builds,
    ],
  };
}

export function removeBuild(
  library: BuildLibrary,
  removedId: string,
): BuildLibrary {
  return {
    ...library,
    builds: library.builds
      .filter((build) => build.id !== removedId)
      .map((build) =>
        build.parent === removedId ? { ...build, parent: null } : build,
      ),
    teams: library.teams.map((team) => ({
      ...team,
      slots: mapTeamSlots(team.slots, (slot) =>
        slot.build === removedId ? { ...slot, build: null } : slot,
      ),
    })),
  };
}

/** Builds owned only by one team, and therefore safe to remove with it. */
export function exclusiveTeamBuildIds(
  library: BuildLibrary,
  teamId: string,
): BuildId[] {
  const team = teamById(library, teamId);
  if (!team) return [];
  const referenced = new Set(
    team.slots.flatMap((slot) => slot.build === null ? [] : [slot.build]),
  );
  for (const other of library.teams) {
    if (other.id === team.id) continue;
    for (const slot of other.slots) {
      if (slot.build !== null) referenced.delete(slot.build);
    }
  }
  return [...referenced];
}

export function removeTeam(
  library: BuildLibrary,
  removedId: string,
  removeExclusiveBuilds = false,
): BuildLibrary {
  const buildIds = removeExclusiveBuilds
    ? exclusiveTeamBuildIds(library, removedId)
    : [];
  const withoutTeam: BuildLibrary = {
    ...library,
    teams: library.teams.filter((team) => team.id !== removedId),
  };
  return buildIds.reduce<BuildLibrary>(
    (current, id) => removeBuild(current, id),
    withoutTeam,
  );
}

export function teamMemberLabel(
  hero: Team["slots"][number]["hero"],
  slotIndex: number,
): string {
  if (slotIndex === 0) return "You";
  // The placeholder is this function's business, not the label's: an empty hero
  // slot is a prompt to pick one, and only a picker knows that.
  return hero === null ? "Choose hero" : heroLabel(hero);
}

export function searchLibrary(
  library: BuildLibrary,
  catalogue: SkillCatalogue,
  kind: LibraryItem["kind"],
  query: string,
  tag: string | null,
): Array<Build | Team> {
  const term = query.trim().toLocaleLowerCase();
  const values = kind === "build" ? orderedBuilds(library.builds) : library.teams;
  return values.filter((value) => {
    if (tag && !value.tags.includes(tag)) return false;
    if (!term) return true;
    const visibleText =
      "skills" in value
        ? value.skills.map((skill) => skill === null ? "" : catalogue.get(skill).name).join(" ")
        : value.slots.map((slot, index) => teamMemberLabel(slot.hero, index)).join(" ");
    return `${value.name} ${value.tags.join(" ")} ${visibleText}`
      .toLocaleLowerCase()
      .includes(term);
  });
}

export { buildId, teamId };
