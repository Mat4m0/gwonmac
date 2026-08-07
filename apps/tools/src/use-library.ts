import { computed, onMounted, ref, shallowRef } from "vue";
import {
  LIBRARY_VERSION,
  buildId as canonicalBuildId,
  mapTeamSlots,
  skillBarOf,
  skillId,
  teamSlotsOf,
} from "../../../src/shared/builds/library";
import {
  decodeSkillTemplate,
  type SkillTemplate,
} from "../../../src/shared/builds/skill-template";
import { diffBuilds } from "../../../src/shared/builds/diff";
import {
  validateBuild,
  validateBuildFor,
} from "../../../src/shared/builds/validate";
import { resolveTeamApplyPlan } from "../../../src/shared/builds/team-apply";
import { captureParty } from "../../../src/shared/builds/live-party";
import type { ToolsHost } from "./host";
import {
  buildById,
  buildId,
  buildUsage,
  cloneLibrary,
  forkBuild,
  removeBuild,
  searchLibrary,
  teamById,
  teamId,
  type Build,
  type BuildLibrary,
  type LibraryItem,
  type Team,
} from "./model";

type Notice = Readonly<{
  tone: "success" | "warning" | "error";
  message: string;
}> | null;

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * `base`, or `base (2)`, or the first suffix nobody has taken.
 *
 * Three call sites grew their own copy of this loop and capture would have been
 * the fourth — one of which numbers a whole party at once, so `taken` is a set
 * the caller keeps adding to rather than a library it re-reads per name.
 */
function uniqueName(taken: ReadonlySet<string>, base: string): string {
  let name = base;
  for (let suffix = 2; taken.has(name); suffix++) name = `${base} (${suffix})`;
  return name;
}

function emptyTeamSlots(): Team["slots"] {
  return teamSlotsOf((position) => ({
    build: null,
    hero: null,
    behaviour: position === 0 ? null : "guard",
    panel: false,
    disabled: [],
  }));
}

/**
 * Whether a saved build already is this template.
 *
 * Overlaying the template's three fields onto the build and asking for the
 * distance uses the domain's own comparison, which knows that an absent
 * attribute and an explicit rank 0 are the same build. Comparing the two with
 * `JSON.stringify` — which this did — is key-order sensitive, so a re-imported
 * code whose attributes decoded in a different order was not recognised as
 * already saved and got a duplicate.
 */
function sameTemplate(left: Build, right: SkillTemplate): boolean {
  return diffBuilds(left, { ...left, ...right }).total === 0;
}

export function useLibrary(host: ToolsHost) {
  const library = shallowRef<BuildLibrary | null>(null);
  const loading = ref(true);
  const saving = ref(false);
  const error = ref<string | null>(null);
  const notice = ref<Notice>(null);
  const kind = ref<LibraryItem["kind"]>("team");
  const selectedId = ref("");
  const query = ref("");
  const tag = ref<string | null>(null);
  const undoStack = shallowRef<Array<{
    label: string;
    library: BuildLibrary;
    selection: LibraryItem;
  }>>([]);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const catalogueLookup = (skill: Build["skills"][number]) =>
    skill !== null && host.skills.has(skill)
      ? {
          profession: host.skills.get(skill).profession,
          elite: host.skills.get(skill).elite,
          availability: host.skills.get(skill).availability,
        }
      : null;
  const validateInContext = (
    build: Build,
    context: "standalone" | "player" | "hero",
  ) => context === "standalone"
    ? validateBuild(build, catalogueLookup)
    : validateBuildFor(build, catalogueLookup, context);

  const showNotice = (
    message: string,
    tone: NonNullable<Notice>["tone"] = "success",
  ) => {
    notice.value = { message, tone };
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.value = null;
      noticeTimer = null;
    }, 4_500);
  };

  const selectedBuild = computed(() =>
    kind.value === "build" && library.value
      ? buildById(library.value, selectedId.value)
      : undefined,
  );
  const selectedTeam = computed(() =>
    kind.value === "team" && library.value
      ? teamById(library.value, selectedId.value)
      : undefined,
  );
  const items = computed(() =>
    library.value
      ? searchLibrary(library.value, host.skills, kind.value, query.value, tag.value)
      : [],
  );
  const tags = computed(() => library.value?.tags ?? []);
  const canUndo = computed(() => undoStack.value.length > 0);

  const selectKind = (next: LibraryItem["kind"]) => {
    kind.value = next;
    query.value = "";
    tag.value = null;
    selectedId.value =
      (next === "build" ? library.value?.builds[0]?.id : library.value?.teams[0]?.id)
      ?? "";
  };

  const commit = async (
    label: string,
    change: (current: BuildLibrary) => BuildLibrary,
  ) => {
    if (!library.value || saving.value) return;
    const previous = cloneLibrary(library.value);
    const previousSelection: LibraryItem = kind.value === "build"
      ? { kind: "build", id: buildId(selectedId.value) }
      : { kind: "team", id: teamId(selectedId.value) };
    const next = change(previous);
    library.value = next;
    saving.value = true;
    error.value = null;
    try {
      await host.saveLibrary(next);
      undoStack.value = [
        ...undoStack.value,
        { label, library: previous, selection: previousSelection },
      ].slice(-40);
      showNotice(label);
    } catch (cause) {
      library.value = previous;
      error.value = cause instanceof Error ? cause.message : "The library could not be saved.";
      showNotice("Nothing changed—the save failed.", "error");
    } finally {
      saving.value = false;
    }
  };

  const undo = async () => {
    if (saving.value) return;
    const previous = undoStack.value.at(-1);
    if (!previous) return;
    saving.value = true;
    try {
      await host.saveLibrary(previous.library);
      library.value = previous.library;
      kind.value = previous.selection.kind;
      selectedId.value = previous.selection.id;
      undoStack.value = undoStack.value.slice(0, -1);
      showNotice(`Undid “${previous.label}”.`);
    } catch {
      showNotice("Undo failed. Nothing changed.", "error");
    } finally {
      saving.value = false;
    }
  };

  const replaceBuild = (source: BuildLibrary, next: Build): BuildLibrary => ({
    ...source,
    builds: source.builds.map((build) => build.id === next.id ? next : build),
  });

  const renameBuild = (id: string, name: string) =>
    commit("Build renamed", (current) => {
      const build = buildById(current, id);
      return build && name.trim()
        ? replaceBuild(current, { ...build, name: name.trim() })
        : current;
    });

  const toggleBuildFavourite = (id: string) =>
    commit("Favourite updated", (current) => {
      const build = buildById(current, id);
      return build
        ? replaceBuild(current, { ...build, favourite: !build.favourite })
        : current;
    });

  const updateBuildNotes = (id: string, notes: string) =>
    commit("Notes saved", (current) => {
      const build = buildById(current, id);
      return build ? replaceBuild(current, { ...build, notes }) : current;
    });

  const setTags = (
    target: LibraryItem,
    values: readonly string[],
  ) => commit("Tags updated", (current) => {
    const tags = values
      .map((value) => value.trim())
      .filter((value, index, all) =>
        value.length > 0
        && value.length <= 24
        && all.findIndex((candidate) =>
          candidate.toLocaleLowerCase() === value.toLocaleLowerCase()
        ) === index
      );
    const vocabulary = [...current.tags];
    for (const value of tags) {
      if (!vocabulary.some((tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) {
        vocabulary.push(value);
      }
    }
    return {
      ...current,
      tags: vocabulary,
      builds: target.kind === "build"
        ? current.builds.map((build) =>
            build.id === target.id ? { ...build, tags } : build
          )
        : current.builds,
      teams: target.kind === "team"
        ? current.teams.map((team) =>
            team.id === target.id ? { ...team, tags } : team
          )
        : current.teams,
    };
  });

  const saveBuildDraft = async (
    sourceId: string,
    content: Pick<
      Build,
      "name" | "professions" | "attributes" | "skills" | "tags" | "notes"
    >,
    mode: "all" | "fork" = "all",
    rebindTeamIds: readonly string[] = [],
  ): Promise<boolean> => {
    const nextId = id("build");
    await commit(
      mode === "fork" ? "Variant created with your changes" : "Build changes saved",
      (current) => {
        const source = buildById(current, sourceId);
        if (!source) return current;
        if (mode === "all") {
          return replaceBuild(current, { ...source, ...content });
        }
        const forked = forkBuild(current, sourceId, nextId);
        const variant = buildById(forked, nextId);
        if (!variant) return current;
        const updated = replaceBuild(forked, {
          ...variant,
          ...content,
          name: content.name === source.name ? variant.name : content.name,
        });
        return {
          ...updated,
          teams: updated.teams.map((team) =>
            rebindTeamIds.includes(team.id)
              ? {
                  ...team,
                  slots: mapTeamSlots(team.slots, (slot) =>
                    slot.build === sourceId
                      ? { ...slot, build: buildId(nextId) }
                      : slot,
                  ),
                }
              : team,
          ),
        };
      },
    );
    if (mode === "fork") {
      kind.value = "build";
      selectedId.value = nextId;
    }
    return true;
  };

  const createFork = async (sourceId: string, rebindTeamIds: readonly string[]) => {
    const nextId = id("build");
    await commit("Variant created", (current) => {
      const forked = forkBuild(current, sourceId, nextId);
      return {
        ...forked,
        teams: forked.teams.map((team) =>
          rebindTeamIds.includes(team.id)
            ? {
                ...team,
                slots: mapTeamSlots(team.slots, (slot) =>
                  slot.build === sourceId ? { ...slot, build: buildId(nextId) } : slot,
                ),
              }
            : team,
        ),
      };
    });
    kind.value = "build";
    selectedId.value = nextId;
  };

  const deleteBuild = async (id: string) => {
    await commit("Build deleted", (current) => removeBuild(current, id));
    selectedId.value = library.value?.builds[0]?.id ?? "";
  };

  const detachVariant = (id: string) =>
    commit("Variant detached", (current) => {
      const build = buildById(current, id);
      return build
        ? replaceBuild(current, { ...build, parent: null })
        : current;
    });

  const mergeVariant = async (id: string) => {
    const variant = library.value ? buildById(library.value, id) : undefined;
    const parentId = variant?.parent;
    if (!parentId) return;
    await commit("Variant merged into its original", (current) => {
      const child = buildById(current, id);
      const parent = child?.parent ? buildById(current, child.parent) : undefined;
      if (!child || !parent) return current;
      const updated = replaceBuild(current, {
        ...parent,
        professions: child.professions,
        skills: child.skills,
        attributes: child.attributes,
      });
      return {
        ...updated,
        builds: updated.builds.filter((build) => build.id !== child.id),
        teams: updated.teams.map((team) => ({
          ...team,
          slots: mapTeamSlots(team.slots, (slot) =>
            slot.build === child.id ? { ...slot, build: parent.id } : slot,
          ),
        })),
      };
    });
    selectedId.value = parentId;
  };

  const updateTeam = (
    id: string,
    update: (team: Team) => Team,
    label: string,
  ) =>
    commit(label, (current) => ({
      ...current,
      teams: current.teams.map((team) => team.id === id ? update(team) : team),
    }));

  const duplicateTeam = async (id: string) => {
    const nextId = `team-${crypto.randomUUID()}`;
    await commit("Team duplicated", (current) => {
      const source = teamById(current, id);
      return source
        ? {
            ...current,
            teams: [{
              ...structuredClone(source),
              id: teamId(nextId),
              name: `${source.name} — copy`,
              favourite: false,
              lastUsed: null,
            }, ...current.teams],
          }
        : current;
    });
    kind.value = "team";
    selectedId.value = nextId;
  };

  const deleteTeam = async (id: string) => {
    await commit("Team deleted", (current) => ({
      ...current,
      teams: current.teams.filter((team) => team.id !== id),
    }));
    selectedId.value = library.value?.teams[0]?.id ?? "";
  };

  const importBuild = async (code: string, requestedName = "") => {
    const decoded = decodeSkillTemplate(code.trim());
    if (!decoded || !library.value) {
      showNotice("That is not a valid Guild Wars skill template code.", "error");
      return false;
    }
    const existing = library.value.builds.find((build) => sameTemplate(build, decoded));
    if (existing) {
      kind.value = "build";
      selectedId.value = existing.id;
      showNotice(`Already saved as “${existing.name}”.`, "warning");
      return true;
    }
    const elite = decoded.skills
      .filter((skill): skill is NonNullable<typeof skill> => skill !== null)
      .map((skill) => host.skills.get(skill))
      .find((skill) => skill.elite);
    const baseName = requestedName.trim()
      || elite?.name
      || `${decoded.professions.filter(Boolean).join("/")} build`;
    const names = new Set(library.value.builds.map((build) => build.name));
    const name = uniqueName(names, baseName);
    const nextId = id("build");
    await commit("Build imported", (current) => ({
      ...current,
      version: LIBRARY_VERSION,
      builds: [{
        ...decoded,
        id: canonicalBuildId(nextId),
        name,
        tags: [],
        notes: "",
        favourite: false,
        lastUsed: null,
        parent: null,
        origin: "template-code",
      }, ...current.builds],
    }));
    kind.value = "build";
    selectedId.value = nextId;
    return true;
  };

  const createBlankBuild = async (requestedName = "") => {
    if (!library.value) return;
    const nextId = id("build");
    const baseName = requestedName.trim() || "New build";
    const names = new Set(library.value.builds.map((build) => build.name));
    const name = uniqueName(names, baseName);
    await commit("Blank build created", (current) => ({
      ...current,
      builds: [{
        id: canonicalBuildId(nextId),
        name,
        professions: ["W", null],
        skills: skillBarOf(() => null),
        attributes: {},
        tags: [],
        notes: "",
        favourite: false,
        lastUsed: null,
        parent: null,
        origin: null,
      }, ...current.builds],
    }));
    kind.value = "build";
    selectedId.value = nextId;
  };

  const createTeam = async (requestedName = "") => {
    const nextId = id("team");
    const name = requestedName.trim() || "New team";
    await commit("Team created", (current) => ({
      ...current,
      teams: [{
        id: teamId(nextId),
        name,
        mode: "normal",
        tags: [],
        favourite: false,
        lastUsed: null,
        notes: "",
        slots: emptyTeamSlots(),
      }, ...current.teams],
    }));
    kind.value = "team";
    selectedId.value = nextId;
  };

  /**
   * Saves the party the player is standing in as a team.
   *
   * `captureParty` decides the shape and knows nothing about the library; this
   * decides what the result is called. Uniquing happens here because it is the
   * one thing that needs to know what is already stored, and the set is carried
   * across the whole party so two heroes cannot both become "Livia".
   */
  const captureCurrentParty = async () => {
    if (!library.value || saving.value) return null;
    const teamNames = new Set(library.value.teams.map((team) => team.name));
    const captured = captureParty(
      host.party.value,
      uniqueName(teamNames, "Current party"),
      (kind) => id(kind),
    );
    if (!captured) {
      showNotice(
        host.party.value.status === "ready"
          ? "There are no heroes in your party to save."
          : "No party observed yet. Guild Wars may still be loading.",
        "warning",
      );
      return null;
    }
    const buildNames = new Set(library.value.builds.map((build) => build.name));
    const builds = captured.builds.map((build) => {
      const name = uniqueName(buildNames, build.name);
      buildNames.add(name);
      return { ...build, name };
    });
    await commit("Team saved from your party", (current) => ({
      ...current,
      builds: [...builds, ...current.builds],
      teams: [captured.team, ...current.teams],
    }));
    kind.value = "team";
    selectedId.value = captured.team.id;
    // Overwrites the commit's own notice on purpose: the gaps are the part
    // worth reading, and "saved" was already visible in the panel behind it.
    showNotice(
      `Saved ${builds.length} ${builds.length === 1 ? "build" : "builds"}. `
      + `${captured.gaps.length} ${captured.gaps.length === 1 ? "thing" : "things"} `
      + "could not be read — the team's notes say which.",
      "warning",
    );
    return captured;
  };

  const publish = async (build: Build) => {
    saving.value = true;
    try {
      const result = await host.publishBuild(build);
      showNotice(`Template written: ${result.fileName}`);
      return result;
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : "The template could not be saved.", "error");
      return null;
    } finally {
      saving.value = false;
    }
  };

  const applyTeam = async (team: Team) => {
    if (!library.value || saving.value) return null;
    saving.value = true;
    const source = library.value;
    try {
      const resolution = resolveTeamApplyPlan(
        team,
        source,
        (build, context) => validateInContext(build, context),
      );
      if (!resolution.valid) {
        showNotice(resolution.problems.some(({ rule }) => rule === "hard-mode")
          ? "Hard-mode team application is not available yet."
          : `${resolution.problems.length} team ${
            resolution.problems.length === 1 ? "assignment needs" : "assignments need"
          } attention before Apply.`, "warning");
        return null;
      }
      const result = await host.applyTeam(resolution.plan);
      const changes = `${result.completedChanges} confirmed ${
        result.completedChanges === 1 ? "change" : "changes"
      }`;
      const appliedAt = Date.now();
      const next = {
        ...source,
        teams: source.teams.map((candidate) =>
          candidate.id === team.id
            ? { ...candidate, lastUsed: appliedAt }
            : candidate,
        ),
      };
      try {
        await host.saveLibrary(next);
        library.value = next;
      } catch {
        showNotice(
          `Team applied (${changes}), but its last-used time could not be saved.`,
          "warning",
        );
        return result;
      }
      // Named, not counted. A skill the game refused is almost always one the
      // account has not unlocked, and the name is what tells the player that.
      const skipped = (result.skippedSkills ?? [])
        .map((id) => skillId(id))
        .map((skill) => host.skills.has(skill) ? host.skills.get(skill).name : `#${skill}`);
      showNotice(skipped.length
        ? `Team applied · ${changes}. Guild Wars would not equip `
          + `${skipped.slice(0, 3).join(", ")}`
          + `${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ""}`
          + " — those are usually skills the account has not unlocked."
        : result.skillsSkipped
          ? `Team applied · ${changes}. Guild Wars skipped one or more unavailable skills.`
          : `Team applied · ${changes}.`);
      return result;
    } catch (cause) {
      showNotice(
        cause instanceof Error ? cause.message : "The team could not be applied.",
        "error",
      );
      return null;
    } finally {
      saving.value = false;
    }
  };

  const reset = async () => {
    if (!host.reset) return;
    const loaded = await host.reset();
    library.value = loaded.library;
    undoStack.value = [];
    kind.value = "team";
    selectedId.value = library.value.teams[0]?.id ?? "";
    showNotice("Fixture data restored.");
  };

  onMounted(async () => {
    try {
      const loaded = await host.loadLibrary();
      library.value = loaded.library;
      selectedId.value = loaded.library.teams[0]?.id ?? loaded.library.builds[0]?.id ?? "";
      if (loaded.library.teams.length === 0 && loaded.library.builds.length > 0) kind.value = "build";
      if (loaded.recovered) {
        showNotice("The damaged library was preserved and a new empty library opened.", "warning");
      } else if (loaded.skillProblem) {
        showNotice(loaded.skillProblem, "error");
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "The library could not be loaded.";
    } finally {
      loading.value = false;
    }
  });

  return {
    skills: host.skills,
    // Narrower than handing components the host: they need the reason Apply is
    // refused, not the ability to call around the controller for everything
    // else it wraps.
    applyUnavailable: host.applyUnavailable,
    library, loading, saving, error, notice, kind, selectedId, query, tag,
    items, tags, selectedBuild, selectedTeam, canUndo, selectKind,
    select: (next: LibraryItem) => {
      kind.value = next.kind;
      selectedId.value = next.id;
    },
    usage: (id: string) => library.value ? buildUsage(library.value, id) : [],
    validate: validateInContext,
    renameBuild, toggleBuildFavourite, updateBuildNotes, setTags,
    saveBuildDraft,
    createFork, deleteBuild, detachVariant, mergeVariant,
    updateTeam, duplicateTeam, deleteTeam,
    publish, applyTeam, undo, reset,
    importBuild, createBlankBuild, createTeam, captureCurrentParty,
  };
}

export type LibraryController = ReturnType<typeof useLibrary>;
