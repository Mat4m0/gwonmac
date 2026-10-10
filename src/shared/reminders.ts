/**
 * Turns successive effect and alcohol observations into chat reminders: one a
 * minute before something runs out, one when it has run out. Something removed
 * early (death, zoning to an outpost, a character change) or a withdrawn
 * observation (loading, PvP) never reports that it ran out.
 */

export type ReminderGroup = "cons" | "pcons" | "alcohol";
export type ReminderOptions = Readonly<Record<ReminderGroup | "beforeEnd" | "atEnd", boolean>>;
export type ReminderEvent = Readonly<{ kind: "warning" | "ended"; group: ReminderGroup; name: string; remainingMs: number }>;

/**
 * Effect IDs from GWCA Constants/Skills.h (gwdevhub/GWToolboxpp, 2026-10-10).
 * Durations always come from the game's own effect record, never from here.
 */
export const CONSUMABLE_EFFECTS: ReadonlyMap<number, Readonly<{ name: string; group: ReminderGroup }>> = new Map([
  [2522, { name: "Essence of Celerity", group: "cons" }],
  [2521, { name: "Grail of Might", group: "cons" }],
  [2520, { name: "Armor of Salvation", group: "cons" }],
  [1945, { name: "Birthday Cupcake", group: "pcons" }],
  [3174, { name: "War Supplies", group: "pcons" }],
  [1934, { name: "Golden Egg", group: "pcons" }],
  [2605, { name: "Candy Apple", group: "pcons" }],
  [2604, { name: "Candy Corn", group: "pcons" }],
  [2649, { name: "Slice of Pumpkin Pie", group: "pcons" }],
  [1680, { name: "Drake Kabob", group: "pcons" }],
  [1681, { name: "Bowl of Skalefin Soup", group: "pcons" }],
  [1682, { name: "Pahnai Salad", group: "pcons" }],
  [2971, { name: "Blue Rock Candy", group: "pcons" }],
  [2972, { name: "Green Rock Candy", group: "pcons" }],
  [2973, { name: "Red Rock Candy", group: "pcons" }],
  // Lunar Fortunes: only Lunar Blessing (+1 attributes), not Lucky Aura or the others.
  [1926, { name: "Lunar Blessing", group: "pcons" }],
] as const);

export const REMINDER_WARNING_MS = 60_000;
/** Something that disappears this close to its end ran out rather than being removed. */
const RAN_OUT_TOLERANCE_MS = 1_500;

const remaining = (gameTimer: number, startedAt: number, duration: number) => {
  const elapsed = (gameTimer - startedAt) >>> 0;
  return elapsed >= duration ? 0 : duration - elapsed;
};

export type EffectRecord = Readonly<{ skillId: number; durationMs: number; appliedAtGameMs: number }>;
export type EffectObservation =
  | Readonly<{ status: "ready"; gameTimer: number; effects: readonly EffectRecord[] }>
  | Readonly<{ status: "waiting" }>;
type TrackedEffect = Readonly<{ appliedAtGameMs: number; durationMs: number; warned: boolean; ended: boolean }>;
export type ConsumableWatch = ReadonlyMap<number, TrackedEffect>;

/** Folds one observation; only the longest-lasting instance of each consumable counts. */
export function observeConsumables(watch: ConsumableWatch, observation: EffectObservation):
  { watch: ConsumableWatch; events: readonly ReminderEvent[] } {
  if (observation.status !== "ready") return { watch, events: [] };
  const best = new Map<number, EffectRecord & { remainingMs: number }>();
  for (const effect of observation.effects) {
    if (!CONSUMABLE_EFFECTS.has(effect.skillId) || effect.durationMs === 0 || effect.durationMs >= 3_600_000) continue;
    const left = remaining(observation.gameTimer, effect.appliedAtGameMs, effect.durationMs);
    if (left >= (best.get(effect.skillId)?.remainingMs ?? -1)) best.set(effect.skillId, { ...effect, remainingMs: left });
  }
  const next = new Map<number, TrackedEffect>();
  const events: ReminderEvent[] = [];
  const event = (kind: ReminderEvent["kind"], skillId: number, remainingMs: number) =>
    events.push({ kind, ...CONSUMABLE_EFFECTS.get(skillId)!, remainingMs });
  for (const [skillId, effect] of best) {
    const previous = watch.get(skillId);
    // A new application time is a fresh or refreshed consumable: its reminders start over.
    const same = previous && previous.appliedAtGameMs === effect.appliedAtGameMs && previous.durationMs === effect.durationMs;
    let warned = same ? previous.warned : false;
    let ended = same ? previous.ended : false;
    if (effect.remainingMs === 0 && !ended) { event("ended", skillId, 0); ended = warned = true; }
    else if (effect.remainingMs <= REMINDER_WARNING_MS && !warned) { event("warning", skillId, effect.remainingMs); warned = true; }
    next.set(skillId, { appliedAtGameMs: effect.appliedAtGameMs, durationMs: effect.durationMs, warned, ended });
  }
  for (const [skillId, tracked] of watch) {
    if (best.has(skillId) || tracked.ended) continue;
    if (remaining(observation.gameTimer, tracked.appliedAtGameMs, tracked.durationMs) <= RAN_OUT_TOLERANCE_MS) event("ended", skillId, 0);
  }
  return { watch: next, events };
}

export type AlcoholObservation =
  | Readonly<{ status: "ready"; gameTimer: number; remainingMs: number }>
  | Readonly<{ status: "waiting" }>;
export type AlcoholWatch = Readonly<{ gameTimer: number; remainingMs: number; warned: boolean }> | null;

/**
 * The alcohol time is the kernel's estimate (one minute per level), so its
 * lines say "about". Drinking again above the last minute re-arms the warning.
 */
export function observeAlcohol(watch: AlcoholWatch, observation: AlcoholObservation):
  { watch: AlcoholWatch; events: readonly ReminderEvent[] } {
  if (observation.status !== "ready") return { watch, events: [] };
  const left = observation.remainingMs;
  const event = (kind: ReminderEvent["kind"], remainingMs: number): ReminderEvent =>
    ({ kind, group: "alcohol", name: "Alcohol", remainingMs });
  if (left === 0) {
    // A cleared estimate (character change, logout) is not wearing off.
    const ranOut = watch !== null
      && remaining(observation.gameTimer, watch.gameTimer, watch.remainingMs) <= RAN_OUT_TOLERANCE_MS;
    return { watch: null, events: ranOut ? [event("ended", 0)] : [] };
  }
  const warned = left <= REMINDER_WARNING_MS && (watch?.warned ?? false);
  const next = { gameTimer: observation.gameTimer, remainingMs: left, warned: left <= REMINDER_WARNING_MS };
  return { watch: next, events: left <= REMINDER_WARNING_MS && !warned ? [event("warning", left)] : [] };
}

export function wantsReminder(options: ReminderOptions, event: ReminderEvent): boolean {
  return options[event.group] && (event.kind === "warning" ? options.beforeEnd : options.atEnd);
}

/** The chat line for one reminder, without the `[gwonmac]` prefix. */
export function reminderLine(event: ReminderEvent): string {
  const about = event.group === "alcohol" ? "about " : "";
  if (event.kind === "ended") return event.group === "alcohol" ? "Alcohol has worn off." : `${event.name} has run out.`;
  const seconds = Math.ceil(event.remainingMs / 1_000);
  const verb = event.group === "alcohol" ? "wears off" : "ends";
  return `${event.name} ${verb} in ${about}${seconds >= 50 ? "1 minute" : `${seconds} seconds`}.`;
}
