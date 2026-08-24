/**
 * The canonical display-only bindings for the eight Guild Wars skill slots.
 * Settings, capture, and the HUD share this vocabulary so a saved physical
 * input has one validation rule and one compact presentation.
 */

export type SkillKeyModifiers = Readonly<{
  control: boolean;
  option: boolean;
  shift: boolean;
  command: boolean;
}>;

export type SkillKeyInput =
  | Readonly<{ kind: "keyboard"; code: string }>
  | Readonly<{ kind: "mouse-button"; button: number }>
  | Readonly<{ kind: "wheel"; direction: "up" | "down" }>;

export type SkillKeyBinding = Readonly<{
  input: SkillKeyInput;
  modifiers: SkillKeyModifiers;
}>;

export type SkillKeyCaptureResult =
  | Readonly<{
      status: "captured";
      binding: SkillKeyBinding;
    }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "invalid" }>;

export type SkillKeyBindings = readonly [
  SkillKeyBinding | null,
  SkillKeyBinding | null,
  SkillKeyBinding | null,
  SkillKeyBinding | null,
  SkillKeyBinding | null,
  SkillKeyBinding | null,
  SkillKeyBinding | null,
  SkillKeyBinding | null,
];

export type SkillKeyMainPresentation =
  | Readonly<{ kind: "text"; label: string }>
  | Readonly<{
      kind: "mouse";
      button: "left" | "middle" | "right";
      label: string;
    }>
  | Readonly<{
      kind: "wheel";
      direction: "up" | "down";
      label: string;
    }>;

export type SkillKeyPresentation = Readonly<{
  modifiers: readonly string[];
  main: SkillKeyMainPresentation;
  accessibleLabel: string;
}>;

export const EMPTY_SKILL_KEY_BINDINGS: SkillKeyBindings = Object.freeze([
  null, null, null, null, null, null, null, null,
]);

export const EMPTY_SKILL_KEY_MODIFIERS: SkillKeyModifiers = Object.freeze({
  control: false,
  option: false,
  shift: false,
  command: false,
});

const KEYBOARD_CODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Escape: "Esc",
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Backspace: "Bksp",
  Delete: "Del",
  Insert: "Ins",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  CapsLock: "Caps",
  PrintScreen: "PrtSc",
  ScrollLock: "ScrLk",
  Pause: "Pause",
  NumLock: "Num",
  NumpadAdd: "Num+",
  NumpadSubtract: "Num−",
  NumpadMultiply: "Num×",
  NumpadDivide: "Num÷",
  NumpadDecimal: "Num.",
  NumpadComma: "Num,",
  ContextMenu: "Menu",
});

export const skillKeyKeyboardCodeLabel = (code: string): string | null => {
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/u.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(code)) return code;
  if (/^Numpad[0-9]$/u.test(code)) return `Num${code.slice(6)}`;
  return KEYBOARD_CODE_LABELS[code] ?? null;
};

export const isSkillKeyKeyboardCode = (code: unknown): code is string =>
  typeof code === "string" && skillKeyKeyboardCodeLabel(code) !== null;

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => Object.keys(value).every((key) => keys.includes(key));

export function isSkillKeyModifiers(value: unknown): value is SkillKeyModifiers {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const modifiers = value as Record<string, unknown>;
  return exactKeys(modifiers, ["control", "option", "shift", "command"])
    && ["control", "option", "shift", "command"].every(
      (key) => typeof modifiers[key] === "boolean",
    );
}

export function isSkillKeyInput(value: unknown): value is SkillKeyInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.kind === "keyboard") {
    return exactKeys(input, ["kind", "code"])
      && isSkillKeyKeyboardCode(input.code);
  }
  if (input.kind === "mouse-button") {
    return exactKeys(input, ["kind", "button"])
      && Number.isSafeInteger(input.button)
      && Number(input.button) >= 0
      && Number(input.button) <= 15;
  }
  return input.kind === "wheel"
    && exactKeys(input, ["kind", "direction"])
    && (input.direction === "up" || input.direction === "down");
}

export function isSkillKeyBinding(value: unknown): value is SkillKeyBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return exactKeys(binding, ["input", "modifiers"])
    && isSkillKeyInput(binding.input)
    && isSkillKeyModifiers(binding.modifiers);
}

export function isSkillKeyBindings(value: unknown): value is SkillKeyBindings {
  return Array.isArray(value)
    && value.length === 8
    && value.every((binding) => binding === null || isSkillKeyBinding(binding));
}

export function cloneSkillKeyBindings(bindings: SkillKeyBindings): SkillKeyBindings {
  return bindings.map((binding) => binding === null ? null : {
    input: { ...binding.input },
    modifiers: { ...binding.modifiers },
  }) as unknown as SkillKeyBindings;
}

const MODIFIER_PRESENTATION = [
  ["control", "⌃", "Control"],
  ["option", "⌥", "Option"],
  ["shift", "⇧", "Shift"],
  ["command", "⌘", "Command"],
] as const;

const mouseButtonPresentation = (button: number): SkillKeyMainPresentation => {
  if (button === 0) return { kind: "mouse", button: "left", label: "Left click" };
  if (button === 1) return { kind: "mouse", button: "middle", label: "Middle click" };
  if (button === 2) return { kind: "mouse", button: "right", label: "Right click" };
  return { kind: "text", label: `M${button + 1}` };
};

export function skillKeyPresentation(binding: SkillKeyBinding): SkillKeyPresentation {
  const selectedModifiers = MODIFIER_PRESENTATION.filter(
    ([key]) => binding.modifiers[key],
  );
  const main: SkillKeyMainPresentation = binding.input.kind === "keyboard"
    ? { kind: "text", label: skillKeyKeyboardCodeLabel(binding.input.code)! }
    : binding.input.kind === "mouse-button"
      ? mouseButtonPresentation(binding.input.button)
      : {
          kind: "wheel",
          direction: binding.input.direction,
          label: `Wheel ${binding.input.direction}`,
        };
  return Object.freeze({
    modifiers: Object.freeze(selectedModifiers.map(([, glyph]) => glyph)),
    main: Object.freeze(main),
    accessibleLabel: [
      ...selectedModifiers.map(([, , name]) => name),
      main.label,
    ].join(" + "),
  });
}

export function withSkillKeyBinding(
  bindings: SkillKeyBindings,
  slot: number,
  binding: SkillKeyBinding | null,
): SkillKeyBindings {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= 8) return bindings;
  const next = cloneSkillKeyBindings(bindings) as unknown as (SkillKeyBinding | null)[];
  next[slot] = binding;
  return next as unknown as SkillKeyBindings;
}
