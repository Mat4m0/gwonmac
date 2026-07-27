import { computed, onMounted, ref, shallowRef } from "vue";
import type { ToolsHost } from "./host";
import {
  buildById,
  buildUsage,
  cloneLibrary,
  forkBuild,
  removeBuild,
  searchLibrary,
  teamById,
  type Build,
  type BuildLibrary,
  type LibraryItem,
} from "./model";

type Notice = Readonly<{
  tone: "success" | "warning" | "error";
  message: string;
}> | null;

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useLibrary(host: ToolsHost) {
  const library = shallowRef<BuildLibrary | null>(null);
  const loading = ref(true);
  const saving = ref(false);
  const error = ref<string | null>(null);
  const notice = ref<Notice>(null);
  const kind = ref<LibraryItem["kind"]>("team");
  const selectedId = ref("t-vanquish");
  const query = ref("");
  const tag = ref<string | null>(null);
  // Shallow by design: a Vue proxy cannot cross structuredClone when the host
  // persists an undo snapshot. These documents are immutable once pushed.
  const undoStack = shallowRef<Array<{ label: string; library: BuildLibrary }>>([]);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

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
      ? searchLibrary(library.value, kind.value, query.value, tag.value)
      : [],
  );
  const tags = computed(() => {
    const values =
      kind.value === "build"
        ? library.value?.builds ?? []
        : library.value?.teams ?? [];
    return [...new Set(values.flatMap((value) => value.tags))].sort();
  });
  const canUndo = computed(() => undoStack.value.length > 0);

  const selectKind = (next: LibraryItem["kind"]) => {
    kind.value = next;
    query.value = "";
    tag.value = null;
    const first =
      next === "build"
        ? library.value?.builds[0]
        : library.value?.teams[0];
    if (first) selectedId.value = first.id;
  };

  const commit = async (
    label: string,
    mutate: (draft: BuildLibrary) => void,
  ) => {
    if (!library.value || saving.value) return;
    const previous = cloneLibrary(library.value);
    const draft = cloneLibrary(library.value);
    mutate(draft);
    library.value = draft;
    saving.value = true;
    error.value = null;
    try {
      library.value = await host.saveLibrary(draft);
      undoStack.value = [...undoStack.value, { label, library: previous }].slice(-40);
      showNotice(label);
    } catch (cause) {
      library.value = previous;
      error.value =
        cause instanceof Error ? cause.message : "The library could not be saved.";
      showNotice("Nothing changed—the save failed.", "error");
    } finally {
      saving.value = false;
    }
  };

  const undo = async () => {
    if (saving.value) return;
    const previous = undoStack.value.at(-1);
    if (!previous) return;
    undoStack.value = undoStack.value.slice(0, -1);
    saving.value = true;
    try {
      library.value = await host.saveLibrary(previous.library);
      showNotice(`Undid “${previous.label}”.`);
    } finally {
      saving.value = false;
    }
  };

  const renameBuild = (buildId: string, name: string) =>
    commit("Build renamed", (draft) => {
      const build = buildById(draft, buildId);
      if (build && name.trim()) build.name = name.trim();
    });

  const toggleBuildFavourite = (buildId: string) =>
    commit("Favourite updated", (draft) => {
      const build = buildById(draft, buildId);
      if (build) build.favourite = !build.favourite;
    });

  const updateBuildNotes = (buildId: string, notes: string) =>
    commit("Notes saved", (draft) => {
      const build = buildById(draft, buildId);
      if (build) build.notes = notes;
    });

  const createFork = async (buildId: string, teamIds: readonly string[]) => {
    const nextId = id("build");
    await commit("Variant created", (draft) => {
      const created = forkBuild(draft, buildId, nextId);
      for (const teamId of teamIds) {
        const team = teamById(draft, teamId);
        if (!team) continue;
        team.slots = team.slots.map((slot) =>
          slot.buildId === buildId ? { ...slot, buildId: created.id } : slot,
        );
      }
    });
    kind.value = "build";
    selectedId.value = nextId;
  };

  const deleteBuild = async (buildId: string) => {
    await commit("Build deleted", (draft) => removeBuild(draft, buildId));
    const first = library.value?.builds[0];
    if (first) selectedId.value = first.id;
  };

  const updateTeam = (
    teamId: string,
    update: (team: NonNullable<ReturnType<typeof teamById>>) => void,
    label: string,
  ) =>
    commit(label, (draft) => {
      const team = teamById(draft, teamId);
      if (team) update(team);
    });

  const duplicateTeam = async (teamId: string) => {
    const nextId = id("team");
    await commit("Team duplicated", (draft) => {
      const source = teamById(draft, teamId);
      if (!source) return;
      draft.teams.unshift({
        ...structuredClone(source),
        id: nextId,
        name: `${source.name} — copy`,
        favourite: false,
      });
    });
    kind.value = "team";
    selectedId.value = nextId;
  };

  const publish = async (build: Build) => {
    saving.value = true;
    try {
      const result = await host.publishBuild(build);
      showNotice(
        `Saved “${result.fileName}” to ${result.location}. Load it from Guild Wars.`,
      );
    } catch (cause) {
      showNotice(
        cause instanceof Error ? cause.message : "The template could not be saved.",
        "error",
      );
    } finally {
      saving.value = false;
    }
  };

  const reset = async () => {
    if (!host.reset) return;
    library.value = await host.reset();
    undoStack.value = [];
    kind.value = "team";
    selectedId.value = library.value.teams[0]?.id ?? "";
    showNotice("Demo data restored.");
  };

  onMounted(async () => {
    try {
      library.value = await host.loadLibrary();
      const preferred = teamById(library.value, selectedId.value);
      if (!preferred) selectedId.value = library.value.teams[0]?.id ?? "";
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : "The library could not be loaded.";
    } finally {
      loading.value = false;
    }
  });

  return {
    library,
    loading,
    saving,
    error,
    notice,
    kind,
    selectedId,
    query,
    tag,
    items,
    tags,
    selectedBuild,
    selectedTeam,
    canUndo,
    selectKind,
    select: (next: LibraryItem) => {
      kind.value = next.kind;
      selectedId.value = next.id;
    },
    usage: (buildId: string) =>
      library.value ? buildUsage(library.value, buildId) : [],
    renameBuild,
    toggleBuildFavourite,
    updateBuildNotes,
    createFork,
    deleteBuild,
    updateTeam,
    duplicateTeam,
    publish,
    undo,
    reset,
  };
}

export type LibraryController = ReturnType<typeof useLibrary>;
