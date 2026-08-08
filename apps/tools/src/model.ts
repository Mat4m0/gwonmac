import {
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

export function teamMemberLabel(
  hero: Team["slots"][number]["hero"],
  slotIndex: number,
): string {
  if (slotIndex === 0) return "You";
  // The placeholder is this function's business, not the label's: an empty hero
  // slot is a prompt to pick one, and only a picker knows that.
  return hero === null ? "Choose hero" : heroLabel(hero);
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
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
