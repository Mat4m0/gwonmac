<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { HEROES_IN_PANEL_ORDER } from "../../../../src/shared/builds/heroes";
import {
  buildById,
  buildId,
  exclusiveTeamBuildIds,
  heroId,
  mapTeamSlots,
  type TeamSlot,
} from "../../../../src/shared/builds/library";
import type { LibraryController } from "../use-library";
import { teamMemberLabel, type Team } from "../model";
import SkillBar from "./SkillBar.vue";
import TagEditor from "./TagEditor.vue";
import { useTeamRoster } from "../use-team-roster";
import {
  useTeamApplyAssessment,
  type TeamApplyIssue,
} from "../use-team-apply-assessment";

const props = defineProps<{
  team: Team;
  controller: LibraryController;
}>();
const emit = defineEmits<{
  editBuild: [id: string, context: "player" | "hero"];
}>();
const name = ref(props.team.name);
const nameInput = ref<HTMLInputElement | null>(null);
const notes = ref(props.team.notes);
const deleting = ref(false);
const sharing = ref(false);
const showLockedHeroes = ref(false);
const shareCode = ref("");
const shareProblem = ref("");
const shareStatus = ref("");
const shareCodeInput = ref<HTMLTextAreaElement | null>(null);
const roster = useTeamRoster(() => props.team, props.controller.updateTeam);
const {
  announcement: rosterAnnouncement,
  asPosition: asTeamPosition,
  chooseHero,
  draggedMember,
  dropTarget,
  finishPointerDrag: finishMemberPointerDrag,
  fixOrder: fixTeamOrder,
  isConfigured: configuredHeroSlot,
  isCompactEmpty: compactEmptySlot,
  losePointerDrag: loseMemberPointerDrag,
  movePointerDrag: moveMemberPointerDrag,
  moveByKeyboard: moveMemberByKeyboard,
  remove: removeMember,
  startPointerDrag: startMemberPointerDrag,
} = roster;
watch(
  () => props.team.id,
  () => {
    deleting.value = false;
    sharing.value = false;
  },
);

const startSharing = async () => {
  shareProblem.value = "";
  shareStatus.value = "";
  try {
    shareCode.value = props.controller.teamCode(props.team);
    sharing.value = true;
    await nextTick();
    shareCodeInput.value?.focus();
    shareCodeInput.value?.select();
  } catch (cause) {
    shareProblem.value = cause instanceof Error ? cause.message : "This team could not be shared.";
  }
};

const copyTeamCode = async () => {
  shareProblem.value = "";
  shareStatus.value = "";
  try {
    await props.controller.writeClipboard(shareCode.value);
    shareStatus.value = "Team code copied.";
  } catch {
    shareProblem.value = "Clipboard access was refused. Select and copy the code below instead.";
  }
};
watch(
  () => props.team.name,
  (next) => {
    name.value = next;
  },
);
watch(
  () => props.team.notes,
  (next) => {
    notes.value = next;
  },
);

const usedHeroes = computed(() =>
  new Set(props.team.slots.flatMap((slot) => slot.hero === null ? [] : [slot.hero])),
);
const partyHeroes = computed(() => new Set(
  props.controller.party.value.heroes.map(({ hero }) => hero),
));
const heroAvailability = (id: ReturnType<typeof heroId>) =>
  props.controller.party.value.accountHeroes?.get(id)?.availability ?? "unknown";
const lockedHeroes = computed(() =>
  HEROES_IN_PANEL_ORDER.filter((hero) => heroAvailability(hero.id) === "locked"),
);
const heroGroups = (index: number) => [
  {
    label: "In your party",
    heroes: HEROES_IN_PANEL_ORDER.filter((hero) => partyHeroes.value.has(hero.id)),
  },
  {
    label: "Unlocked heroes",
    heroes: HEROES_IN_PANEL_ORDER.filter((hero) =>
      !partyHeroes.value.has(hero.id) && heroAvailability(hero.id) === "unlocked"
    ),
  },
  {
    label: "Availability unknown",
    heroes: HEROES_IN_PANEL_ORDER.filter((hero) =>
      !partyHeroes.value.has(hero.id) && heroAvailability(hero.id) === "unknown"
    ),
  },
  {
    label: "Assigned unavailable heroes",
    heroes: lockedHeroes.value.filter((hero) =>
      props.team.slots[index]?.hero === hero.id
    ),
  },
  {
    label: "Locked heroes",
    heroes: lockedHeroes.value.filter((hero) =>
      showLockedHeroes.value
      && !partyHeroes.value.has(hero.id)
      && props.team.slots[index]?.hero !== hero.id
    ),
  },
].filter((group) => group.heroes.length > 0);
const configured = computed(() =>
  props.team.slots.filter(
    (slot, index) => slot.build !== null || (index > 0 && slot.hero !== null),
  ).length,
);
const exclusiveBuildCount = computed(() =>
  props.controller.library.value
    ? exclusiveTeamBuildIds(props.controller.library.value, props.team.id).length
    : 0,
);
const currentApplyStatus = computed(() =>
  props.controller.applyStatus.value?.teamId === props.team.id
    ? props.controller.applyStatus.value
    : null,
);
const {
  assessment: applyAssessment,
  assignmentValid,
  buildOptionGroups,
  hasPartyGap,
  issuesForSlot,
  noChanges: noApplyChanges,
  reciprocalSwap,
} = useTeamApplyAssessment(() => props.team, props.controller);

const swapReciprocalBuilds = async () => {
  const pair = reciprocalSwap.value;
  if (!pair) return;
  await props.controller.updateTeam(
    props.team.id,
    (team) => {
      const leftBuild = team.slots[pair.left]?.build ?? null;
      const rightBuild = team.slots[pair.right]?.build ?? null;
      return {
        ...team,
        slots: mapTeamSlots(team.slots, (slot, index) => index === pair.left
          ? { ...slot, build: rightBuild }
          : index === pair.right ? { ...slot, build: leftBuild } : slot),
      };
    },
    "Build assignments swapped",
  );
};

const focusIssue = (issue: TeamApplyIssue) => {
  const slot = issue.slots[0];
  if (slot === undefined || issue.control === null) return;
  document.getElementById(`team-${issue.control}-${slot}`)?.focus();
};

const sharedBuildCount = computed(() => {
  const ids = new Set(props.team.slots.flatMap((slot) => slot.build === null ? [] : [slot.build]));
  return [...ids].filter((id) =>
    props.controller.usage(id).some((team) => team.id !== props.team.id)
  ).length;
});

const rename = async () => {
  if (!name.value.trim() || name.value.trim() === props.team.name) return;
  const saved = await props.controller.updateTeam(
    props.team.id,
    (team) => {
      return { ...team, name: name.value.trim() };
    },
    "Team renamed",
  );
  if (!saved) name.value = props.team.name;
};

const updateSlot = (
  index: number,
  patch: Partial<TeamSlot>,
  label: string,
) => props.controller.updateTeam(
  props.team.id,
  (team) => ({
    ...team,
    slots: mapTeamSlots(team.slots, (slot, slotIndex) =>
      slotIndex === index ? { ...slot, ...patch } : slot,
    ),
  }),
  label,
);

const chooseBuild = async (index: number, event: Event) => {
  const select = event.target as HTMLSelectElement;
  const value = select.value;
  if (!await updateSlot(
    index,
    { build: value ? buildId(value) : null },
    `${teamMemberLabel(props.team.slots[index]?.hero ?? null, index)}'s build updated`,
  )) select.value = String(props.team.slots[index]?.build ?? "");
};

const chooseBehaviour = async (index: number, event: Event) => {
  const select = event.target as HTMLSelectElement;
  if (!await updateSlot(
    index,
    { behaviour: select.value as TeamSlot["behaviour"] },
    `${teamMemberLabel(props.team.slots[index]?.hero ?? null, index)}'s behavior updated`,
  )) select.value = String(props.team.slots[index]?.behaviour ?? "");
};

const saveNotes = async () => {
  if (!await props.controller.updateTeam(
    props.team.id,
    (team) => ({ ...team, notes: notes.value }),
    "Team notes saved",
  )) notes.value = props.team.notes;
};

const dismissTransientPanel = (event: KeyboardEvent) => {
  if (!deleting.value && !sharing.value) return;
  event.preventDefault();
  event.stopPropagation();
  deleting.value = false;
  sharing.value = false;
  shareProblem.value = "";
  shareStatus.value = "";
};

const apply = () => {
  if (props.controller.applying.value) {
    props.controller.cancelTeamApply();
    return;
  }
  if (noApplyChanges.value) return;
  props.controller.applyTeam(props.team);
};

defineExpose({
  focusName: () => {
    nameInput.value?.focus();
    nameInput.value?.select();
  },
});
</script>

<template>
  <article
    class="detail-view"
    aria-labelledby="team-title"
    :aria-busy="controller.saving.value"
    @keydown.esc="dismissTransientPanel"
  >
    <fieldset class="team-editor" :disabled="controller.saving.value">
    <header class="detail-header team-detail-header">
      <div class="detail-title-line team-title-line">
        <div class="ui-mark profession-mark">8</div>
        <div class="title-editor">
          <label class="ui-sr-only" for="team-name">Team name</label>
          <input
            id="team-name"
            ref="nameInput"
            v-model="name"
            class="ui-input title-input"
            @change="rename"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <p>{{ configured }} of 8 slots configured</p>
        </div>
        <div class="detail-header-actions">
          <button class="ui-button" @click="controller.duplicateTeam(team.id)">Duplicate team</button>
          <button
            class="ui-button favourite" data-icon
            :aria-label="team.favourite ? 'Remove from favourites' : 'Add to favourites'"
            :aria-pressed="team.favourite"
            @click="controller.updateTeam(team.id, (draft) => ({ ...draft, favourite: !draft.favourite }), 'Favourite updated')"
          >
            {{ team.favourite ? "★" : "☆" }}
          </button>
        </div>
      </div>
      <div class="team-controls">
        <fieldset class="team-mode">
          <legend>When applying</legend>
          <div class="ui-segment" role="group" aria-label="Difficulty when applying">
            <button
              v-for="mode in (['none', 'normal', 'hard'] as const)"
              :key="mode"
              type="button"
              :aria-pressed="team.mode === mode"
              @click="controller.updateTeam(team.id, (draft) => ({ ...draft, mode }), `${mode} mode selected`)"
            >
              {{ mode === "none" ? "Don’t change" : mode === "normal" ? "Normal" : "Hard" }}
            </button>
          </div>
        </fieldset>
        <TagEditor
          :tags="team.tags"
          :options="controller.tags.value"
          label="Team tags"
          @update="controller.setTags({ kind: 'team', id: team.id }, $event)"
        />
      </div>
    </header>

    <div v-if="sharedBuildCount > 0" class="ui-banner">
      <span>
        This team uses {{ sharedBuildCount }}
        {{ sharedBuildCount === 1 ? "build" : "builds" }} shared with another team.
        Editing {{ sharedBuildCount === 1 ? "it" : "them" }} updates those teams too;
        open a build to create a related copy for only this team.
      </span>
    </div>

    <div class="detail-scroll team-scroll">
      <div class="section-heading">
        <div>
          <h2 id="team-title">Team composition</h2>
          <p>Hero, build, and behavior remain visible in one scan.</p>
        </div>
        <label v-if="lockedHeroes.length" class="show-locked-heroes ui-check">
          <input v-model="showLockedHeroes" type="checkbox">
          <span>Show locked heroes</span>
        </label>
      </div>

      <ol class="team-slots">
        <li
          v-for="(slot, index) in team.slots"
          :key="`${slot.hero}-${index}`"
          :class="{
            'team-slot--empty': !slot.build,
            'team-slot--compact': compactEmptySlot(slot, index, issuesForSlot(index).length > 0),
            'team-slot--dragging': draggedMember === index,
            'team-slot--drop-target': dropTarget === index && draggedMember !== index,
            'team-slot--drop-before': dropTarget === index && draggedMember !== null && index < draggedMember,
            'team-slot--drop-after': dropTarget === index && draggedMember !== null && index > draggedMember,
          }"
          :data-team-slot="index"
          :data-invalid="!assignmentValid(slot, index) || issuesForSlot(index).length > 0 ? '' : undefined"
        >
          <span class="slot-number">{{ index + 1 }}</span>
          <div class="hero-cell">
            <span
              class="ui-mark hero-avatar"
              :data-profession="slot.build && controller.library.value
                ? buildById(controller.library.value, slot.build)?.professions[0]
                : undefined"
            >
              {{ teamMemberLabel(slot.hero, index)[0] }}
            </span>
            <span v-if="index === 0" class="player-identity">
              <strong>You</strong>
              <small>
                {{ slot.build && controller.library.value
                  ? buildById(controller.library.value, slot.build)?.professions.join(" / ")
                  : "No build" }}
              </small>
            </span>
            <label v-else class="hero-picker">
              <span class="ui-sr-only">Hero in slot {{ index + 1 }}</span>
              <select
                :id="`team-hero-${index}`"
                class="ui-select"
                :value="slot.hero ?? ''"
                @change="chooseHero(index, $event)"
              >
                <option value="">Choose hero</option>
                <optgroup v-for="group in heroGroups(index)" :key="group.label" :label="group.label">
                  <option
                    v-for="hero in group.heroes"
                    :key="hero.id"
                    :value="hero.id"
                    :disabled="
                      (usedHeroes.has(hero.id) && hero.id !== slot.hero)
                        || heroAvailability(hero.id) === 'locked'
                    "
                  >
                    {{ teamMemberLabel(hero.id, index) }}{{ heroAvailability(hero.id) === "locked" ? " — unavailable" : "" }}
                  </option>
                </optgroup>
              </select>
              <small>
                {{ slot.build && controller.library.value
                  ? buildById(controller.library.value, slot.build)?.professions.join(" / ")
                  : "No build" }}
              </small>
            </label>
          </div>

          <label class="build-picker">
            <span class="ui-sr-only">Build for {{ teamMemberLabel(slot.hero, index) }}</span>
            <select
              :id="`team-build-${index}`"
              class="ui-select"
              :value="slot.build ?? ''"
              :aria-invalid="issuesForSlot(index).length > 0 || !assignmentValid(slot, index)"
              :aria-describedby="issuesForSlot(index).length > 0 ? `team-slot-issue-${index}` : undefined"
              :disabled="index > 0 && slot.hero === null && slot.build === null"
              @change="chooseBuild(index, $event)"
            >
              <option value="">No build</option>
              <optgroup
                v-for="group in buildOptionGroups(index)"
                :key="group.label"
                :label="group.label"
              >
                <option
                  v-for="option in group.options"
                  :key="option.build.id"
                  :value="option.build.id"
                  :disabled="option.disabled"
                >
                  {{ option.build.name }} · {{ option.build.professions.join("/") }}{{ option.reason ? ` — ${option.reason}` : "" }}
                </option>
              </optgroup>
            </select>
            <button
              v-if="slot.build"
              class="ui-link"
              @click="emit('editBuild', slot.build, index === 0 ? 'player' : 'hero')"
            >
              Open build
            </button>
            <small v-if="!assignmentValid(slot, index)" class="assignment-error">
              This build has skills this member cannot equip.
            </small>
            <small
              v-else-if="issuesForSlot(index)[0]"
              :id="`team-slot-issue-${index}`"
              class="assignment-error"
            >
              {{ issuesForSlot(index)[0]?.message }}
              <template v-if="issuesForSlot(index).length > 1">
                + {{ issuesForSlot(index).length - 1 }} more
              </template>
            </small>
          </label>

          <SkillBar
            v-if="slot.build && controller.library.value"
            :skills="buildById(controller.library.value, slot.build)?.skills ?? []"
            :catalogue="controller.skills"
            compact
          />
          <span v-else class="empty-bar">Empty slot</span>

          <span
            v-if="compactEmptySlot(slot, index, issuesForSlot(index).length > 0)"
            class="available-slot"
          >
            {{ draggedMember === null ? "Available slot" : "Move here" }}
          </span>

          <label class="behavior-picker">
            <span class="ui-sr-only">Behavior for {{ teamMemberLabel(slot.hero, index) }}</span>
            <select
              :id="`team-behaviour-${index}`"
              class="ui-select"
              :value="slot.behaviour ?? ''"
              :disabled="index === 0 || slot.hero === null"
              @change="chooseBehaviour(index, $event)"
            >
              <option v-if="index === 0" value="">Player</option>
              <option value="fight">Fight</option>
              <option value="guard">Guard</option>
              <option value="avoid">Avoid</option>
            </select>
          </label>

          <div v-if="configuredHeroSlot(slot, index)" class="team-member-actions">
            <button
              :id="`team-move-${index}`"
              class="ui-button team-move-handle"
              data-icon
              type="button"
              :aria-label="`Move ${teamMemberLabel(slot.hero, index)}`"
              :title="`Drag to move ${teamMemberLabel(slot.hero, index)}; use arrow keys to reorder`"
              @click.prevent
              @keydown="moveMemberByKeyboard(asTeamPosition(index), $event)"
              @pointerdown="startMemberPointerDrag(asTeamPosition(index), $event)"
              @pointermove="moveMemberPointerDrag"
              @pointerup="finishMemberPointerDrag"
              @pointercancel="loseMemberPointerDrag"
              @lostpointercapture="loseMemberPointerDrag"
            >
              <span aria-hidden="true">⠿</span>
            </button>
            <button
              class="ui-button team-remove-member"
              data-icon
              type="button"
              :aria-label="`Remove ${teamMemberLabel(slot.hero, index)} from team`"
              :title="`Remove ${teamMemberLabel(slot.hero, index)} from team`"
              @click="removeMember(asTeamPosition(index))"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

        </li>
      </ol>
      <span class="ui-sr-only" aria-live="polite">{{ rosterAnnouncement }}</span>

      <section
        v-if="applyAssessment.blocked"
        id="apply-readiness"
        class="apply-readiness"
        aria-labelledby="apply-readiness-title"
      >
        <div class="apply-readiness-heading">
          <div>
            <h3 id="apply-readiness-title">Before you can apply</h3>
            <p>
              {{ applyAssessment.issues.length }}
              {{ applyAssessment.issues.length === 1 ? "issue needs" : "issues need" }} attention.
            </p>
          </div>
          <button
            v-if="reciprocalSwap"
            class="ui-button"
            data-variant="primary"
            @click="swapReciprocalBuilds"
          >
            Swap the mismatched builds
          </button>
          <button
            v-else-if="hasPartyGap"
            class="ui-button"
            data-variant="primary"
            @click="fixTeamOrder"
          >
            Fix team order
          </button>
        </div>
        <ul class="apply-issue-list">
          <li v-for="issue in applyAssessment.issues" :key="issue.id">
            <span class="apply-issue-mark" aria-hidden="true">!</span>
            <span>
              <strong>{{ issue.message }}</strong>
              <small v-if="issue.guidance">{{ issue.guidance }}</small>
            </span>
            <button
              v-if="issue.slots[0] !== undefined && issue.control !== null"
              class="ui-link"
              @click="focusIssue(issue)"
            >
              Review {{ teamMemberLabel(team.slots[issue.slots[0]]?.hero ?? null, issue.slots[0]) }}
            </button>
          </li>
        </ul>
      </section>

      <section class="notes-section team-notes">
        <label for="team-notes">Team notes</label>
        <textarea
          id="team-notes"
          v-model="notes"
          class="ui-textarea"
          rows="3"
          placeholder="Consumables, route notes, substitutions…"
          @change="saveNotes"
        />
      </section>

    </div>

    </fieldset>

    <footer v-if="deleting" class="detail-actions detail-actions--explain delete-confirmation">
      <span>
        Delete “{{ team.name }}”? Shared builds are always kept.
      </span>
      <button class="ui-button" @click="deleting = false">Cancel</button>
      <button class="ui-button" data-variant="danger" @click="controller.deleteTeam(team.id)">
        Team only
      </button>
      <button
        v-if="exclusiveBuildCount > 0"
        class="ui-button"
        data-variant="danger"
        @click="controller.deleteTeam(team.id, true)"
      >
        Team + {{ exclusiveBuildCount }} {{ exclusiveBuildCount === 1 ? "build" : "builds" }}
      </button>
    </footer>
    <footer v-else-if="sharing" class="detail-actions detail-actions--explain share-team">
      <label>
        <span>GWonMac team export code</span>
        <textarea
          ref="shareCodeInput"
          class="ui-textarea template-code"
          rows="4"
          readonly
          :value="shareCode"
          @focus="($event.target as HTMLTextAreaElement).select()"
        />
        <small v-if="shareProblem" class="ui-field-error" role="alert">{{ shareProblem }}</small>
        <small v-else-if="shareStatus" class="share-success" role="status">{{ shareStatus }}</small>
      </label>
      <button class="ui-button" @click="sharing = false">Done</button>
      <button class="ui-button" data-variant="primary" @click="copyTeamCode">Copy code</button>
    </footer>
    <footer v-else class="detail-actions detail-actions--explain team-actions">
      <!--
        The reason replaces the description rather than joining it. Explaining
        what Apply would do, beside a control that cannot do it, is the sentence
        that made the button look ready in the first place.
      -->
      <div
        id="apply-feedback"
        v-if="currentApplyStatus"
        class="apply-status"
        :data-tone="currentApplyStatus.tone"
        role="status"
        aria-live="polite"
      >
        <span>{{ currentApplyStatus.message }}</span>
        <details v-if="currentApplyStatus.details?.length" class="apply-details">
          <summary>Review skipped skills</summary>
          <ul>
            <li v-for="detail in currentApplyStatus.details" :key="detail.member">
              <strong>{{ detail.member }}:</strong> {{ detail.skills.join(", ") }}
            </li>
          </ul>
        </details>
      </div>
      <div
        id="apply-feedback"
        v-else
        class="apply-status"
        :class="{ 'apply-unavailable': controller.applyUnavailable !== null }"
      >
        {{ applyAssessment.message }}
      </div>
      <div class="team-action-buttons">
        <button
          class="ui-link"
          data-variant="danger"
          :disabled="controller.saving.value"
          @click="deleting = true"
        >Delete</button>
        <button
          class="ui-button"
          :disabled="controller.saving.value"
          @click="startSharing"
        >Export team</button>
        <button
          class="ui-button"
          :data-variant="controller.applying.value ? 'danger' : 'primary'"
          :disabled="!controller.applying.value && (applyAssessment.blocked || noApplyChanges || controller.saving.value)"
          :aria-describedby="applyAssessment.blocked ? 'apply-feedback apply-readiness' : 'apply-feedback'"
          @click="apply"
        >
          {{ controller.applying.value ? "Cancel Apply" : noApplyChanges ? "Already applied" : "Apply team" }}
        </button>
      </div>
    </footer>
  </article>
</template>
