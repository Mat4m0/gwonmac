import {
  computed,
  ref,
  shallowRef,
  watch,
  type Ref,
} from "vue";
import {
  skillBarOf,
  type Attribute,
  type AttributeRank,
  type Profession,
  type SkillId,
} from "../../../src/shared/builds/library";
import { withAttributeRank } from "../../../src/shared/builds/authoring";
import { decodeSkillTemplate } from "../../../src/shared/builds/skill-template";
import type { Build } from "./model";
import type { LibraryController } from "./use-library";

export type AuthoringContext = "standalone" | "player" | "hero";

const authoredFields = (build: Build) => ({
  name: build.name,
  professions: build.professions,
  attributes: build.attributes,
  skills: build.skills,
  tags: build.tags,
  notes: build.notes,
});

const clone = (build: Build): Build => structuredClone(build);
const authoredJSON = (build: Build): string => JSON.stringify(authoredFields(build));

/**
 * One editing transaction for one build. This is renderer orchestration only:
 * validation, attribute costs, codecs, and the library mutation remain pure
 * shared/controller operations.
 */
export function useBuildDraft(
  saved: Ref<Build>,
  controller: LibraryController,
  context: Ref<AuthoringContext>,
) {
  const draft = shallowRef(clone(saved.value));
  const activeSlot = ref<number | null>(null);
  const commitPending = ref(false);
  const rebindTeams = ref<string[]>([]);

  watch(
    () => saved.value.id,
    () => reset(),
  );
  watch(
    () => authoredJSON(saved.value),
    (next, previous) => {
      if (next !== previous && !dirty.value) reset();
    },
  );

  const dirty = computed(() => authoredJSON(draft.value) !== authoredJSON(saved.value));
  const verdict = computed(() => controller.validate(draft.value, context.value));
  const usage = computed(() => controller.usage(saved.value.id));
  const valid = computed(() => verdict.value.valid);

  function replace(update: Partial<Build>): void {
    draft.value = { ...draft.value, ...update };
  }

  function reset(): void {
    draft.value = clone(saved.value);
    activeSlot.value = null;
    commitPending.value = false;
    rebindTeams.value = [];
  }

  function setName(name: string): void {
    replace({ name });
  }

  function setNotes(notes: string): void {
    replace({ notes });
  }

  function setTags(tags: readonly string[]): void {
    replace({ tags });
  }

  function setPrimary(primary: Profession): void {
    const [previous, secondary] = draft.value.professions;
    replace({
      professions: [
        primary,
        secondary === primary ? previous : secondary,
      ],
    });
  }

  function setSecondary(secondary: Profession | null): void {
    replace({ professions: [draft.value.professions[0], secondary] });
  }

  function setRank(attribute: Attribute, rank: AttributeRank): void {
    replace({
      attributes: withAttributeRank(draft.value.attributes, attribute, rank),
    });
  }

  function setSkill(slot: number, skill: SkillId | null): void {
    if (slot < 0 || slot >= 8) return;
    replace({
      skills: skillBarOf((position) =>
        position === slot ? skill : draft.value.skills[position],
      ),
    });
  }

  function moveSkill(from: number, to: number): void {
    if (from === to || from < 0 || from >= 8 || to < 0 || to >= 8) return;
    // Reordering changes the length twice, so it happens on a plain array and
    // comes back through the tuple constructor rather than being asserted into
    // one. The splices cancel out; `skillBarOf` is what proves it.
    const reordered = [...draft.value.skills];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved ?? null);
    replace({ skills: skillBarOf((position) => reordered[position] ?? null) });
    activeSlot.value = to;
  }

  function reorderSkills(skills: readonly (SkillId | null)[]): void {
    if (skills.length !== 8) return;
    replace({ skills: skillBarOf((position) => skills[position] ?? null) });
  }

  function finishSkillMove(from: number, to: number): void {
    const active = activeSlot.value;
    if (active === null) return;
    if (active === from) activeSlot.value = to;
    else if (from < to && active > from && active <= to) activeSlot.value = active - 1;
    else if (from > to && active >= to && active < from) activeSlot.value = active + 1;
  }

  function adaptFromCode(code: string): boolean {
    const decoded = decodeSkillTemplate(code.trim());
    if (!decoded) return false;
    replace(decoded);
    activeSlot.value = null;
    return true;
  }

  async function requestSave(): Promise<boolean> {
    if (!dirty.value || !valid.value || !draft.value.name.trim()) return false;
    if (usage.value.length > 1) {
      rebindTeams.value = usage.value[0] ? [usage.value[0].id] : [];
      commitPending.value = true;
      return false;
    }
    return commit("all");
  }

  async function commit(
    mode: "all" | "fork",
    teams: readonly string[] = rebindTeams.value,
  ): Promise<boolean> {
    if (!valid.value || !draft.value.name.trim()) return false;
    const changed = await controller.saveBuildDraft(
      saved.value.id,
      authoredFields({ ...draft.value, name: draft.value.name.trim() }),
      mode,
      teams,
    );
    if (changed) commitPending.value = false;
    return changed;
  }

  function toggleRebind(teamId: string): void {
    rebindTeams.value = rebindTeams.value.includes(teamId)
      ? rebindTeams.value.filter((id) => id !== teamId)
      : [...rebindTeams.value, teamId];
  }

  return {
    draft,
    dirty,
    valid,
    verdict,
    usage,
    context,
    activeSlot,
    commitPending,
    rebindTeams,
    replace,
    reset,
    setName,
    setNotes,
    setTags,
    setPrimary,
    setSecondary,
    setRank,
    setSkill,
    moveSkill,
    reorderSkills,
    finishSkillMove,
    adaptFromCode,
    requestSave,
    commit,
    toggleRebind,
  };
}

export type BuildDraftController = ReturnType<typeof useBuildDraft>;
