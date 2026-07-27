export type Profession =
  | "Warrior"
  | "Ranger"
  | "Monk"
  | "Necromancer"
  | "Mesmer"
  | "Elementalist"
  | "Assassin"
  | "Ritualist"
  | "Paragon"
  | "Dervish";

export type Skill = Readonly<{
  id: number;
  name: string;
  short: string;
  profession: Profession;
  elite?: boolean;
}>;

export type Build = {
  id: string;
  name: string;
  professions: readonly [Profession, Profession | null];
  skills: readonly Skill[];
  attributes: Readonly<Record<string, number>>;
  tags: string[];
  favourite: boolean;
  parentId: string | null;
  notes: string;
};

export type TeamSlot = {
  hero: string;
  profession: Profession;
  buildId: string | null;
  behavior: "Fight" | "Guard" | "Avoid";
};

export type Team = {
  id: string;
  name: string;
  mode: "Normal" | "Hard";
  tags: string[];
  favourite: boolean;
  slots: TeamSlot[];
};

export type BuildLibrary = {
  version: 1;
  builds: Build[];
  teams: Team[];
};

export type LibraryItem =
  | { kind: "build"; id: string }
  | { kind: "team"; id: string };

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

export function buildUsage(library: BuildLibrary, buildId: string): Team[] {
  return library.teams.filter((team) =>
    team.slots.some((slot) => slot.buildId === buildId),
  );
}

export function buildDifference(parent: Build, child: Build): number {
  const skillChanges = parent.skills.reduce(
    (count, skill, index) =>
      count + (skill.id === child.skills[index]?.id ? 0 : 1),
    0,
  );
  const attributes = new Set([
    ...Object.keys(parent.attributes),
    ...Object.keys(child.attributes),
  ]);
  const attributeChanges = [...attributes].reduce(
    (count, attribute) =>
      count
      + (parent.attributes[attribute] === child.attributes[attribute] ? 0 : 1),
    0,
  );
  return skillChanges + attributeChanges;
}

export function orderedBuilds(builds: readonly Build[]): Build[] {
  const roots = builds.filter((build) => build.parentId === null);
  const result: Build[] = [];
  for (const root of roots) {
    result.push(root);
    result.push(...builds.filter((build) => build.parentId === root.id));
  }
  result.push(
    ...builds.filter(
      (build) =>
        build.parentId !== null
        && !builds.some((parent) => parent.id === build.parentId),
    ),
  );
  return result;
}

export function forkBuild(
  library: BuildLibrary,
  buildId: string,
  id: string,
): Build {
  const source = buildById(library, buildId);
  if (!source) throw new Error("Build not found");
  const parentId = source.parentId ?? source.id;
  const copy: Build = {
    ...structuredClone(source),
    id,
    name: `${source.name} — variant`,
    parentId,
    favourite: false,
  };
  library.builds.unshift(copy);
  return copy;
}

export function removeBuild(
  library: BuildLibrary,
  buildId: string,
): void {
  library.builds = library.builds
    .filter((build) => build.id !== buildId)
    .map((build) =>
      build.parentId === buildId ? { ...build, parentId: null } : build,
    );
  for (const team of library.teams) {
    team.slots = team.slots.map((slot) =>
      slot.buildId === buildId ? { ...slot, buildId: null } : slot,
    );
  }
}

export function searchLibrary(
  library: BuildLibrary,
  kind: LibraryItem["kind"],
  query: string,
  tag: string | null,
): Array<Build | Team> {
  const term = query.trim().toLocaleLowerCase();
  const values = kind === "build" ? orderedBuilds(library.builds) : library.teams;
  return values.filter((value) => {
    if (tag && !value.tags.includes(tag)) return false;
    if (!term) return true;
    const buildText =
      "skills" in value
        ? value.skills.map((skill) => skill.name).join(" ")
        : value.slots.map((slot) => slot.hero).join(" ");
    return `${value.name} ${value.tags.join(" ")} ${buildText}`
      .toLocaleLowerCase()
      .includes(term);
  });
}
