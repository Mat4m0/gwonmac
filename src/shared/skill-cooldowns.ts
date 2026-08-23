/** Canonical settings and display rules for the presentation-only skill timer. */
export const SKILL_COOLDOWN_PRESETS = ["red", "cream", "gold", "blue"] as const;
export type SkillCooldownPreset = (typeof SKILL_COOLDOWN_PRESETS)[number];

export type SkillCooldownColor =
  | Readonly<{ kind: "preset"; preset: SkillCooldownPreset }>
  | Readonly<{ kind: "custom"; value: `#${string}` }>;

export const DEFAULT_SKILL_COOLDOWN_COLOR: SkillCooldownColor = Object.freeze({
  kind: "preset",
  preset: "red",
});

export const SKILL_COOLDOWN_DECIMAL_THRESHOLD_MS = 3_000;
export const MAX_SKILL_COOLDOWN_MS = 1_800_000;

const CUSTOM_COLOR = /^#[0-9a-fA-F]{6}$/u;
const PRESETS = new Set<unknown>(SKILL_COOLDOWN_PRESETS);

export function isSkillCooldownColor(value: unknown): value is SkillCooldownColor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const color = value as Record<string, unknown>;
  if (color.kind === "preset") {
    return Object.keys(color).length === 2 && PRESETS.has(color.preset);
  }
  return color.kind === "custom"
    && Object.keys(color).length === 2
    && typeof color.value === "string"
    && CUSTOM_COLOR.test(color.value);
}

export function cloneSkillCooldownColor(color: SkillCooldownColor): SkillCooldownColor {
  return color.kind === "preset"
    ? Object.freeze({ kind: "preset", preset: color.preset })
    : Object.freeze({ kind: "custom", value: color.value });
}

/**
 * Format a certified remaining duration. Active values below three seconds use
 * tenths rounded upward, so an unavailable skill never flashes `0.0`.
 */
export function formatSkillCooldown(remainingMs: unknown): string | null {
  if (
    typeof remainingMs !== "number"
    || !Number.isSafeInteger(remainingMs)
    || remainingMs <= 0
    || remainingMs > MAX_SKILL_COOLDOWN_MS
  ) return null;
  if (remainingMs < SKILL_COOLDOWN_DECIMAL_THRESHOLD_MS) {
    return (Math.ceil(remainingMs / 100) / 10).toFixed(1);
  }
  return String(Math.ceil(remainingMs / 1_000));
}

export const SKILL_COOLDOWN_PRESET_COLORS: Readonly<Record<SkillCooldownPreset, string>> =
  Object.freeze({
    red: "#e35a4f",
    cream: "#f3e8c8",
    gold: "#e4b957",
    blue: "#85cbea",
  });

export function skillCooldownCssColor(color: SkillCooldownColor): string {
  return color.kind === "custom" ? color.value : SKILL_COOLDOWN_PRESET_COLORS[color.preset];
}
