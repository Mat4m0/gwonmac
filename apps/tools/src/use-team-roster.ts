import { nextTick, onUnmounted, ref } from "vue";
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
  let pointerId: number | null = null;
  let pointerSource: TeamSlotIndex | null = null;
  let pointerHandle: HTMLElement | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let touchReadyAt = 0;
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

  const endDrag = (releaseCapture = true) => {
    const handle = pointerHandle;
    const activePointer = pointerId;
    pointerId = null;
    pointerSource = null;
    pointerHandle = null;
    draggedMember.value = null;
    dropTarget.value = null;
    if (
      releaseCapture
      && handle
      && activePointer !== null
      && handle.hasPointerCapture?.(activePointer)
    ) {
      handle.releasePointerCapture(activePointer);
    }
  };

  const targetAt = (x: number, y: number): TeamSlotIndex | null => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-team-slot]");
    const position = Number(row?.dataset.teamSlot);
    return Number.isInteger(position) && position > 0 && position < 8
      ? asPosition(position)
      : null;
  };

  const startPointerDrag = (position: TeamSlotIndex, event: PointerEvent) => {
    if (position === 0 || pointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    pointerId = event.pointerId;
    pointerSource = position;
    pointerHandle = event.currentTarget as HTMLElement;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    touchReadyAt = event.pointerType === "touch" ? performance.now() + 120 : 0;
    pointerHandle.setPointerCapture?.(event.pointerId);
  };

  const movePointerDrag = (event: PointerEvent) => {
    if (event.pointerId !== pointerId || pointerSource === null) return;
    if (draggedMember.value === null) {
      const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);
      if (distance < 5 || performance.now() < touchReadyAt) return;
      draggedMember.value = pointerSource;
      dropTarget.value = pointerSource;
      announcement.value = `Moving ${memberName(pointerSource)}. Choose a destination.`;
    }
    event.preventDefault();
    dropTarget.value = targetAt(event.clientX, event.clientY) ?? dropTarget.value;
  };

  const finishPointerDrag = async (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const source = draggedMember.value;
    const destination = targetAt(event.clientX, event.clientY) ?? dropTarget.value;
    if (source !== null) event.preventDefault();
    endDrag();
    if (source !== null && destination !== null) await move(source, destination);
  };

  const losePointerDrag = (event: PointerEvent) => {
    if (event.pointerId === pointerId) endDrag(false);
  };

  const cancelWithEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || pointerId === null) return;
    event.preventDefault();
    event.stopPropagation();
    announcement.value = "Hero move cancelled.";
    endDrag();
  };
  window.addEventListener("keydown", cancelWithEscape, true);
  onUnmounted(() => {
    window.removeEventListener("keydown", cancelWithEscape, true);
    endDrag();
  });

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
    dropTarget,
    endDrag,
    finishPointerDrag,
    fixOrder,
    isConfigured,
    isCompactEmpty,
    losePointerDrag,
    movePointerDrag,
    moveByKeyboard,
    remove,
    startPointerDrag,
  };
}
