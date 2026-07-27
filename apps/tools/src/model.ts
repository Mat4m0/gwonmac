import {
  buildId,
  forkParentOf,
  teamId,
  usedBy,
  type Build,
  type BuildId,
  type BuildLibrary,
  type Team,
} from "../../../src/shared/builds/library";
import { HERO_BY_ID } from "../../../src/shared/builds/heroes";
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

export function buildDifference(parent: Build, child: Build): number {
  const skillChanges = parent.skills.reduce(
    (count, skill, index) => count + (skill === child.skills[index] ? 0 : 1),
    0,
  );
  const attributes = new Set([
    ...Object.keys(parent.attributes),
    ...Object.keys(child.attributes),
  ]);
  return skillChanges + [...attributes].filter(
    (attribute) =>
      parent.attributes[attribute as keyof typeof parent.attributes]
      !== child.attributes[attribute as keyof typeof child.attributes],
  ).length;
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
      slots: team.slots.map((slot) =>
        slot.build === removedId ? { ...slot, build: null } : slot,
      ) as unknown as Team["slots"],
    })),
  };
}

export function heroLabel(hero: Team["slots"][number]["hero"]): string {
  if (hero === null) return "You";
  return HERO_BY_ID.get(hero)?.name.replace(/([a-z])([A-Z])/gu, "$1 $2") ?? `Hero ${hero}`;
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
        : value.slots.map((slot) => heroLabel(slot.hero)).join(" ");
    return `${value.name} ${value.tags.join(" ")} ${visibleText}`
      .toLocaleLowerCase()
      .includes(term);
  });
}

export { buildId, teamId };
