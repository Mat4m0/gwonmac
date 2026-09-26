/**
 * Canonical app-shortcut actions, defaults, persistence shapes, and pure operations.
 * Main and renderer consume this one model so interception and presentation agree.
 */
export const SHORTCUT_ACTIONS = [
  "game.call-target",
  "game.resign",
  "character.switch",
  "tools.toggle",
  "trade.toggle",
  "whispers.toggle",
  "storage.open",
  "travel.open",
  "cartography.grid.toggle",
  "cartography.walkability.toggle",
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
  /** Lowercase physical key identifier; letters retain their existing saved form. */
  key: string;
  shift: boolean;
  option: boolean;
  /** Older saved bindings are Command shortcuts. */
  command?: boolean;
  control?: boolean;
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
    "game.call-target": Object.freeze({ key: "g", shift: false, option: false }),
    "game.resign": null,
    "character.switch": Object.freeze({ key: "e", shift: false, option: false }),
    "tools.toggle": Object.freeze({ key: "b", shift: false, option: false }),
    "whispers.toggle": Object.freeze({ key: "d", shift: false, option: false }),
    "trade.toggle": Object.freeze({ key: "k", shift: false, option: false }),
    "storage.open": Object.freeze({ key: "s", shift: false, option: false }),
    "travel.open": Object.freeze({ key: "t", shift: false, option: false }),
    "cartography.grid.toggle": null,
    "cartography.walkability.toggle": null,
  } satisfies Record<ShortcutAction, ShortcutBinding | null>);

export const SHORTCUT_LABELS: Readonly<Record<ShortcutAction, string>> =
  Object.freeze({
    "game.call-target": "Call target",
    "game.resign": "Resign",
    "character.switch": "Switch Character",
    "tools.toggle": "Build Library",
    "trade.toggle": "Trade Chat",
    "whispers.toggle": "Whispers",
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

const SPECIAL_KEYS: Readonly<Record<string, readonly [key: string, label: string, accelerator: string]>> = {
  Space: ['space', 'Space', 'Space'], Tab: ['tab', '⇥', 'Tab'], Enter: ['enter', '↩', 'Return'], Escape: ['escape', '⎋', 'Escape'],
  Backspace: ['backspace', '⌫', 'Backspace'], Delete: ['delete', '⌦', 'Delete'],
  ArrowUp: ['up', '↑', 'Up'], ArrowDown: ['down', '↓', 'Down'], ArrowLeft: ['left', '←', 'Left'], ArrowRight: ['right', '→', 'Right'],
  Home: ['home', '↖', 'Home'], End: ['end', '↘', 'End'], PageUp: ['pageup', '⇞', 'PageUp'], PageDown: ['pagedown', '⇟', 'PageDown'], Insert: ['insert', 'Insert', 'Insert'],
  Minus: ['minus', '−', '-'], Equal: ['equal', '=', '='], BracketLeft: ['bracketleft', '[', '['], BracketRight: ['bracketright', ']', ']'],
  Backslash: ['backslash', '\\', '\\'], Semicolon: ['semicolon', ';', ';'], Quote: ['quote', "'", "'"], Backquote: ['backquote', '`', '`'], Comma: ['comma', ',', ','], Period: ['period', '.', '.'], Slash: ['slash', '/', '/'],
  NumpadAdd: ['numadd', '+', 'numadd'], NumpadSubtract: ['numsub', '−', 'numsub'], NumpadMultiply: ['nummult', '×', 'nummult'], NumpadDivide: ['numdiv', '÷', 'numdiv'], NumpadDecimal: ['numdec', '.', 'numdec'],
};
const knownKey = (key: string) => /^[a-z0-9]$/u.test(key) || /^f(?:[1-9]|1[0-9]|2[0-4])$/u.test(key) || /^num[0-9]$/u.test(key) || Object.values(SPECIAL_KEYS).some(([value]) => key === value);
const keyDefinition = (key: string) => Object.values(SPECIAL_KEYS).find(([value]) => key === value);

export function isShortcutBinding(value: unknown): value is ShortcutBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const binding = value as Record<string, unknown>;
  return Object.keys(binding).every((key) =>
    key === "key" || key === "shift" || key === "option" || key === "command" || key === "control"
  )
    && typeof binding.key === "string"
    && knownKey(binding.key)
    && typeof binding.shift === "boolean"
    && typeof binding.option === "boolean"
    && (binding.command === undefined || typeof binding.command === 'boolean')
    && (binding.control === undefined || typeof binding.control === 'boolean')
    && (binding.command !== false || binding.control === true || binding.option || /^f(?:[1-9]|1[0-9]|2[0-4])$/u.test(binding.key));
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
  const resolved = {
    "game.call-target": overrides["game.call-target"] === undefined
      ? DEFAULT_SHORTCUTS["game.call-target"] : overrides["game.call-target"],
    "game.resign": overrides["game.resign"] === undefined
      ? DEFAULT_SHORTCUTS["game.resign"] : overrides["game.resign"],
    "character.switch": overrides["character.switch"] === undefined
      ? DEFAULT_SHORTCUTS["character.switch"]
      : overrides["character.switch"],
    "tools.toggle": overrides["tools.toggle"] === undefined
      ? DEFAULT_SHORTCUTS["tools.toggle"]
      : overrides["tools.toggle"],
    "whispers.toggle": overrides["whispers.toggle"] === undefined ? DEFAULT_SHORTCUTS["whispers.toggle"] : overrides["whispers.toggle"],
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
  };
  // A saved custom binding outranks a newly assigned default.
  for (const action of SHORTCUT_ACTIONS) {
    if (overrides[action] !== undefined || !resolved[action]) continue;
    if (SHORTCUT_ACTIONS.some(other => other !== action && overrides[other] !== undefined
      && shortcutEquals(resolved[action], resolved[other]))) resolved[action] = null;
  }
  return Object.freeze(resolved);
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
    && (left.command ?? true) === (right.command ?? true)
    && (left.control ?? false) === (right.control ?? false)
  );
}

export function shortcutMatches(
  binding: ShortcutBinding,
  input: ShortcutInput,
): boolean {
  return input.meta === (binding.command ?? true)
    && input.control === (binding.control ?? false)
    && shortcutKey(input.code) === binding.key
    && input.shift === binding.shift
    && input.alt === binding.option;
}

export function shortcutFromInput(input: ShortcutInput): ShortcutBinding | null {
  const key = shortcutKey(input.code);
  if (key === null || (!input.meta && !input.control && !input.alt && !/^f(?:[1-9]|1[0-9]|2[0-4])$/u.test(key))) return null;
  return { key, shift: input.shift, option: input.alt, ...(!input.meta ? { command: false } : {}), ...(input.control ? { control: true } : {}) };
}

function shortcutKey(code: string): string | null {
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/u.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(code)) return code.toLowerCase();
  if (/^Numpad[0-9]$/u.test(code)) return `num${code.slice(6)}`;
  return SPECIAL_KEYS[code]?.[0] ?? null;
}

const RESERVED_SHORTCUTS: readonly ShortcutBinding[] = [
  // Editing and application lifecycle shortcuts must remain dependable.
  ...["a", "c", "h", "m", "q", "v", "w", "x", "z"].map((key) => ({
    key,
    shift: false,
    option: false,
  })),
  { key: "z", shift: true, option: false },
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
  if ((binding.command ?? true) && !binding.control && !binding.option && ['tab', 'space'].includes(binding.key)) return true;
  if ((binding.command ?? true) && binding.option && !binding.control && binding.key === 'escape') return true;
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
    (binding.command ?? true) ? "Command" : null,
    binding.control ? "Control" : null,
    binding.option ? "Alt" : null,
    binding.shift ? "Shift" : null,
    keyDefinition(binding.key)?.[2] ?? binding.key.toUpperCase(),
  ].filter((part): part is string => part !== null).join("+");
}

export function shortcutKeycaps(binding: ShortcutBinding | null): readonly { label: string; name: string }[] {
  if (!binding) return [];
  const definition = keyDefinition(binding.key);
  return [
    ...(binding.control ? [{ label: '⌃', name: 'Control' }] : []),
    ...(binding.option ? [{ label: '⌥', name: 'Option' }] : []),
    ...(binding.shift ? [{ label: '⇧', name: 'Shift' }] : []),
    ...((binding.command ?? true) ? [{ label: '⌘', name: 'Command' }] : []),
    { label: definition?.[1] ?? binding.key.toUpperCase(), name: definition?.[2] ?? binding.key.toUpperCase() },
  ];
}
export function shortcutDisplay(binding: ShortcutBinding | null): string {
  return binding ? shortcutKeycaps(binding).map(key => key.label).join('') : 'Not set';
}
export const SHORTCUT_CAPTURE_HINT = 'Press a key with Command, Control or Option; add Shift if needed. F1–F24 also work alone. Escape cancels; Delete clears.';

/** Hub has no persisted override until older settings readers can accept it. */
export const HUB_SHORTCUT: ShortcutBinding = Object.freeze({ key: "r", shift: false, option: false });
export function hubShortcutAvailable(overrides: ShortcutOverrides): boolean {
  return !Object.values(resolveShortcuts(overrides)).some(binding => shortcutEquals(binding, HUB_SHORTCUT));
}
