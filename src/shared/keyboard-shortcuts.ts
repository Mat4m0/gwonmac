/**
 * Canonical app-shortcut actions, defaults, persistence shapes, and pure operations.
 * Main and renderer consume this one model so interception and presentation agree.
 */
export const SHORTCUT_ACTIONS = [
  "character.switch",
  "tools.toggle",
  "trade.toggle",
  "storage.open",
  "travel.open",
  "cartography.grid.toggle",
  "cartography.walkability.toggle",
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
  /** A lowercase physical main-block letter or digit. */
  key: string;
  shift: boolean;
  option: boolean;
}

export type ShortcutOverrides = Partial<
  Record<ShortcutAction, ShortcutBinding | null>
>;

export type ShortcutCaptureResult =
  | Readonly<{ status: "captured"; binding: ShortcutBinding }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "cleared" }>
  | Readonly<{ status: "invalid" }>;

export const DEFAULT_SHORTCUTS = Object.freeze({
    "character.switch": Object.freeze({ key: "r", shift: false, option: false }),
    "tools.toggle": Object.freeze({ key: "b", shift: false, option: false }),
    "trade.toggle": Object.freeze({ key: "k", shift: false, option: false }),
    "storage.open": Object.freeze({ key: "c", shift: true, option: false }),
    "travel.open": Object.freeze({ key: "t", shift: false, option: false }),
    "cartography.grid.toggle": null,
    "cartography.walkability.toggle": null,
  } satisfies Record<ShortcutAction, ShortcutBinding | null>);

export const SHORTCUT_LABELS: Readonly<Record<ShortcutAction, string>> =
  Object.freeze({
    "character.switch": "Switch Character",
    "tools.toggle": "Build Library",
    "trade.toggle": "Trade Chat",
    "storage.open": "Open Xunlai storage",
    "travel.open": "Travel",
    "cartography.grid.toggle": "Exploration grid",
    "cartography.walkability.toggle": "Walkable terrain",
  });

export interface ShortcutInput {
  code: string;
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
}

export function isShortcutBinding(value: unknown): value is ShortcutBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const binding = value as Record<string, unknown>;
  return Object.keys(binding).every((key) =>
    key === "key" || key === "shift" || key === "option"
  )
    && typeof binding.key === "string"
    && /^[a-z0-9]$/u.test(binding.key)
    && typeof binding.shift === "boolean"
    && typeof binding.option === "boolean";
}

export function parseShortcutAction(value: unknown): ShortcutAction {
  if (typeof value === "string" && SHORTCUT_ACTIONS.includes(value as ShortcutAction)) {
    return value as ShortcutAction;
  }
  throw new Error("Shortcut action is invalid");
}

export function isShortcutOverrides(value: unknown): value is ShortcutOverrides {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const overrides = value as Record<string, unknown>;
  return Object.entries(overrides).every(([action, binding]) =>
    SHORTCUT_ACTIONS.includes(action as ShortcutAction)
      && (binding === null || isShortcutBinding(binding))
  );
}

export function resolveShortcuts(
  overrides: ShortcutOverrides,
): Readonly<Record<ShortcutAction, ShortcutBinding | null>> {
  return Object.freeze({
    "character.switch": overrides["character.switch"] === undefined
      ? DEFAULT_SHORTCUTS["character.switch"]
      : overrides["character.switch"],
    "tools.toggle": overrides["tools.toggle"] === undefined
      ? DEFAULT_SHORTCUTS["tools.toggle"]
      : overrides["tools.toggle"],
    "trade.toggle": overrides["trade.toggle"] === undefined
      ? DEFAULT_SHORTCUTS["trade.toggle"]
      : overrides["trade.toggle"],
    "storage.open": overrides["storage.open"] === undefined
      ? DEFAULT_SHORTCUTS["storage.open"]
      : overrides["storage.open"],
    "travel.open": overrides["travel.open"] === undefined
      ? DEFAULT_SHORTCUTS["travel.open"]
      : overrides["travel.open"],
    "cartography.grid.toggle": overrides["cartography.grid.toggle"] ?? null,
    "cartography.walkability.toggle": overrides["cartography.walkability.toggle"] ?? null,
  });
}

export function shortcutEquals(
  left: ShortcutBinding | null,
  right: ShortcutBinding | null,
): boolean {
  return left === right || (
    left !== null
    && right !== null
    && left.key === right.key
    && left.shift === right.shift
    && left.option === right.option
  );
}

export function shortcutMatches(
  binding: ShortcutBinding,
  input: ShortcutInput,
): boolean {
  return input.meta
    && !input.control
    && shortcutKey(input.code) === binding.key
    && input.shift === binding.shift
    && input.alt === binding.option;
}

export function shortcutFromInput(input: ShortcutInput): ShortcutBinding | null {
  const key = shortcutKey(input.code);
  if (!input.meta || input.control || key === null) return null;
  return { key, shift: input.shift, option: input.alt };
}

function shortcutKey(code: string): string | null {
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/u.test(code)) return code.slice(5);
  return null;
}

const RESERVED_SHORTCUTS: readonly ShortcutBinding[] = [
  // Editing and application lifecycle shortcuts must remain dependable.
  ...["a", "c", "h", "m", "q", "v", "w", "x", "z"].map((key) => ({
    key,
    shift: false,
    option: false,
  })),
  { key: "z", shift: true, option: false },
  { key: "r", shift: true, option: false },
  { key: "m", shift: true, option: false },
  { key: "h", shift: false, option: true },
  { key: "i", shift: false, option: true },
  // Travel owns Command+1…9 for quick-destination assignment.
  ..."123456789".split("").map((key) => ({
    key,
    shift: false,
    option: false,
  })),
];

export function shortcutReserved(binding: ShortcutBinding): boolean {
  return RESERVED_SHORTCUTS.some((reserved) => shortcutEquals(binding, reserved));
}

export function shortcutConflict(
  action: ShortcutAction,
  binding: ShortcutBinding,
  shortcuts: Readonly<Record<ShortcutAction, ShortcutBinding | null>>,
): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((candidate) =>
    candidate !== action && shortcutEquals(shortcuts[candidate], binding)
  ) ?? null;
}

export function withShortcutOverride(
  overrides: ShortcutOverrides,
  action: ShortcutAction,
  binding: ShortcutBinding | null,
): ShortcutOverrides {
  const next = { ...overrides };
  if (shortcutEquals(binding, DEFAULT_SHORTCUTS[action])) {
    delete next[action];
  } else {
    next[action] = binding;
  }
  return next;
}

export function shortcutAccelerator(binding: ShortcutBinding | null): string | undefined {
  if (!binding) return undefined;
  return [
    "Command",
    binding.option ? "Alt" : null,
    binding.shift ? "Shift" : null,
    binding.key.toUpperCase(),
  ].filter((part): part is string => part !== null).join("+");
}

export function shortcutDisplay(binding: ShortcutBinding | null): string {
  if (!binding) return "Not set";
  return `⌘${binding.option ? "⌥" : ""}${binding.shift ? "⇧" : ""}${binding.key.toUpperCase()}`;
}
