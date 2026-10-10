/**
 * Consumables the Status bar keeps in view. Skill IDs are the effect IDs from
 * GWCA Constants/Skills.h (gwdevhub/GWToolboxpp, 2026-10-10). Durations always
 * come from the game's own effect record, never from this list.
 */
import { remainingEffectMs, type CompanionPlayerEffectState } from "./companion-effect-snapshot.js";

/** List order is display order, so chips never trade places while they count down. */
const CONSUMABLES: readonly (readonly [skillId: number, label: string, name: string])[] = [
  [2522, "Essence", "Essence of Celerity"],
  [2521, "Grail", "Grail of Might"],
  [2520, "Armor", "Armor of Salvation"],
  [1945, "Cupcake", "Birthday Cupcake"],
  [3174, "Supplies", "War Supplies"],
  [1934, "Egg", "Golden Egg"],
  [2605, "Apple", "Candy Apple"],
  [2604, "Corn", "Candy Corn"],
  [2649, "Pie", "Slice of Pumpkin Pie"],
  [1680, "Kabob", "Drake Kabob"],
  [1681, "Soup", "Bowl of Skalefin Soup"],
  [1682, "Salad", "Pahnai Salad"],
  [2971, "Blue", "Blue Rock Candy"],
  [2972, "Green", "Green Rock Candy"],
  [2973, "Red", "Red Rock Candy"],
  // Lunar Fortunes: only Lunar Blessing (+1 attributes), not Lucky Aura or the others.
  [1926, "Lunar", "Lunar Blessing"],
];
export const CONSUMABLE_WARNING_MS = 60_000;
export type ConsumableTimer = Readonly<{ skillId: number; label: string; name: string; remainingMs: number }>;

/** Running consumables; when one is applied twice, the instance that lasts longer counts. */
export function activeConsumables(effects: CompanionPlayerEffectState): readonly ConsumableTimer[] {
  if (effects.status !== "ready") return [];
  const longest = new Map<number, number>();
  for (const effect of effects.effects) {
    // Long native durations can be placeholders; no consumable lasts an hour.
    if (effect.durationMs >= 3_600_000) continue;
    const remaining = remainingEffectMs(effects.gameTimer, effect.appliedAtGameMs, effect.durationMs);
    if (remaining && remaining > (longest.get(effect.skillId) ?? 0)) longest.set(effect.skillId, remaining);
  }
  return CONSUMABLES.flatMap(([skillId, label, name]) => {
    const remainingMs = longest.get(skillId);
    return remainingMs ? [{ skillId, label, name, remainingMs }] : [];
  });
}
