import { nextTick, ref } from "vue";
import {
  compactTeamMembers,
  heroId,
  mapTeamSlots,
  moveTeamMember,
  removeTeamMember,
  teamSlotHasMember,
  type TeamSlot,
  type TeamSlotIndex,
} from "../../../src/shared/builds/library";
import { teamMemberLabel, type Team } from "./model";
import type { LibraryController } from "./use-library";

export function useTeamRoster(
  team: () => Team,
  updateTeam: LibraryController["updateTeam"],
) {
  const draggedMember = ref<TeamSlotIndex | null>(null);
  const dropTarget = ref<TeamSlotIndex | null>(null);
  const announcement = ref("");
  const asPosition = (index: number): TeamSlotIndex => index as TeamSlotIndex;
  const memberName = (index: number): string =>
    teamMemberLabel(team().slots[index]?.hero ?? null, index);
  const isConfigured = (slot: TeamSlot, index: number): boolean =>
    index > 0 && teamSlotHasMember(slot);
  const isCompactEmpty = (slot: TeamSlot, index: number, hasIssue: boolean): boolean =>
    index > 0 && !teamSlotHasMember(slot) && !hasIssue;

  const move = async (from: TeamSlotIndex, to: TeamSlotIndex) => {
    if (from === to || from === 0 || to === 0) return;
    const label = memberName(from);
    const memberCount = team().slots.slice(1).filter(teamSlotHasMember).length;
    const destination = asPosition(Math.min(to, memberCount));
    if (from === destination) return;
    const saved = await updateTeam(
      team().id,
      (draft) => ({
        ...draft,
        slots: moveTeamMember(draft.slots, from, destination),
      }),
      `${label} moved`,
    );
    if (!saved) return;
    announcement.value = `${label} moved to slot ${destination + 1}.`;
    await nextTick();
    document.getElementById(`team-move-${destination}`)?.focus();
  };

  const remove = async (position: TeamSlotIndex) => {
    if (position === 0) return false;
    const label = memberName(position);
    const saved = await updateTeam(
      team().id,
      (draft) => ({ ...draft, slots: removeTeamMember(draft.slots, position) }),
      `${label} removed`,
    );
    if (saved) announcement.value = `${label} removed. Following heroes moved up.`;
    return saved;
  };

  const fixOrder = () => updateTeam(
    team().id,
    (draft) => ({ ...draft, slots: compactTeamMembers(draft.slots) }),
    "Team order fixed",
  );

  const chooseHero = async (index: number, event: Event) => {
    const select = event.target as HTMLSelectElement;
    const hero = select.value ? heroId(Number(select.value)) : null;
    if (hero === null && isConfigured(team().slots[index]!, index)) {
      if (!await remove(asPosition(index))) {
        select.value = String(team().slots[index]?.hero ?? "");
      }
      return;
    }
    const saved = await updateTeam(
      team().id,
      (draft) => ({
        ...draft,
        slots: mapTeamSlots(draft.slots, (slot, position) =>
          position === index ? { ...slot, hero } : slot),
      }),
      "Hero assignment updated",
    );
    if (!saved) select.value = String(team().slots[index]?.hero ?? "");
  };

  const startDrag = (position: TeamSlotIndex, event: DragEvent) => {
    draggedMember.value = position;
    dropTarget.value = position;
    event.dataTransfer?.setData("text/plain", String(position));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    announcement.value = `Moving ${memberName(position)}. Choose a destination.`;
  };

  const enterDropTarget = (position: TeamSlotIndex, event: DragEvent) => {
    if (draggedMember.value === null || position === 0) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropTarget.value = position;
  };

  const drop = async (position: TeamSlotIndex, event: DragEvent) => {
    if (draggedMember.value === null || position === 0) return;
    event.preventDefault();
    const source = draggedMember.value;
    endDrag();
    await move(source, position);
  };

  const endDrag = () => {
    draggedMember.value = null;
    dropTarget.value = null;
  };

  const moveByKeyboard = (position: TeamSlotIndex, event: KeyboardEvent) => {
    let destination: TeamSlotIndex | null = null;
    if (event.key === "ArrowUp" && position > 1) destination = asPosition(position - 1);
    if (event.key === "ArrowDown" && position < 7) destination = asPosition(position + 1);
    if (event.key === "Home") destination = 1;
    if (event.key === "End") destination = 7;
    if (destination === null || destination === position) return;
    event.preventDefault();
    void move(position, destination);
  };

  return {
    announcement,
    asPosition,
    chooseHero,
    draggedMember,
    drop,
    dropTarget,
    endDrag,
    enterDropTarget,
    fixOrder,
    isConfigured,
    isCompactEmpty,
    moveByKeyboard,
    remove,
    startDrag,
  };
}
