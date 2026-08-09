import type { SkillId } from "./model";

export type SkillDropPreview = Readonly<{
  skill: SkillId;
  target: number | null;
  outcome: "pending" | "place" | "replace-elite" | "already-used" | "unavailable";
  affectedSlots: readonly number[];
  label: string;
}>;
