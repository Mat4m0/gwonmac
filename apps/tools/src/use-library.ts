import { computed, onMounted, ref, shallowRef } from "vue";
import {
  LIBRARY_VERSION,
  buildId as canonicalBuildId,
  type TeamSlot,
} from "../../../src/shared/builds/library";
import { decodeSkillTemplate } from "../../../src/shared/builds/skill-template";
import {
  validateBuild,
  validateBuildFor,
} from "../../../src/shared/builds/validate";
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
  teamMemberLabel,
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

export type TeamHandoffRow = Readonly<{
  slot: number;
  member: string;
  buildName: string;
  status: "saved" | "blocked" | "failed";
  fileName: string | null;
  message: string;
}>;

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function emptyTeamSlots(): Team["slots"] {
  return Array.from({ length: 8 }, (_, index): TeamSlot => ({
    build: null,
    hero: null,
    behaviour: index === 0 ? null : "guard",
    panel: false,
    disabled: [],
  })) as unknown as Team["slots"];
}

function sameTemplate(left: Build, right: NonNullable<ReturnType<typeof decodeSkillTemplate>>): boolean {
  return JSON.stringify([left.professions, left.attributes, left.skills])
    === JSON.stringify([right.professions, right.attributes, right.skills]);
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
                  slots: team.slots.map((slot) =>
                    slot.build === sourceId
                      ? { ...slot, build: buildId(nextId) }
                      : slot,
                  ) as unknown as Team["slots"],
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
                slots: team.slots.map((slot) =>
                  slot.build === sourceId ? { ...slot, build: buildId(nextId) } : slot,
                ) as unknown as Team["slots"],
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
          slots: team.slots.map((slot) =>
            slot.build === child.id ? { ...slot, build: parent.id } : slot,
          ) as unknown as Team["slots"],
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
    let name = baseName;
    for (let suffix = 2; names.has(name); suffix++) name = `${baseName} (${suffix})`;
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
    let name = baseName;
    for (let suffix = 2; names.has(name); suffix++) name = `${baseName} (${suffix})`;
    await commit("Blank build created", (current) => ({
      ...current,
      builds: [{
        id: canonicalBuildId(nextId),
        name,
        professions: ["W", null],
        skills: Array.from({ length: 8 }, () => null) as unknown as Build["skills"],
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
        mode: "none",
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

  const prepareTeam = async (team: Team): Promise<readonly TeamHandoffRow[]> => {
    if (!library.value || saving.value) return [];
    saving.value = true;
    const source = library.value;
    const duplicateHeroes = new Set<number>();
    const seenHeroes = new Set<number>();
    for (const slot of team.slots.slice(1)) {
      if (slot.hero === null) continue;
      if (seenHeroes.has(slot.hero)) duplicateHeroes.add(slot.hero);
      seenHeroes.add(slot.hero);
    }

    const publications = new Map<string, Awaited<ReturnType<ToolsHost["publishBuild"]>>>();
    const failures = new Map<string, string>();
    try {
      for (const [index, slot] of team.slots.entries()) {
        if (slot.build === null) continue;
        if (index > 0 && slot.hero === null) continue;
        if (slot.hero !== null && duplicateHeroes.has(slot.hero)) continue;
        const build = buildById(source, slot.build);
        if (!build || publications.has(build.id) || failures.has(build.id)) continue;
        if (!validateInContext(build, index === 0 ? "player" : "hero").valid) {
          continue;
        }
        try {
          publications.set(build.id, await host.publishBuild(build));
        } catch (cause) {
          failures.set(
            build.id,
            cause instanceof Error ? cause.message : "The template could not be saved.",
          );
        }
      }

      const rows: TeamHandoffRow[] = [];
      for (const [index, slot] of team.slots.entries()) {
        if (slot.build === null) continue;
        const member = teamMemberLabel(slot.hero, index);
        const build = buildById(source, slot.build);
        if (!build) {
          rows.push({
            slot: index + 1, member, buildName: "Missing build",
            status: "blocked", fileName: null,
            message: "Choose a build that still exists in the library.",
          });
        } else if (index > 0 && slot.hero === null) {
          rows.push({
            slot: index + 1, member, buildName: build.name,
            status: "blocked", fileName: null,
            message: "Choose which hero runs this build.",
          });
        } else if (slot.hero !== null && duplicateHeroes.has(slot.hero)) {
          rows.push({
            slot: index + 1, member, buildName: build.name,
            status: "blocked", fileName: null,
            message: "A hero can occupy only one party slot.",
          });
        } else {
          const verdict = validateInContext(
            build,
            index === 0 ? "player" : "hero",
          );
          if (!verdict.valid) {
            rows.push({
              slot: index + 1,
              member,
              buildName: build.name,
              status: "blocked",
              fileName: null,
              message: "Repair this member’s build before writing its template.",
            });
            continue;
          }
          const published = publications.get(build.id);
          rows.push(published
            ? {
                slot: index + 1, member, buildName: build.name,
                status: "saved", fileName: published.fileName,
                message: `Load ${published.fileName} for ${member}.`,
              }
            : {
                slot: index + 1, member, buildName: build.name,
                status: "failed", fileName: null,
                message: failures.get(build.id) ?? "The template could not be saved.",
              });
        }
      }
      const saved = rows.filter((row) => row.status === "saved").length;
      const blocked = rows.length - saved;
      showNotice(
        blocked === 0
          ? `${saved} ${saved === 1 ? "slot is" : "slots are"} ready to load in Guild Wars.`
          : `${saved} ready · ${blocked} need attention.`,
        blocked === 0 ? "success" : "warning",
      );
      return rows;
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
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "The library could not be loaded.";
    } finally {
      loading.value = false;
    }
  });

  return {
    skills: host.skills,
    describeSkill: host.describeSkill,
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
    publish, prepareTeam, undo, reset,
    importBuild, createBlankBuild, createTeam,
  };
}

export type LibraryController = ReturnType<typeof useLibrary>;
